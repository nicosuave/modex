import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transform } from './build-mod.mjs';

const directory = process.env.MODEL_SPREAD_BUNDLES
  ? path.resolve(process.env.MODEL_SPREAD_BUNDLES)
  : path.join(import.meta.dirname, 'bundles');
const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
const available = Object.keys(manifest.files).every((name) =>
  fs.existsSync(path.join(directory, name)),
);
const originals = available
  ? Object.fromEntries(
      Object.keys(manifest.files).map((name) => [
        name,
        fs.readFileSync(path.join(directory, name), 'utf8'),
      ]),
    )
  : null;
const patched = available ? transform(originals) : null;
const bundle = (prefix, source = patched) =>
  source[Object.keys(source).find((name) => name.startsWith(prefix))];

function between(source, start, end) {
  assert.equal(source.split(start).length, 2, `unique start: ${start}`);
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset);
  assert.ok(limit > offset, `end follows start: ${end}`);
  return source.slice(offset, limit);
}

test(
  'native composer adapter retains access checks and selects the model and effort atomically',
  { skip: !available },
  async () => {
    const source = between(bundle('app-primary-'), 'ModelSpreadMod.useComposer(', 'let vt;t[60]');
    const install = new Function(
      'ModelSpreadMod',
      'S7',
      'Ce',
      'Ue',
      'G',
      'Re',
      'Be',
      'Ve',
      'C',
      'U',
      'mt',
      'c',
      '$w',
      'ht',
      source,
    );
    const writes = [],
      selections = [];
    let config,
      allowed = true;
    const bind = ({ canPick = true, loaded = true, restricted = false, locked = false } = {}) => {
      install(
        {
          useComposer: (_react, value) => {
            config = value;
          },
        },
        {},
        {},
        [],
        'gpt-6-astra',
        'high',
        canPick,
        loaded,
        restricted,
        { isModelLocked: locked },
        () => allowed,
        { set: (...args) => writes.push(args) },
        'native-selection-mode',
        async (...args) => {
          selections.push(args);
          return true;
        },
      );
      return config;
    };
    assert.equal(bind().enabled, true);
    assert.equal(await config.select({ model: 'gpt-6-astra', reasoningEffort: 'max' }), true);
    assert.deepEqual(writes, [['native-selection-mode', 'default']]);
    assert.deepEqual(selections, [['gpt-6-astra', 'max']]);
    allowed = false;
    assert.equal(await config.select({ model: 'unavailable', reasoningEffort: 'high' }), false);
    assert.equal(writes.length, 1);
    assert.equal(selections.length, 1);
    for (const options of [
      { canPick: false },
      { loaded: false },
      { restricted: true },
      { locked: true },
    ])
      assert.equal(bind(options).enabled, false);
  },
);

test(
  'shipped Micro dispatch preserves reasoning-only mode and native activation guards',
  { skip: !available },
  () => {
    const source = between(
      bundle('codex-micro-bridge-'),
      'if(C.encoderMode===`reasoning`){if(xn()!=null)return;',
      'if(C.encoderMode===`conversation-scroll`)',
    );
    const dispatch = new Function(
      'C',
      'xn',
      'ge',
      'B',
      'ModelSpreadMod',
      'CustomEvent',
      'se',
      'o',
      'mn',
      'we',
      source,
    );
    const directions = [],
      commands = [];
    const root = new EventTarget();
    root.addEventListener('spread-test', (event) => directions.push(event.detail.direction));
    function turn({
      custom = true,
      direction = 'ArrowUp',
      modal = null,
      target = true,
      composer = true,
    } = {}) {
      dispatch(
        { encoderMode: 'reasoning' },
        () => modal,
        () => (composer ? { root, composerId: 'composer' } : null),
        () => ({ getActivationTarget: () => (target ? {} : null) }),
        { microEnabled: () => custom, EVENT: 'spread-test' },
        CustomEvent,
        (...args) => commands.push(args),
        direction,
        () => null,
        () => {},
      );
    }
    turn();
    turn({ direction: 'ArrowDown' });
    assert.deepEqual(directions, [-1, 1]);
    turn({ custom: false });
    turn({ custom: false, direction: 'ArrowDown' });
    assert.deepEqual(commands, [
      ['composer.decreaseReasoningEffort', 'codex_micro_encoder'],
      ['composer.increaseReasoningEffort', 'codex_micro_encoder'],
    ]);
    for (const options of [{ modal: {} }, { target: false }, { composer: false }]) turn(options);
    assert.equal(directions.length, 2);
    assert.equal(commands.length, 2);
  },
);

test(
  'shipped usage owner preserves lower-priority content and image-limit notices',
  { skip: !available },
  () => {
    const source = between(bundle('app-primary-'), 'function nTr(e)', 'function rTr(e)');
    const classify = between(bundle('app-primary-'), 'function aTr(', 'var oTr,');
    const render = new Function(
      'oTr',
      'Oe',
      'zb',
      'jm',
      'jC',
      'qx',
      'h6',
      'Gwr',
      `${classify};${source};return nTr;`,
    )(
      { c: () => [] },
      () => ({}),
      {},
      () => false,
      {},
      'local',
      { jsx: (type, props) => ({ type, props }) },
      'native-image-limit',
    );
    const fallback = { child: 'lower priority notice' };
    const base = {
      canShowUsageBanners: true,
      lowerPriorityContent: fallback,
      imageGenerationLimit: null,
    };
    assert.equal(
      render({ ...base, showUpsell: true, rateLimit: { rate_limit_upsell: {} } }),
      fallback,
    );
    assert.equal(render({ ...base, showModelLimit: true }), fallback);
    const imageGenerationLimit = { resetAt: 'later' },
      dismiss = () => {};
    const result = render({
      ...base,
      imageGenerationLimit,
      onDismissImageGenerationLimit: dismiss,
    });
    assert.equal(result.type, 'native-image-limit');
    assert.equal(result.props.imageGenerationLimit, imageGenerationLimit);
    assert.equal(result.props.onDismissImageGenerationLimit, dismiss);
    assert.equal(render({ ...base, imageGenerationLimit, canShowUsageBanners: false }), fallback);
  },
);

test('ambiguous Micro replacement boundaries are rejected', { skip: !available }, () => {
  const name = Object.keys(originals).find((name) => name.startsWith('codex-micro-settings-'));
  for (const anchor of ['let _t=Oi[T.encoderMode]', 'let xt;t[130]!==L||t[131]!==T||t[132]!==r?']) {
    assert.throws(
      () => transform({ ...originals, [name]: originals[name] + anchor }),
      /Micro knob settings adapter changed/,
    );
  }
});
