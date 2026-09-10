import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY,
  KEY,
  createStore,
  validate,
  selections,
  resolveSlots,
  step,
  customChoices,
} from './model-spread.mjs';
const models = [
  { model: 'luna', displayName: 'Luna', supportedReasoningEfforts: [{ reasoningEffort: 'max' }] },
  {
    model: 'astra',
    displayName: 'Astra',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }],
  },
];
const slots = [
  { model: 'luna', reasoningEffort: 'max' },
  { model: 'astra', reasoningEffort: 'low' },
  { model: 'astra', reasoningEffort: 'high' },
];
test('ordered pairs retain unavailable slots, repeated models and deduplicate identical stops', () => {
  const input = [
    ...slots,
    { model: 'missing', reasoningEffort: 'high' },
    { model: 'luna', reasoningEffort: 'low' },
    slots[0],
  ];
  assert.equal(resolveSlots(input, models).length, 6);
  assert.deepEqual(
    selections(input, models).map((s) => [s.model, s.reasoningEffort, s.powerSettingIndex]),
    [
      ['luna', 'max', 0],
      ['astra', 'low', 1],
      ['astra', 'high', 2],
    ],
  );
});
test('knob crosses model boundaries and clamps endpoints', () => {
  const list = selections(slots, models);
  for (const [model, effort, direction, index] of [
    ['luna', 'max', -1, 0],
    ['luna', 'max', 1, 1],
    ['astra', 'low', -1, 0],
    ['astra', 'high', 1, 2],
    ['outside', 'low', 1, 0],
    ['outside', 'low', -1, 2],
  ])
    assert.equal(step(list, model, effort, direction), list[index]);
  assert.equal(step([], 'astra', 'low', 1), null);
});
test('default returns upstream choices unchanged; custom never silently falls back', () => {
  const native = [{ model: 'default' }];
  assert.equal(customChoices(EMPTY, models, native, 'local'), native);
  assert.deepEqual(
    customChoices(
      { ...EMPTY, slots: [{ model: 'missing', reasoningEffort: 'low' }] },
      models,
      native,
      'local',
    ),
    [],
  );
});
test('persistence survives recreation, restore defaults and notifies subscribers', () => {
  const values = new Map(),
    storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  const first = createStore(storage),
    events = [];
  first.subscribe(() => events.push(first.get()));
  first.save({ version: 1, slots, micro: true });
  assert.equal(events.length, 1);
  assert.deepEqual(createStore(storage).get(), { version: 1, slots, micro: true });
  first.save({ ...first.get(), slots: null });
  assert.equal(createStore(storage).get().slots, null);
});
test('failed writes preserve configuration; corrupt data is reported', () => {
  const state = createStore({
    getItem: () => JSON.stringify({ ...EMPTY, slots }),
    setItem: () => {
      throw Error('disk full');
    },
  });
  assert.throws(() => state.save({ ...EMPTY, micro: true }), /disk full/);
  assert.deepEqual(state.get().slots, slots);
  const bad = createStore({ getItem: () => '{broken' });
  assert.equal(bad.get(), EMPTY);
  assert.ok(bad.getError());
});
test('cross-window settings refresh through storage events', () => {
  let raw = null,
    listener;
  const storage = { getItem: () => raw, setItem: (_, v) => (raw = v) };
  const state = createStore(storage, { addEventListener: (_, fn) => (listener = fn) });
  raw = JSON.stringify({ ...EMPTY, slots, micro: true });
  listener({ key: KEY });
  assert.equal(state.get().micro, true);
});
test('malformed, oversized and empty custom spreads are rejected', () => {
  for (const slots of [[], [{}], Array(33).fill({ model: 'x', reasoningEffort: 'low' })])
    assert.throws(() => validate({ version: 1, slots, micro: false }));
  assert.throws(() => validate({ version: 2, slots: null, micro: false }));
});
