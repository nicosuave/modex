import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs, main } from './prepare-mod.mjs';
import { sourceFingerprints, assertSourceUnchanged } from '../../lib/prepare-mod.mjs';

async function fixture(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-spread-prepare-test-'));
  try {
    const source = path.join(directory, 'Test.app');
    fs.mkdirSync(path.join(source, 'Contents/Resources'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Contents/Resources/app.asar'), 'synthetic archive content');
    fs.writeFileSync(path.join(source, 'Contents/Info.plist'), 'synthetic version metadata');
    await fn({ source, directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('prepare arguments require explicit output and reject removed backup options', () => {
  assert.deepEqual(parseArgs(['--output', '/tmp/Mod.app', '--check']), {
    source: '/Applications/ChatGPT.app',
    output: '/tmp/Mod.app',
    check: true,
  });
  assert.throws(() => parseArgs(['--launcher', '/tmp/Permanent.app']), /Unknown/);
  assert.throws(() => parseArgs(['--output']), /incomplete/);
  assert.throws(() => parseArgs(['--launch']), /Unknown/);
  assert.throws(() => parseArgs(['--backup', '/tmp/a.zip']), /Unknown/);
});

test('source fingerprints need no backup and preserve existing files', async () =>
  fixture(async ({ source, directory }) => {
    const existing = path.join(directory, 'Original.zip');
    fs.writeFileSync(existing, 'existing backup is not read or modified');
    const report = await sourceFingerprints(source);
    assert.match(report.sourceAsarHash, /^[a-f0-9]{64}$/);
    assert.match(report.sourceInfoHash, /^[a-f0-9]{64}$/);
    await assertSourceUnchanged(source, report);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['Original.zip', 'Test.app']);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'existing backup is not read or modified');
  }));

for (const filename of ['Contents/Resources/app.asar', 'Contents/Info.plist'])
  test(`source changes are detected without a backup: ${filename}`, async () =>
    fixture(async ({ source }) => {
      const report = await sourceFingerprints(source);
      fs.writeFileSync(path.join(source, filename), 'changed source');
      await assert.rejects(assertSourceUnchanged(source, report), /Original app changed/);
    }));

test('missing source bytes cannot produce a fingerprint', async () =>
  fixture(async ({ source }) => {
    fs.unlinkSync(path.join(source, 'Contents/Resources/app.asar'));
    await assert.rejects(sourceFingerprints(source), /ENOENT/);
  }));

test('prepare refuses an existing output before modifying the source', async () =>
  fixture(async ({ source }) => {
    await assert.rejects(
      main(['--output', source, '--source', '/does-not-exist.app']),
      /ENOENT|already exists/,
    );
    await assert.rejects(main(['--output', source, '--source', source]), /already exists/);
  }));
