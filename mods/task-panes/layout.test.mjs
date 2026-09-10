import { describe, expect, test } from 'bun:test';
import {
  createLayout,
  dropTask,
  closeTab,
  activateTab,
  resizeSplit,
  toggleMaximize,
  layoutRects,
  hitDropZone,
} from './layout.mjs';

const task = (key) => ({ key, path: `/task/${key}`, title: `Task ${key}` });
const allGroups = (state) =>
  layoutRects({ ...state, maximizedGroup: null }, { width: 1200, height: 900 }).groups.map(
    (rect) => rect.group,
  );
const keys = (state) => allGroups(state).flatMap((group) => group.tabs.map((tab) => tab.key));
const add = (state, key, targetGroup, edge = 'center', index) =>
  dropTask(state, { task: task(key), targetGroup, edge, index });
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

describe('task pane layout', () => {
  test.each([
    ['left', 'x', true],
    ['right', 'x', false],
    ['top', 'y', true],
    ['bottom', 'y', false],
  ])('%s creates the expected split', (edge, axis, before) => {
    const original = freeze(createLayout(task('a')));
    const state = add(original, 'b', original.activeGroup, edge);
    expect(state.root.axis).toBe(axis);
    expect(state.root[before ? 'first' : 'second'].tabs[0].key).toBe('b');
    expect(state.root[before ? 'second' : 'first'].id).toBe(original.activeGroup);
    expect(keys(original)).toEqual(['a']);
    expect(state.activeGroup).toBe('group-2');
    expect(state.nextId).toBe(4);
  });

  test('center inserts, activates, reorders, and repeated sidebar open focuses without duplicating', () => {
    let state = createLayout(task('a'));
    const id = state.activeGroup;
    state = add(state, 'b', id);
    state = add(state, 'c', id, 'center', 1);
    expect(keys(state)).toEqual(['a', 'c', 'b']);
    state = add(freeze(state), 'a', id, 'center', 2);
    expect(keys(state)).toEqual(['c', 'b', 'a']);
    state = add(state, 'c', id);
    expect(keys(state)).toEqual(['c', 'b', 'a']);
    expect(state.root.active).toBe('c');
    expect(activateTab(state, id, 'b').root.active).toBe('b');
  });

  test('moving a tab across groups preserves the task reference and collapses the source', () => {
    let state = createLayout(task('draft'));
    const firstId = state.activeGroup,
      reference = state.root.tabs[0];
    state = add(state, 'b', firstId, 'right');
    const target = state.activeGroup;
    state = dropTask(freeze(state), {
      task: { ...task('draft'), path: '/different' },
      targetGroup: target,
      edge: 'center',
    });
    expect(state.root.id).toBe(target);
    expect(keys(state)).toEqual(['b', 'draft']);
    expect(state.root.tabs[1]).toBe(reference);
    expect(state.root.active).toBe('draft');
    expect(state.activeGroup).toBe(target);
  });

  test('moving a sole sibling tab to an edge of the surviving group still creates a split', () => {
    let state = createLayout(task('a'));
    const target = state.activeGroup;
    state = add(state, 'b', target, 'right');
    state = add(freeze(state), 'b', target, 'top');
    expect(state.root.axis).toBe('y');
    expect(keys(state)).toEqual(['b', 'a']);
    expect(new Set(keys(state)).size).toBe(2);
  });

  test('splitting own sole tab is a no-op; splitting one of several moves just that tab', () => {
    let state = createLayout(task('a'));
    for (const edge of ['left', 'right', 'top', 'bottom'])
      expect(add(state, 'a', state.activeGroup, edge)).toBe(state);
    state = add(state, 'b', state.activeGroup);
    state = add(freeze(state), 'b', state.activeGroup, 'bottom');
    expect(keys(state)).toEqual(['a', 'b']);
    expect(state.root.first.active).toBe('a');
  });

  test('nested empty groups collapse locally and closing the last tab permits reopening', () => {
    let state = createLayout(task('a'));
    const aId = state.activeGroup;
    state = add(state, 'b', aId, 'right');
    const bId = state.activeGroup;
    state = add(state, 'c', bId, 'bottom');
    const cId = state.activeGroup;
    state = closeTab(freeze(state), bId, 'b');
    expect(state.root.first.id).toBe(aId);
    expect(state.root.second.id).toBe(cId);
    state = closeTab(state, aId, 'a');
    expect(state.root.id).toBe(cId);
    state = closeTab(toggleMaximize(state, cId), cId, 'c');
    expect(state.root).toBeNull();
    expect(state.activeGroup).toBeNull();
    expect(state.maximizedGroup).toBeNull();
    const nextId = state.nextId;
    state = add(state, 'd', null);
    expect(state.root.id).toBe(`group-${nextId}`);
    expect(keys(state)).toEqual(['d']);
  });

  test('closing active tabs chooses the next neighbor, then the preceding last tab', () => {
    let state = createLayout(task('a'));
    const id = state.activeGroup;
    state = add(add(state, 'b', id), 'c', id);
    state = closeTab(activateTab(state, id, 'b'), id, 'b');
    expect(state.root.active).toBe('c');
    state = closeTab(state, id, 'c');
    expect(state.root.active).toBe('a');
  });

  test('invalid operations and stale destinations preserve the entire original state', () => {
    const state = freeze(createLayout(task('a')));
    expect(add(state, 'b', 'stale', 'right')).toBe(state);
    expect(add(state, 'a', 'stale')).toBe(state);
    expect(add(state, 'b', state.activeGroup, 'invalid')).toBe(state);
    expect(add(state, 'b', state.activeGroup, 'center', -1)).toBe(state);
    expect(dropTask(state, null)).toBe(state);
    expect(dropTask(state, { task: { key: 'bad' }, targetGroup: state.activeGroup })).toBe(state);
    expect(closeTab(state, 'stale', 'a')).toBe(state);
    expect(closeTab(state, state.activeGroup, 'missing')).toBe(state);
    expect(activateTab(state, state.activeGroup, 'missing')).toBe(state);
    expect(toggleMaximize(state, 'stale')).toBe(state);
    expect(resizeSplit(state, state.activeGroup, 0.5)).toBe(state);
    expect(createLayout().root).toBeNull();
  });

  test('maximize only changes visible geometry and restores the original split', () => {
    let state = createLayout(task('a'));
    state = add(state, 'b', state.activeGroup, 'right');
    const root = state.root,
      id = state.activeGroup;
    state = toggleMaximize(freeze(state), id);
    const geometry = layoutRects(state, { width: 777, height: 555 });
    expect(geometry.splitters).toEqual([]);
    expect(geometry.groups).toMatchObject([{ id, x: 0, y: 0, width: 777, height: 555 }]);
    expect(state.root).toBe(root);
    expect(layoutRects(toggleMaximize(state, id), { width: 777, height: 555 }).groups).toHaveLength(
      2,
    );
    expect(closeTab(state, id, 'b').maximizedGroup).toBeNull();
  });

  test('resizing clamps ratios and geometry respects pane minimums when space allows', () => {
    let state = createLayout(task('a'));
    state = add(state, 'b', state.activeGroup, 'right');
    const id = state.root.id;
    expect(resizeSplit(state, id, NaN)).toBe(state);
    state = resizeSplit(freeze(state), id, 100);
    expect(state.root.ratio).toBe(0.95);
    let geometry = layoutRects(state, { width: 1000, height: 600 });
    expect(geometry.groups.map((rect) => rect.width)).toEqual([736, 260]);
    state = resizeSplit(state, id, -1);
    expect(state.root.ratio).toBe(0.05);
    geometry = layoutRects(state, { width: 1000, height: 600 });
    expect(geometry.groups.map((rect) => rect.width)).toEqual([260, 736]);
  });

  test('nested splitters expose their own container for pointer and keyboard resizing', () => {
    let state = createLayout(task('a'));
    state = add(state, 'b', state.activeGroup, 'right');
    state = add(state, 'c', state.activeGroup, 'bottom');
    const geometry = layoutRects(state, { width: 1200, height: 900 });
    expect(geometry.splitters[0].container).toEqual({ x: 0, y: 0, width: 1200, height: 900 });
    expect(geometry.splitters[1].container).toEqual({ x: 602, y: 0, width: 598, height: 900 });
    const nested = geometry.splitters[1];
    const available = nested.container.height - nested.height;
    expect((nested.y - nested.container.y) / available).toBe(nested.ratio);
    const resized = resizeSplit(state, nested.id, 0.6);
    const updated = layoutRects(resized, { width: 1200, height: 900 }).splitters[1];
    expect((updated.y - updated.container.y) / available).toBeCloseTo(0.6);
  });

  test('vertical panes honor minimum heights and invalid dimensions yield finite empty bounds', () => {
    let state = createLayout(task('a'));
    state = add(state, 'b', state.activeGroup, 'bottom');
    state = resizeSplit(state, state.root.id, 0.01);
    expect(
      layoutRects(state, { width: 800, height: 700 }).groups.map((rect) => rect.height),
    ).toEqual([180, 516]);
    for (const dimensions of [null, {}, { width: -10, height: Infinity }]) {
      const rects = layoutRects(state, dimensions);
      for (const rect of [...rects.groups, ...rects.splitters])
        expect([rect.x, rect.y, rect.width, rect.height]).toEqual([0, 0, 0, 0]);
    }
  });

  test.each([
    [1200, 900],
    [400, 200],
    [1, 1],
    [0, 0],
  ])('nested geometry fits %sx%s without negative sizes or overlaps', (width, height) => {
    let state = createLayout(task('a'));
    state = add(state, 'b', state.activeGroup, 'right');
    state = add(state, 'c', state.activeGroup, 'bottom');
    state = add(state, 'd', state.activeGroup, 'right');
    const geometry = layoutRects(state, { width, height });
    for (const rect of [...geometry.groups, ...geometry.splitters]) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1e-8);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1e-8);
    }
    for (let i = 0; i < geometry.groups.length; i++)
      for (let j = i + 1; j < geometry.groups.length; j++) {
        const a = geometry.groups[i],
          b = geometry.groups[j];
        expect(
          a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y,
        ).toBe(true);
      }
  });

  test('drop hit zones select each edge, center, and reject outside coordinates', () => {
    const rect = { x: 10, y: 20, width: 400, height: 200 };
    for (const [x, y, edge] of [
      [11, 120, 'left'],
      [409, 120, 'right'],
      [210, 21, 'top'],
      [210, 219, 'bottom'],
      [210, 120, 'center'],
    ]) {
      expect(hitDropZone(rect, { x, y })).toBe(edge);
    }
    expect(hitDropZone(rect, { x: 9, y: 120 })).toBeNull();
    expect(hitDropZone({ ...rect, width: 0 }, { x: 10, y: 20 })).toBeNull();
    expect(hitDropZone(rect, { x: NaN, y: 20 })).toBeNull();
  });
});
