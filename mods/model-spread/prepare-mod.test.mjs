import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { hashFile, parseArgs, verifyBackup, main } from './prepare-mod.mjs';

async function fixture(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-spread-prepare-test-'));
  try {
    const source = path.join(directory, 'Test.app'),
      backup = path.join(directory, 'original.zip');
    fs.mkdirSync(path.join(source, 'Contents/Resources'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Contents/Resources/app.asar'), 'synthetic archive content');
    fs.writeFileSync(path.join(source, 'Contents/Info.plist'), 'synthetic version metadata');
    execFileSync('/usr/bin/zip', ['-qr', backup, 'Test.app'], { cwd: directory, stdio: 'pipe' });
    await fn({ source, backup, directory });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('prepare arguments require explicit output and do not silently accept unknown flags', () => {
  assert.deepEqual(parseArgs(['--output', '/tmp/Mod.app', '--check']), {
    source: '/Applications/ChatGPT.app',
    output: '/tmp/Mod.app',
    check: true,
  });
  assert.throws(() => parseArgs(['--launcher', '/tmp/Permanent.app']), /Unknown/);
  assert.throws(() => parseArgs(['--output']), /incomplete/);
  assert.throws(() => parseArgs(['--launch']), /Unknown/);
  assert.throws(() => parseArgs(['--backup', '/tmp/a.zip', '--backup', '/tmp/b.zip']), /Repeated/);
});

test('existing backup CRC and source ASAR/Info.plist fingerprints are verified without writing', async () =>
  fixture(async ({ source, backup }) => {
    const before = await hashFile(backup),
      report = await verifyBackup(backup, source);
    assert.equal(report.zipCRCVerified, true);
    assert.equal(
      report.sourceAsarHash,
      await hashFile(path.join(source, 'Contents/Resources/app.asar')),
    );
    assert.equal(await hashFile(backup), before);
  }));

test('a different source archive or metadata rejects backup reuse', async () =>
  fixture(async ({ source, backup }) => {
    fs.writeFileSync(path.join(source, 'Contents/Resources/app.asar'), 'changed version');
    await assert.rejects(verifyBackup(backup, source), /fingerprints do not match/);
    fs.writeFileSync(path.join(source, 'Contents/Resources/app.asar'), 'synthetic archive content');
    fs.writeFileSync(path.join(source, 'Contents/Info.plist'), 'changed metadata');
    await assert.rejects(verifyBackup(backup, source), /fingerprints do not match/);
  }));

test('corrupt ZIP is rejected before considering its fingerprints', async () =>
  fixture(async ({ source, backup }) => {
    fs.truncateSync(backup, fs.statSync(backup).size - 50);
    await assert.rejects(verifyBackup(backup, source), /unzip exited/);
  }));

test('prepare refuses an existing output before any source or backup operation', async () =>
  fixture(async ({ source }) => {
    await assert.rejects(
      main(['--output', source, '--source', '/does-not-exist.app']),
      /ENOENT|already exists/,
    );
    await assert.rejects(main(['--output', source, '--source', source]), /already exists/);
  }));
