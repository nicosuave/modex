import { test, expect } from 'bun:test';
import { createDragCoordinator } from './drag.mjs';
const task = { key: 'local:a', path: '/local/a', title: 'A' };
test('pane acceptance is the only reason to consume a stock drag', () => {
  const drag = createDragCoordinator(),
    previews = [],
    drops = [];
  drag.attach({
    preview: (x) => previews.push(x),
    drop: (x) => {
      drops.push(x);
      return x.point.x > 100;
    },
  });
  drag.start([task]);
  drag.move({ x: 40, y: 50 });
  expect(drag.drop()).toBe(false);
  drag.start([task]);
  drag.move({ x: 140, y: 50 });
  expect(drag.drop()).toBe(true);
  expect(drops).toHaveLength(2);
  expect(drops[1].tasks).toEqual([task]);
  expect(previews.at(-1)).toBe(null);
  expect(drag.drop()).toBe(false);
});
test('cancel, invalid data, and detached workspace cannot create a pane', () => {
  const drag = createDragCoordinator();
  let calls = 0;
  const detach = drag.attach({
    preview: () => {},
    drop: () => {
      calls++;
      return true;
    },
  });
  drag.start([task]);
  drag.move({ x: 2, y: 2 });
  drag.cancel();
  expect(drag.drop()).toBe(false);
  drag.start([{ key: 'file' }]);
  drag.move({ x: 2, y: 2 });
  expect(drag.drop()).toBe(false);
  drag.start([task]);
  drag.move({ x: NaN, y: 2 });
  expect(drag.drop()).toBe(false);
  drag.start([task]);
  drag.move({ x: 2, y: 2 });
  detach();
  expect(drag.drop()).toBe(false);
  expect(calls).toBe(0);
});
