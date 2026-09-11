import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  findInstalledApp,
  processUsesApp,
  waitForExit,
  installStaged,
  updateMain,
  acquireUpdateLock,
} from './update-mod.mjs';

async function fixture(fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'modex-update-test-')));
  const app = path.join(root, 'Applications/Modex.app');
  const staged = path.join(root, 'staged/Modex.app');
  const previous = path.join(root, 'Previous.app');
  for (const [directory, value] of [
    [app, 'old'],
    [staged, 'new'],
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'payload'), value);
  }
  try {
    await fn({ root, app, staged, previous });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const payload = (app) => fs.readFileSync(path.join(app, 'payload'), 'utf8');
const installServices = {
  running: () => false,
  verify: (app) => assert.equal(payload(app), 'new'),
  copy: (from, to) => fs.cpSync(from, to, { recursive: true }),
};

for (const signal of ['SIGINT', 'SIGTERM'])
  test(`cancelling with ${signal} releases the update lock for the next run`, () =>
    fixture(async ({ root }) => {
      const moduleURL = new URL('./update-mod.mjs', import.meta.url).href;
      const child = spawn(
        process.execPath,
        [
          '-e',
          `import { acquireUpdateLock } from ${JSON.stringify(moduleURL)}; acquireUpdateLock(${JSON.stringify(root)}); console.log('ready'); setInterval(()=>{},1000);`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => resolve(code));
      });
      try {
        await new Promise((resolve, reject) => {
          child.stdout.once('data', resolve);
          child.once('error', reject);
          child.once('exit', () => reject(Error('Lock child exited before ready')));
        });
        assert.throws(() => acquireUpdateLock(root), /Another update/);
        child.kill(signal);
        assert.equal(await exited, signal === 'SIGINT' ? 130 : 143);
        const release = acquireUpdateLock(root);
        release();
        assert.equal(fs.existsSync(path.join(root, 'update.lock')), false);
      } finally {
        child.kill('SIGKILL');
        await exited;
      }
    }));

test('discovery accepts one actual installation and rejects ambiguity and symlinks', () =>
  fixture(({ root, app, staged }) => {
    assert.equal(findInstalledApp(undefined, [app, path.join(root, 'missing.app')]), app);
    assert.throws(() => findInstalledApp(undefined, [app, staged]), /multiple/);
    assert.throws(() => findInstalledApp(undefined, []), /zero/);
    const alias = path.join(root, 'Alias.app');
    fs.symlinkSync(app, alias);
    assert.throws(() => findInstalledApp(alias), /symlinks/);
  }));

test('process detection includes helpers and spaces without matching other apps or arguments', () => {
  const app = '/Applications/My Modex.app';
  for (const executable of [
    '/Contents/MacOS/Codex',
    '/Contents/Frameworks/Helper.app/Contents/MacOS/Helper',
  ])
    assert.equal(processUsesApp(`  ${app}${executable}\n`, app), true);
  assert.equal(
    processUsesApp('/Applications/My Modex.app.old/Contents/MacOS/Codex\n/bin/zsh', app),
    false,
  );
  assert.equal(processUsesApp(`/bin/echo ${app}/Contents/MacOS/Codex`, app), false);
});

test('waiting allows normal exit and times out without terminating anything', async () => {
  let time = 0,
    checks = 0;
  const clock = {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    log: () => {},
  };
  await waitForExit('/Modex.app', 10, { ...clock, running: () => ++checks < 3 });
  assert.equal(time, 2000);
  await assert.rejects(
    waitForExit('/Modex.app', 0, { ...clock, running: () => true }),
    /still running/,
  );
  await assert.rejects(
    waitForExit('/Modex.app', 1, {
      ...clock,
      running: () => {
        throw Error('ps failed');
      },
    }),
    /ps failed/,
  );
});

test('installation preserves old app and staged build and promotes verified new bytes', () =>
  fixture((paths) => {
    installStaged(paths, installServices);
    assert.equal(payload(paths.app), 'new');
    assert.equal(payload(paths.previous), 'old');
    assert.equal(payload(paths.staged), 'new');
  }));

