import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive, readEntry, entryFor, readOverlay, rewriteArchive, integrityForBuffer } from './asar.mjs';

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(directory) {
  const one = Buffer.from('first bundled file');
  const two = Buffer.from([0, 1, 2, 255, 100]);
  const header = { files: {
    'first.js': { size: one.length, offset: '0', integrity: integrityForBuffer(one), executable: true },
    assets: { files: { 'binary.bin': { size: two.length, offset: String(one.length), integrity: integrityForBuffer(two) } } },
    native: { files: { 'addon.node': { size: 3, unpacked: true, integrity: integrityForBuffer(Buffer.from('xyz')) } }, unpacked: true },
    alias: { link: 'first.js' },
  } };
  // Construct the fixture independently using the Chromium Pickle wire layout.
  const json = Buffer.from(JSON.stringify(header));
  const picklePayloadLength = Math.ceil((json.length + 4) / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(picklePayloadLength + 4, 4);
  prefix.writeUInt32LE(picklePayloadLength, 8);
  prefix.writeUInt32LE(json.length, 12);
  const filename = path.join(directory, 'source.asar');
  fs.writeFileSync(filename, Buffer.concat([prefix, json, Buffer.alloc(picklePayloadLength - 4 - json.length), one, two]));
  return { filename, header, one, two };
}
function temporary(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-spread-asar-test-'));
  try { return fn(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('roundtrip keeps packed bytes, links, unpacked metadata and source bytes', () => temporary((directory) => {
  const source = fixture(directory);
  const original = fs.readFileSync(source.filename);
  const output = path.join(directory, 'roundtrip.asar');
  rewriteArchive(source.filename, output, new Map());
  const archive = readArchive(output);
  assert.deepEqual(archive.header, source.header);
  assert.deepEqual(readEntry(archive, 'first.js'), source.one);
  assert.deepEqual(readEntry(archive, 'assets/binary.bin'), source.two);
  assert.deepEqual(fs.readFileSync(source.filename), original);
  assert.throws(() => readEntry(archive, 'native/addon.node'), /Not a packed file/);
}));

test('changed lengths, additions, empty files and multiple integrity blocks remain readable', () => temporary((directory) => {
  const source = fixture(directory);
  const replacement = Buffer.alloc(4 * 1024 * 1024 + 9, 42);
  const changes = new Map([
    ['first.js', replacement],
    ['new/nested.txt', Buffer.from('new content')],
    ['new/empty', Buffer.alloc(0)],
  ]);
  const output = path.join(directory, 'modified.asar');
  const report = rewriteArchive(source.filename, output, changes);
  const archive = readArchive(output);
  for (const [name, bytes] of changes) {
    assert.deepEqual(readEntry(archive, name), bytes);
    assert.deepEqual(entryFor(archive, name).integrity, integrityForBuffer(bytes));
  }
  assert.equal(entryFor(archive, 'assets/binary.bin').offset, String(replacement.length));
  assert.deepEqual(readEntry(archive, 'assets/binary.bin'), source.two);
  assert.equal(entryFor(archive, 'first.js').executable, true);
  assert.equal(entryFor(archive, 'first.js').integrity.blocks.length, 2);
  assert.equal(entryFor(archive, 'first.js').integrity.blocks[1], digest(Buffer.alloc(9, 42)));
  assert.equal(report.headerHash, digest(Buffer.from(JSON.stringify(archive.header))));
  assert.deepEqual(entryFor(archive, 'native/addon.node'), source.header.files.native.files['addon.node']);
}));

test('rejects traversal, unpacked replacement, directory replacement and self mutation', () => temporary((directory) => {
  const { filename } = fixture(directory);
  const output = path.join(directory, 'rejected.asar');
  for (const name of ['../bad', '/absolute', '__proto__/polluted', 'native/addon.node', 'alias', 'assets', 'first.js/nested']) {
    assert.throws(() => rewriteArchive(filename, output, new Map([[name, Buffer.from('invalid')]])));
    assert.equal(fs.existsSync(output), false);
  }
  assert.throws(() => rewriteArchive(filename, filename, new Map()), /must differ/);
}));

test('overlay recursively reads files and rejects symlinks', () => temporary((directory) => {
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested/file.js'), 'content');
  assert.deepEqual(readOverlay(directory).get('nested/file.js'), Buffer.from('content'));
  fs.symlinkSync(path.join(directory, 'nested/file.js'), path.join(directory, 'linked'));
  assert.throws(() => readOverlay(directory), /regular files/);
}));

test('rejects truncated input before publishing replacement archive', () => temporary((directory) => {
  const { filename } = fixture(directory);
  fs.truncateSync(filename, fs.statSync(filename).size - 2);
  const output = path.join(directory, 'truncated.asar');
  assert.throws(() => rewriteArchive(filename, output, new Map()), /Truncated/);
  assert.equal(fs.existsSync(output), false);
}));
