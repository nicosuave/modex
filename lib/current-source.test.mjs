import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBundlePaths, actualBundles, canonicalBundles } from './current-source.mjs';

const archive = (names) => ({
  header: {
    files: {
      webview: {
        files: {
          assets: {
            files: Object.fromEntries(names.map((name) => [name, { size: 1, offset: '0' }])),
          },
        },
      },
    },
  },
});
test('current module resolution accepts renamed assets and restores their imports in output', () => {
  const known = ['webview/assets/app-initial-1234.js', 'webview/assets/app-primary-5678.js'];
  const paths = resolveBundlePaths(archive(['app-initial-new.js', 'app-primary-next.js']), known);
  const original = {
    'webview/assets/app-primary-next.js': 'import {x} from "./app-initial-new.js";export {x};',
  };
  const canonical = canonicalBundles(original, paths);
  assert.equal(canonical[known[1]], 'import {x} from "./app-initial-1234.js";export {x};');
  assert.deepEqual(actualBundles(canonical, paths), original);
  canonical['webview/assets/new-mod.mjs'] = 'import "./app-primary-5678.js";';
  assert.equal(
    actualBundles(canonical, paths)['webview/assets/new-mod.mjs'],
    'import "./app-primary-next.js";',
  );
});
test('missing and ambiguous modules remain concrete failures', () => {
  const known = ['webview/assets/app-primary-5678.js'];
  assert.throws(() => resolveBundlePaths(archive([]), known), /0 candidates/);
  assert.throws(
    () => resolveBundlePaths(archive(['app-primary-new.js', 'app-primary-other.js']), known),
    /2 candidates/,
  );
});