for (const failure of ['running', 'reopened', 'copy', 'verify', 'promote'])
  test(`installation leaves the old app available when ${failure} fails`, () =>
    fixture((paths) => {
      let checks = 0;
      const services = {
        ...installServices,
        running: () => failure === 'running' || (failure === 'reopened' && ++checks > 1),
        copy: (from, to) => {
          if (failure === 'copy') throw Error('copy failed');
          installServices.copy(from, to);
        },
        verify: (app) => {
          if (failure === 'verify') throw Error('verify failed');
          installServices.verify(app);
        },
        rename: (from, to) => {
          if (failure === 'promote' && to === paths.app) throw Error('promote failed');
          fs.renameSync(from, to);
        },
      };
      // Permit restoring the original after simulating one promotion failure.
      if (failure === 'promote')
        services.rename = (from, to) => {
          if (to === paths.app && from !== paths.previous) throw Error('promote failed');
          fs.renameSync(from, to);
        };
      assert.throws(() => installStaged(paths, services));
      assert.equal(payload(paths.app), 'old');
      assert.equal(payload(paths.staged), 'new');
    }));

test('existing previous app is never overwritten', () =>
  fixture((paths) => {
    fs.mkdirSync(paths.previous);
    assert.throws(() => installStaged(paths, installServices), /already exists/);
    assert.equal(payload(paths.app), 'old');
  }));

test('update reuses installed mods and development root through verification and preparation', () =>
  fixture(async ({ app, root }) => {
    const calls = [];
    const result = await updateMain(
      ['--app', app, '--source', '/Stock.app', '--backup', '/Original.zip'],
      {
        root: path.join(root, 'updates'),
        verifyApp: () => ({
          mods: ['task-panes', 'theme-icon'],
          metadata: { receipt: { development: { root: '/modules' } } },
        }),
        fingerprint: async () => 'original',
        requirement: () => 'same identity',
        run: async (args) => {
          calls.push(args);
        },
        waitForExit: async () => {
          calls.push(['wait']);
        },
        installStaged: () => {
          calls.push(['install-staged']);
        },
      },
    );
    assert.equal(result.installed, true);
    assert.deepEqual(
      calls.map((args) => (args[0] === 'modex.mjs' ? args[1] : args[0])),
      ['install', 'prepare', 'verify', 'prepare', 'wait', 'install-staged'],
    );
    for (const args of calls.filter((args) => args[0] === 'modex.mjs')) {
      assert.equal(args[args.indexOf('--mods') + 1], 'theme-icon,task-panes');
      assert.equal(args[args.indexOf('--dev-root') + 1], '/modules');
    }
    assert.equal(fs.existsSync(path.join(root, 'updates/update.lock')), false);
  }));

for (const mode of [
  '--check',
  '--stage-only',
  'verify-failure',
  'changed-install',
  'changed-identity',
])
  test(`update ${mode} never installs or stops an app`, () =>
    fixture(async ({ app, root }) => {
      let installed = false,
        waited = false,
        fingerprints = 0;
      const calls = [];
      const operation = updateMain(['--app', app, ...(mode.startsWith('--') ? [mode] : [])], {
        root: path.join(root, 'updates'),
        verifyApp: () => ({ mods: ['task-panes'] }),
        fingerprint: async () => (mode === 'changed-install' ? String(fingerprints++) : 'same'),
        requirement: (target) => (mode === 'changed-identity' ? target : 'same'),
        run: async (args) => {
          calls.push(args);
          if (mode === 'verify-failure' && args[1] === 'verify') throw Error('unsupported');
        },
        waitForExit: async () => {
          waited = true;
        },
        installStaged: () => {
          installed = true;
        },
      });
      if (mode.startsWith('--')) await operation;
      else await assert.rejects(operation);
      assert.equal(installed, false);
      if (mode === '--check') {
        assert.equal(calls.length, 1);
        assert.equal(calls[0].at(-1), '--check');
        assert.equal(fs.existsSync(path.join(root, 'updates')), false);
      }
      if (mode.startsWith('--') || mode === 'verify-failure') assert.equal(waited, false);
    }));
