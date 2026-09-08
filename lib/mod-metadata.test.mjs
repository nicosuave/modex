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
