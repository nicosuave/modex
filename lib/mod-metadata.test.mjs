import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArchive, rewriteArchive } from './asar.mjs';
import { metadataFor, readInstalledMods, assertModSelection } from './mod-metadata.mjs';

const both = ['model-spread', 'theme-icon'];
const markers = { 'model-spread': 'legacy/spread.json', 'theme-icon': 'legacy/theme.json' };

function withArchive(entries, fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-metadata-test-'));
  try {
    const files = {};
    const payloads = [];
    let offset = 0;
    for (const [name, value] of Object.entries(entries)) {
      const bytes = Buffer.from(value);
      const parts = name.split('/');
      let node = files;
      for (const part of parts.slice(0, -1)) node = (node[part] ??= { files: {} }).files;
      node[parts.at(-1)] = { size: bytes.length, offset: String(offset) };
      offset += bytes.length;
      payloads.push(bytes);
    }
    const json = Buffer.from(JSON.stringify({ files }));
    const payloadLength = Math.ceil((json.length + 4) / 4) * 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(payloadLength + 4, 4);
    prefix.writeUInt32LE(payloadLength, 8);
    prefix.writeUInt32LE(json.length, 12);
    const filename = path.join(directory, 'source.asar');
    fs.writeFileSync(filename, Buffer.concat([prefix, json, Buffer.alloc(payloadLength - 4 - json.length), ...payloads]));
    return fn(readArchive(filename), directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const mods of [['model-spread'], ['theme-icon'], both]) {
  test(`metadata survives archive packaging for ${mods.join(',')}`, () => withArchive({ 'stock.js': 'unchanged' }, (archive, directory) => {
    const metadata = metadataFor(mods);
    assert.deepEqual(metadata, { schemaVersion: 1, mods });
    const output = path.join(directory, 'packaged.asar');
    rewriteArchive(archive.filename, output, new Map([['modex.json', Buffer.from(JSON.stringify(metadata))]]));
    assert.deepEqual(readInstalledMods(readArchive(output), markers), mods);
  }));
  test(`legacy marker detection identifies ${mods.join(',')}`, () => withArchive(
    Object.fromEntries(mods.map((id) => [markers[id], '{}'])),
    (archive) => assert.deepEqual(readInstalledMods(archive, markers), mods),
  ));
}

test('metadata takes precedence over legacy markers', () => withArchive({
  'modex.json': JSON.stringify({ schemaVersion: 1, mods: ['theme-icon'] }),
  [markers['model-spread']]: '{}',
}, (archive) => assert.deepEqual(readInstalledMods(archive, markers), ['theme-icon'])));

test('unknown future mods remain visible for loss detection', () => withArchive({
  'modex.json': JSON.stringify({ schemaVersion: 1, mods: [...both, 'future-mod'] }),
}, (archive) => {
  const installed = readInstalledMods(archive, markers);
  assert.deepEqual(installed, [...both, 'future-mod']);
  assert.throws(() => assertModSelection(installed, both, false));
  assert.doesNotThrow(() => assertModSelection(installed, both, true));
}));

test('rejects an unidentifiable installed archive', () => withArchive({ 'stock.js': '' }, (archive) => {
  assert.throws(() => readInstalledMods(archive, markers));
}));

test('rejects malformed metadata rather than falling back to legacy markers', () => {
  const invalid = [
    '{', 'null', '[]', '{}',
    JSON.stringify({ schemaVersion: 2, mods: both }),
    JSON.stringify({ schemaVersion: 1, mods: [] }),
    JSON.stringify({ schemaVersion: 1, mods: 'model-spread' }),
    JSON.stringify({ schemaVersion: 1, mods: ['model-spread', 'model-spread'] }),
    JSON.stringify({ schemaVersion: 1, mods: [''] }),
    JSON.stringify({ schemaVersion: 1, mods: [null] }),
    JSON.stringify({ schemaVersion: 1, mods: ['bad/path'] }),
  ];
  for (const metadata of invalid) withArchive({ 'modex.json': metadata, [markers['model-spread']]: '{}' }, (archive) => {
    assert.throws(() => readInstalledMods(archive, markers), metadata);
  });
});

test('implicit selections preserve installed mods, while explicit selections permit removal', () => {
  for (const installed of [['model-spread'], ['theme-icon'], both]) {
    assert.doesNotThrow(() => assertModSelection(installed, both, false));
    assert.doesNotThrow(() => assertModSelection(installed, installed, false));
  }
  for (const selected of [['model-spread'], ['theme-icon']]) {
    assert.throws(() => assertModSelection(both, selected, false));
    assert.doesNotThrow(() => assertModSelection(both, selected, true));
  }
});

test('refuses to package empty, duplicate or malformed mod lists', () => {
  for (const mods of [[], null, 'model-spread', ['model-spread', 'model-spread'], [''], [null], ['bad/path']]) {
    assert.throws(() => metadataFor(mods));
  }
});

const receipt = {
  source: { version: '26.901.51231', build: '51231', asarHash: '1'.repeat(64) },
  build: { revision: 'a'.repeat(40), dirty: true, sourceHash: '2'.repeat(64) },
  transforms: [
    { mod: 'model-spread', name: 'composer', path: 'renderer.js', beforeHash: '3'.repeat(64), afterHash: '4'.repeat(64) },
    { mod: 'theme-icon', name: 'theme', path: 'renderer.js', beforeHash: '4'.repeat(64), afterHash: '5'.repeat(64) },
    { mod: 'theme-icon', name: 'runtime', path: 'modex/theme.cjs', beforeHash: null, afterHash: '6'.repeat(64) },
  ],
};

test('schema2 round-trips build facts and preserves mod selection', () => withArchive({
  'modex.json': JSON.stringify(metadataFor(both, receipt)),
}, archive => {
  assert.deepEqual(readInstalledMods(archive), both);
  assert.deepEqual(metadataFor(both, receipt), { schemaVersion: 2, mods: both, receipt });
  assert.equal(JSON.stringify(metadataFor(both, receipt)), JSON.stringify(metadataFor(both, receipt)));
}));

test('receipt allows explicit unknown revision and dirty facts and optional development modules', () => {
  const value = structuredClone(receipt);
  value.build.revision = null;
  value.build.dirty = null;
  value.development = { root: '/tmp/modex-dev', mods: ['theme-icon'] };
  assert.deepEqual(metadataFor(both, value).receipt, value);
});

test('receipt rejects invalid or disconnected evidence instead of claiming provenance', () => {
  const edits = [
    value => { value.source.asarHash = 'not a hash'; },
    value => { value.build.sourceHash = null; },
    value => { delete value.build.dirty; },
    value => { value.build.revision = 'HEAD'; },
    value => { value.transforms = []; },
    value => { value.transforms[0].path = '../outside'; },
    value => { value.transforms[0].path = 'modex.json'; },
    value => { value.transforms[0].mod = 'unknown-mod'; },
    value => { value.transforms[0].afterHash = null; },
    value => { value.transforms[1].beforeHash = '0'.repeat(64); },
    value => { value.transforms.push(value.transforms[2]); },
    value => { value.development = { root: 'relative', mods: ['theme-icon'] }; },
    value => { value.development = { root: '/tmp/dev', mods: ['unknown-mod'] }; },
  ];
  for (const edit of edits) {
    const value = structuredClone(receipt);
    edit(value);
    assert.throws(() => metadataFor(both, value));
    withArchive({ 'modex.json': JSON.stringify({ schemaVersion: 2, mods: both, receipt: value }) }, archive => {
      assert.throws(() => readInstalledMods(archive));
    });
  }
});

test('shared authentication repair and development bootstrap can own transforms', () => {
  const value = structuredClone(receipt);
  value.transforms.push(
    {mod: 'app-tools-auth', name: 'native-auth', path: 'native.js', beforeHash: null, afterHash: '7'.repeat(64)},
    {mod: 'development', name: 'bootstrap', path: 'bootstrap.js', beforeHash: null, afterHash: '8'.repeat(64)},
  );
  assert.deepEqual(metadataFor(both, value).receipt.transforms, value.transforms);
});

test('development provenance preserves optional hook and known module hashes', () => {
  const value = structuredClone(receipt);
  value.development = {root: '/tmp/dev', mods: ['theme-icon'], hookHash: '7'.repeat(64), moduleHashes: {'theme-icon-render': '8'.repeat(64)}};
  assert.deepEqual(metadataFor(both, value).receipt.development, value.development);
  for (const invalid of [
    {...value.development, hookHash: 'invalid'},
    {...value.development, moduleHashes: {'unknown': '8'.repeat(64)}},
    {...value.development, moduleHashes: {'theme-icon-render': 'invalid'}},
    {...value.development, moduleHashes: {'model-spread': '8'.repeat(64)}},
  ]) assert.throws(() => metadataFor(both, {...value, development: invalid}));
});
