import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('module stems do not include separately named descendants', () => {
  const known = 'webview/assets/local-conversation-thread-old.js';
  const paths = resolveBundlePaths(
    archive(['local-conversation-thread-new.js', 'local-conversation-thread-turn-entries-new.js']),
    [known],
  );
  assert.equal(paths.get(known), 'webview/assets/local-conversation-thread-new.js');
});

test('bundler suffixes may contain a dash', () => {
  for (const known of ['webview/assets/main-old.js', 'webview/assets/main-Old-Hash.js']) {
    assert.equal(
      resolveBundlePaths(archive(['main-DaMR-wdT.js']), [known]).get(known),
      'webview/assets/main-DaMR-wdT.js',
    );
  }
});

test('entrypoint facades resolve to their implementation without hiding ambiguity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-current-source-'));
  const known = 'webview/assets/general-settings-old.js';
  function resolve(contents) {
    const fixture = archive(Object.keys(contents));
    fixture.filename = path.join(directory, 'packed-data');
    fixture.dataOffset = 0;
    let offset = 0;
    for (const [name, source] of Object.entries(contents)) {
      const size = Buffer.byteLength(source);
      fixture.header.files.webview.files.assets.files[name] = { size, offset: String(offset) };
      offset += size;
    }
    fs.writeFileSync(fixture.filename, Object.values(contents).join(''));
    return resolveBundlePaths(fixture, [known]);
  }
  try {
    for (const facade of [
      'import{i as e,o as t}from"./general-settings-new.js";t();export{e as GeneralSettings};',
      'import{a as e,t}from"./general-settings-new.js";e();export{t as GeneralSettings};',
    ]) {
      assert.equal(
        resolve({
          'general-settings-new.js': 'export const i = () => "settings";',
          'general-settings-entry.js': facade,
        }).get(known),
        'webview/assets/general-settings-new.js',
      );
      assert.throws(
        () =>
          resolve({
            'general-settings-new.js': 'export const i = () => "settings";',
            'general-settings-other.js': 'export const i = () => "other settings";',
            'general-settings-entry.js': facade,
          }),
        /2 candidates/,
      );
    }
    for (const facade of [
      'import{i as e,o as t}from"./unrelated-new.js";t();export{e as GeneralSettings};',
      'import{i as e,o as t}from"./general-settings-new.js";other();export{e as GeneralSettings};',
      'import{i as e,o as t}from"./general-settings-new.js";t();sideEffect();export{e as GeneralSettings};',
    ]) {
      assert.throws(
        () =>
          resolve({
            'general-settings-new.js': 'export const i = () => "settings";',
            'general-settings-entry.js': facade,
          }),
        /2 candidates/,
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
