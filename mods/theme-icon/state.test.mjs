import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  KEY,
  themeKey,
  selectedVariant,
  setVariant,
  normalizeSettings,
  validatePayload,
} from './state.mjs';
import { renderPixels, sourceVariant } from './render.mjs';
import { compatibilityEntryPath } from '../../lib/prepare-mod.mjs';

test('variant persists by Codex theme and appearance, independent of custom colors', () => {
  const gruvbox = themeKey('gruvbox', 'dark'),
    light = themeKey('gruvbox', 'light'),
    nord = themeKey('nord', 'dark');
  let settings = setVariant(null, gruvbox, 'light');
  settings = setVariant(settings, nord, 'original');
  const disk = JSON.stringify({ [KEY]: settings });
  const restored = JSON.parse(disk)[KEY];
  assert.equal(selectedVariant(restored, gruvbox), 'light');
  assert.equal(selectedVariant(restored, light), 'theme');
  assert.equal(selectedVariant(restored, nord), 'original');
  assert.equal(selectedVariant(setVariant(restored, gruvbox, 'theme'), nord), 'original');
});
test('invalid and future preferences fall back without executing arbitrary variants', () => {
  assert.equal(
    selectedVariant({ version: 2, variants: { 'dark:nord': 'light' } }, 'dark:nord'),
    'theme',
  );
  assert.deepEqual(
    normalizeSettings({ version: 1, variants: { 'dark:nord': 'bad', 'other:nord': 'light' } }),
    { version: 1, variants: {} },
  );
  assert.throws(() => setVariant(null, 'dark:nord', 'custom'));
  assert.throws(() => themeKey('nord', 'system'));
  const valid = { appearance: 'dark', variant: 'theme', surface: '#282828', accent: '#458588' };
  assert.deepEqual(validatePayload({ ...valid, url: 'file:///etc/passwd' }), valid);
  for (const invalid of [
    { ...valid, accent: 'url(x)' },
    { ...valid, variant: 'path' },
    { ...valid, surface: '#fff' },
    { ...valid, appearance: 'system' },
    null,
  ])
    assert.equal(validatePayload(invalid), null);
});
test('all four variants select the right source and preserve original pixels', () => {
  const bytes = new Uint8Array([31, 31, 31, 255, 0, 0, 255, 128]);
  const palette = { surface: '#553322', accent: '#00ff00' };
  const original = renderPixels(bytes, palette, 'original', 'dark');
  assert.deepEqual(original, bytes);
  assert.notEqual(original, bytes);
  assert.equal(sourceVariant('light', 'dark'), 'light');
  assert.equal(sourceVariant('dark', 'light'), 'dark');
  assert.equal(sourceVariant('theme', 'light'), 'light');
  assert.equal(sourceVariant('original', 'dark'), 'dark');
  for (const variant of ['dark', 'light']) {
    const colored = renderPixels(bytes, palette, variant, 'dark');
    assert.deepEqual(colored.slice(0, 4), bytes.slice(0, 4));
    assert.deepEqual([...colored.slice(4)], [0, 255, 0, 128]);
  }
  assert.notDeepEqual(renderPixels(bytes, palette, 'theme', 'dark').slice(0, 3), bytes.slice(0, 3));
});
test('compatibility supports native and renderer bundles without traversal', () => {
  assert.equal(compatibilityEntryPath('.vite/build/main.js'), '.vite/build/main.js');
  assert.equal(compatibilityEntryPath('webview/assets/theme.js'), 'webview/assets/theme.js');
  assert.equal(compatibilityEntryPath('app.js'), 'webview/assets/app.js');
  for (const name of [
    '/tmp/x.js',
    '../x.js',
    'a/../b.js',
    'a//b.js',
    'a/./b.js',
    'a\\b.js',
    'a\0b.js',
  ])
    assert.throws(() => compatibilityEntryPath(name));
});
