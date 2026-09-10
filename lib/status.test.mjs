import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { rewriteArchive } from './asar.mjs';
import { metadataFor } from './mod-metadata.mjs';
import { readStatus } from './status.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const mods = ['theme-icon'];
function receipt() {
  return metadataFor(mods, {
    source: { version: '26.901.51231', build: '51231', asarHash: hash('stock archive') },
    build: { revision: 'a'.repeat(40), dirty: false, sourceHash: hash('mod source') },
    transforms: [
      {
        mod: 'theme-icon',
        name: 'first',
        path: 'renderer.js',
        beforeHash: hash('stock'),
        afterHash: hash('intermediate'),
      },
      {
        mod: 'theme-icon',
        name: 'second',
        path: 'renderer.js',
        beforeHash: hash('intermediate'),
        afterHash: hash('final'),
      },
      {
        mod: 'theme-icon',
        name: 'runtime',
        path: 'modex/runtime.cjs',
        beforeHash: null,
        afterHash: hash('runtime'),
      },
    ],
  });
}
function withApp(entries, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-status-test-'));
  try {
    const app = path.join(directory, 'Test.app');
    const resource = path.join(app, 'Contents', 'Resources');
    fs.mkdirSync(resource, { recursive: true });
    const json = Buffer.from('{"files":{}}');
    const payloadLength = Math.ceil((json.length + 4) / 4) * 4;
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(payloadLength + 4, 4);
    prefix.writeUInt32LE(payloadLength, 8);
    prefix.writeUInt32LE(json.length, 12);
    const seed = path.join(directory, 'seed.asar');
    fs.writeFileSync(
      seed,
      Buffer.concat([prefix, json, Buffer.alloc(payloadLength - 4 - json.length)]),
    );
    const filename = path.join(resource, 'app.asar');
    rewriteArchive(
      seed,
      filename,
      new Map(Object.entries(entries).map(([name, bytes]) => [name, Buffer.from(bytes)])),
    );
    callback(app, filename);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
function packaged(extra = {}) {
  return {
    'modex.json': JSON.stringify(receipt()),
    'renderer.js': 'final',
    'modex/runtime.cjs': 'runtime',
    ...extra,
  };
}

test('status validates final composed output and leaves the installed archive unchanged', () =>
  withApp(packaged(), (app, filename) => {
    const before = fs.readFileSync(filename);
    const status = readStatus(app);
    assert.equal(status.receiptStatus, 'verified');
    assert.deepEqual(status.metadata, receipt());
    assert.deepEqual(status.mods, mods);
    assert.equal(status.files.length, 2);
    assert.equal(status.files[0].expectedHash, hash('final'));
    assert.ok(status.files.every((file) => file.status === 'match'));
    assert.deepEqual(fs.readFileSync(filename), before);
  }));

test('status identifies modified files without losing the receipt', () =>
  withApp(packaged({ 'renderer.js': 'changed' }), (app) => {
    const status = readStatus(app);
    assert.equal(status.receiptStatus, 'mismatch');
    assert.equal(status.files[0].status, 'mismatch');
    assert.equal(status.files[0].actualHash, hash('changed'));
    assert.equal(status.files[1].status, 'match');
    assert.deepEqual(status.metadata, receipt());
  }));

test('status reports missing receipt files', () => {
  const entries = packaged();
  delete entries['modex/runtime.cjs'];
  withApp(entries, (app) => {
    const status = readStatus(app);
    assert.equal(status.receiptStatus, 'mismatch');
    assert.equal(status.files[1].status, 'missing');
    assert.equal(status.files[1].actualHash, null);
  });
});

test('schema1 and legacy apps have unavailable evidence, not invalid receipts', () => {
  withApp({ 'modex.json': JSON.stringify(metadataFor(mods)) }, (app) => {
    assert.equal(readStatus(app).receiptStatus, 'unavailable');
    assert.deepEqual(readStatus(app).mods, mods);
  });
  withApp({ 'legacy/theme.json': '{}' }, (app) => {
    const status = readStatus(app, { legacyMarkers: { 'theme-icon': 'legacy/theme.json' } });
    assert.equal(status.receiptStatus, 'unavailable');
    assert.deepEqual(status.mods, mods);
    assert.equal(status.metadata, null);
  });
  withApp({ 'stock.js': '' }, (app) => {
    assert.equal(readStatus(app).receiptStatus, 'unavailable');
    assert.deepEqual(readStatus(app).mods, []);
  });
});

test('malformed receipts fail explicitly instead of passing as legacy', () =>
  withApp({ 'modex.json': '{' }, (app) => {
    assert.throws(() => readStatus(app));
  }));

test('status requires an explicit absolute app path', () => {
  for (const app of [undefined, '', 'Test.app']) assert.throws(() => readStatus(app));
});

function withDevelopment(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-status-dev-'));
  try {
    // Deliberately non-executable content proves status inspects bytes only.
    const bytes = 'throw new Error("status must never execute this");';
    fs.writeFileSync(path.join(root, 'render.cjs'), bytes);
    fs.writeFileSync(path.join(root, 'runtime.js'), bytes);
    const manifest = {
      schemaVersion: 1,
      hookHash: hash('hooks'),
      mods,
      source: receipt().receipt.source,
      modules: {
        'theme-icon-render': { file: 'render.cjs', hash: hash(bytes) },
        'theme-icon-runtime': { file: 'runtime.js', hash: hash(bytes) },
      },
    };
    const publish = () =>
      fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    publish();
    const development = {
      root,
      mods,
      hookHash: manifest.hookHash,
      moduleHashes: Object.fromEntries(
        Object.entries(manifest.modules).map(([id, entry]) => [id, entry.hash]),
      ),
    };
    const entries = packaged({
      'modex.json': JSON.stringify(metadataFor(mods, { ...receipt().receipt, development })),
    });
    callback({ root, manifest, publish, entries, development });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('status reports configured development bytes without executing or modifying them', () =>
  withDevelopment(({ root, entries }) =>
    withApp(entries, (app) => {
      const before = fs.readFileSync(path.join(root, 'manifest.json'));
      const result = readStatus(app);
      assert.equal(result.development.status, 'ready');
      assert.ok(
        result.development.modules.every((module) => module.changedSincePackaging === false),
      );
      assert.deepEqual(fs.readFileSync(path.join(root, 'manifest.json')), before);
    }),
  ));

test('status recognizes rebuilt external modules independently of packaged files', () =>
  withDevelopment(({ root, manifest, publish, entries }) =>
    withApp(entries, (app) => {
      fs.writeFileSync(path.join(root, 'render.cjs'), 'updated');
      manifest.modules['theme-icon-render'].hash = hash('updated');
      publish();
      const result = readStatus(app);
      assert.equal(result.receiptStatus, 'verified');
      assert.equal(result.development.status, 'ready');
      assert.deepEqual(
        result.development.modules.map((module) => module.changedSincePackaging),
        [true, false],
      );
    }),
  ));

test('status distinguishes missing development root from incompatible hooks and modified module bytes', () =>
  withDevelopment(({ root, manifest, publish, entries }) =>
    withApp(entries, (app) => {
      manifest.hookHash = hash('different hooks');
      publish();
      assert.equal(readStatus(app).development.status, 'incompatible');
      manifest.hookHash = hash('hooks');
      publish();
      fs.writeFileSync(path.join(root, 'render.cjs'), 'unrecorded changes');
      assert.equal(readStatus(app).development.status, 'incompatible');
      fs.rmSync(root, { recursive: true });
      assert.equal(readStatus(app).development.status, 'unavailable');
    }),
  ));

test('development provenance remains optional and unknown comparisons are explicit', () =>
  withDevelopment(({ development }) => {
    const withoutHashes = { ...development };
    delete withoutHashes.moduleHashes;
    withApp(
      packaged({
        'modex.json': JSON.stringify(
          metadataFor(mods, { ...receipt().receipt, development: withoutHashes }),
        ),
      }),
      (app) => {
        assert.ok(
          readStatus(app).development.modules.every(
            (module) => module.changedSincePackaging === null,
          ),
        );
      },
    );
    delete withoutHashes.hookHash;
    withApp(
      packaged({
        'modex.json': JSON.stringify(
          metadataFor(mods, { ...receipt().receipt, development: withoutHashes }),
        ),
      }),
      (app) => {
        assert.equal(readStatus(app).development.status, 'unavailable');
      },
    );
    withApp(packaged(), (app) => assert.equal(readStatus(app).development, null));
  }));
