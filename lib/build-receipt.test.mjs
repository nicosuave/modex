import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordChanges, sha256, buildIdentity } from './build-receipt.mjs';
import { metadataFor } from './mod-metadata.mjs';

test('records shared-file composition as a verifiable hash chain, excluding receipt recursion', () => {
  const first = { 'main.js': 'stock' },
    second = { 'main.js': 'first', 'added.mjs': 'module' },
    third = { 'main.js': 'second', 'added.mjs': 'module', 'modex.json': 'metadata' };
  const transforms = [
    ...recordChanges('model-spread', 'composer', first, second),
    ...recordChanges('theme-icon', 'icon', second, third),
  ];
  assert.equal(transforms.length, 3);
  const metadata = metadataFor(['model-spread', 'theme-icon'], {
    source: { version: '1', build: '2', asarHash: sha256('stock') },
    build: { revision: null, dirty: null, sourceHash: sha256('source') },
    transforms,
  });
  assert.equal(metadata.receipt.transforms.at(-1).beforeHash, sha256('first'));
  assert.equal(metadata.receipt.transforms.at(-1).afterHash, sha256('second'));
});

test('source ZIP identity changes with source bytes without depending on Git or timestamps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-receipt-source-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.mkdirSync(path.join(root, 'mods'));
    const file = path.join(root, 'lib', 'module.mjs');
    fs.writeFileSync(file, 'export const n=1;');
    const first = buildIdentity(root);
    assert.equal(first.revision, null);
    assert.equal(first.dirty, null);
    assert.deepEqual(buildIdentity(root), first);
    fs.writeFileSync(file, 'export const n=2;');
    assert.notEqual(buildIdentity(root).sourceHash, first.sourceHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
