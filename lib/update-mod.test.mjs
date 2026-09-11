import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findInstalledApp, updateMain } from './update-mod.mjs';

async function fixture(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'modex-update-test-')));
  const app = path.join(root, 'Applications/Modex.app');
  const source = path.join(root, 'Stock.app');
  for (const directory of [app, source]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'payload'), 'original');
  }
  const calls = [];
  const verified = [];
  const services = {
    root: path.join(root, 'updates'),
    candidates: [app],
    verifyApp(target) {
      verified.push(target);
      return { mods: ['task-panes', 'custom-cli'], metadata: null };
    },
    requirement: () => 'installed signing identity',
    async run(args) {
      calls.push(args);
      if (args[1] === 'prepare' && !args.includes('--check')) {
        const output = args[args.indexOf('--output') + 1];
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(path.join(output, 'payload'), 'new copy');
      }
    },
  };
  try {
    await fn({ root, app, source, calls, verified, services });
    for (const directory of [app, source])
      assert.equal(fs.readFileSync(path.join(directory, 'payload'), 'utf8'), 'original');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const option = (args, flag) => args[args.indexOf(flag) + 1];

test('discovery requires one installation or an explicit existing app', () =>
  fixture(({ root, app, source }) => {
    assert.equal(findInstalledApp(undefined, [app, path.join(root, 'missing.app')]), app);
    assert.equal(findInstalledApp(app, [app, source]), app);
    assert.throws(() => findInstalledApp(undefined, [app, source]), /multiple/);
    assert.throws(() => findInstalledApp(undefined, []), /zero/);
    assert.throws(() => findInstalledApp('relative.app'), /absolute/);
  }));

test('update builds a separate signed copy with installed mods and current-source flags', () =>
  fixture(async ({ app, source, root, services, calls, verified }) => {
    const result = await updateMain(['--source', source], services);
    assert.equal(result.app, app);
    assert.equal(result.installed, false);
    assert.ok(result.staged.startsWith(path.join(root, 'updates/update-')));
    assert.equal(fs.readFileSync(path.join(result.staged, 'payload'), 'utf8'), 'new copy');
    assert.deepEqual(verified, [app, result.staged]);
    assert.deepEqual(
      calls.map((args) => args.slice(0, 2)),
      [
        ['install', '--frozen-lockfile'],
        ['modex.mjs', 'prepare'],
        ['modex.mjs', 'verify'],
        ['modex.mjs', 'prepare'],
      ],
    );
    for (const args of calls.slice(1)) {
      assert.ok(args.includes('--current-source'));
      assert.equal(option(args, '--mods'), 'task-panes,custom-cli');
      assert.equal(option(args, '--source'), source);
    }
    for (const args of [calls[1], calls[3]]) {
      assert.equal(option(args, '--identity-from'), app);
      assert.equal(option(args, '--output'), result.staged);
    }
    assert.ok(calls[1].includes('--check'));
    assert.ok(!calls[3].includes('--check'));
  }));

test('explicit output, backup and installed development configuration are forwarded', () =>
  fixture(async ({ app, root, services, calls }) => {
    const output = path.join(root, 'chosen/Modex.app');
    const backup = path.join(root, 'Original.zip');
    const devRoot = path.join(root, 'modules');
    services.verifyApp = () => ({
      mods: ['theme-icon'],
      metadata: { receipt: { development: { root: devRoot } } },
    });
    const result = await updateMain(
      ['--app', app, '--output', output, '--backup', backup],
      services,
    );
    assert.equal(result.staged, output);
    for (const args of calls.slice(1)) {
      assert.equal(option(args, '--dev-root'), devRoot);
      assert.equal(option(args, '--mods'), 'theme-icon');
    }
    for (const args of [calls[1], calls[3]]) assert.equal(option(args, '--backup'), backup);
  }));

test('check performs only read-only current-source preparation checks', () =>
  fixture(async ({ root, services, calls }) => {
    const result = await updateMain(['--check'], services);
    assert.equal(result.checkOnly, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--current-source'));
    assert.ok(calls[0].includes('--check'));
    assert.equal(fs.existsSync(path.join(root, 'updates')), false);
  }));

test('output must be new and absolute, preserving existing copies', () =>
  fixture(async ({ app, root, services, calls }) => {
    for (const output of [app, 'relative.app', path.join(root, 'not-an-app')])
      await assert.rejects(updateMain(['--output', output], services), /new absolute/);
    await assert.rejects(
      updateMain(['--output', path.join(app, 'Contents/New.app')], services),
      /separate from the installed app/,
    );
    const alias = path.join(root, 'installed-alias');
    fs.symlinkSync(app, alias);
    await assert.rejects(
      updateMain(['--output', path.join(alias, 'New.app')], services),
      /separate from the installed app/,
    );
    assert.equal(calls.length, 0);
  }));

for (const failedStep of [0, 1, 2, 3])
  test(`failure at build step ${failedStep + 1} stops without modifying either original app`, () =>
    fixture(async ({ services, calls }) => {
      const run = services.run;
      services.run = async (args) => {
        if (calls.length === failedStep) throw Error('build failed');
        await run(args);
      };
      await assert.rejects(updateMain([], services), /build failed/);
      assert.equal(calls.length, failedStep);
    }));

test('a final signature or identity failure retains the new copy and both originals', () =>
  fixture(async ({ app, root, services }) => {
    const output = path.join(root, 'failed/Modex.app');
    services.requirement = (target) =>
      target === app ? 'original identity' : 'different identity';
    await assert.rejects(updateMain(['--output', output], services), /signing identity/);
    assert.equal(fs.readFileSync(path.join(output, 'payload'), 'utf8'), 'new copy');
    const another = path.join(root, 'failed-signature/Modex.app');
    services.verifyApp = (target) => {
      if (target !== app) throw Error('signature invalid');
      return { mods: ['task-panes'] };
    };
    await assert.rejects(updateMain(['--output', another], services), /signature invalid/);
    assert.equal(fs.readFileSync(path.join(another, 'payload'), 'utf8'), 'new copy');
  }));
