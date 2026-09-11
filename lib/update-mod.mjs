import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readStatus } from './status.mjs';
import { hashFile } from './prepare-mod.mjs';
import { designatedRequirement } from './sign-app.mjs';
import { selectMods, legacyMarkers } from '../mods/combined/compatibility.mjs';

const repository = path.resolve(import.meta.dirname, '..');

export function findInstalledApp(
  explicit,
  candidates = ['/Applications/Modex.app', path.join(os.homedir(), 'Applications/Modex.app')],
) {
  const found = explicit ? [explicit] : candidates.filter((app) => fs.existsSync(app));
  if (found.length !== 1)
    throw Error(
      'Specify --app with the installed Modex path; found zero or multiple installations.',
    );
  const app = found[0];
  if (!path.isAbsolute(app) || !app.endsWith('.app') || !fs.statSync(app).isDirectory())
    throw Error('--app must name an existing absolute .app directory');
  // Replacing a symlink or an ancestor alias could update a different app.
  if (fs.realpathSync(app) !== app)
    throw Error('Use the real installed app path, without symlinks.');
  return app;
}

export function processUsesApp(output, app) {
  const prefix = `${app}/Contents/`;
  return output.split('\n').some((line) => line.trim().startsWith(prefix));
}

function isRunning(app) {
  // comm reports the executable path, without confusing command arguments with
  // executable names. Include helpers so a half-closed Electron app still waits.
  return processUsesApp(execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' }), app);
}

export async function waitForExit(
  app,
  seconds,
  {
    running = isRunning,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    log = console.log,
  } = {},
) {
  const deadline = now() + seconds * 1000;
  let notified = false;
  while (running(app)) {
    if (!notified)
      log(
        `Build ready. Close ${app} when your work is finished; waiting up to ${seconds} seconds.`,
      );
    notified = true;
    if (now() >= deadline) throw Error('Modex is still running. Installation was not started.');
    await sleep(Math.min(1000, deadline - now()));
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repository, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) =>
      code === 0 ? resolve() : reject(Error(`bun ${args[0]} failed (${signal ?? code})`)),
    );
  });
}

export function acquireUpdateLock(root) {
  const lock = path.join(root, 'update.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw Error(
        `Another update owns ${lock}. If its recorded PID is no longer running, remove that stale lock and retry.`,
      );
    throw error;
  }
  fs.writeFileSync(fd, String(process.pid));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    fs.closeSync(fd);
    fs.unlinkSync(lock);
    process.removeListener('exit', release);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  };
  const interrupt = () => process.exit(130);
  const terminate = () => process.exit(143);
  process.once('exit', release);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  return release;
}

function verifyApp(app) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const status = readStatus(app, { legacyMarkers });
  if (status.receiptStatus === 'mismatch') throw Error(`Build receipt mismatch: ${app}`);
  return status;
}

async function fingerprint(app) {
  const [archive, info] = await Promise.all([
    hashFile(path.join(app, 'Contents/Resources/app.asar')),
    hashFile(path.join(app, 'Contents/Info.plist')),
  ]);
  return `${archive}:${info}`;
}

// All copying and verification finish before moving the installed app. Both
// renames are on the same volume, and a failed promotion restores the old path.
export function installStaged(
  { app, staged, previous },
  {
    running = isRunning,
    verify = verifyApp,
    copy = (from, to) => execFileSync('/usr/bin/ditto', [from, to]),
    rename = fs.renameSync,
  } = {},
) {
  if (fs.existsSync(previous)) throw Error(`Previous-app destination already exists: ${previous}`);
  if (fs.statSync(path.dirname(app)).dev !== fs.statSync(path.dirname(previous)).dev)
    throw Error('Installation and backup must be on the same volume; staged app preserved.');
  if (running(app)) throw Error('Modex reopened; installation was not started.');
  const incomingRoot = fs.mkdtempSync(path.join(path.dirname(app), '.modex-update-'));
  const incoming = path.join(incomingRoot, path.basename(app));
  try {
    copy(staged, incoming);
    verify(incoming);
    if (running(app)) throw Error('Modex reopened; installation was not started.');
    rename(app, previous);
    try {
      rename(incoming, app);
    } catch (error) {
      // Do not overwrite a concurrently created destination.
      if (!fs.existsSync(app)) rename(previous, app);
      throw error;
    }
  } finally {
    // Only this command's disposable incoming copy is removed.
    fs.rmSync(incomingRoot, { recursive: true, force: true });
  }
}

export async function updateMain(args, overrides = {}) {
  if (process.platform !== 'darwin') throw Error('Updating Modex requires macOS and Bun.');
  const values = Object.fromEntries(
    args.flatMap((flag, index) =>
      flag.startsWith('--')
        ? [[flag, ['--check', '--stage-only'].includes(flag) ? true : args[index + 1]]]
        : [],
    ),
  );
  const seconds = Number(values['--wait-seconds'] ?? 600);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)
    throw Error('--wait-seconds must be between 0 and 86400');
  const services = {
    run,
    verifyApp,
    fingerprint,
    waitForExit,
    installStaged,
    requirement: designatedRequirement,
    ...overrides,
  };
  const app = findInstalledApp(values['--app'], services.candidates);
  const status = services.verifyApp(app);
  const mods = selectMods(status.mods);
  if (!mods.length) throw Error('Cannot determine installed mods.');
  const original = await services.fingerprint(app);
  const source = values['--source'] ?? '/Applications/ChatGPT.app';
  const devRoot = status.metadata?.receipt?.development?.root;
  const root = services.root ?? path.join(repository, 'work/updates');
  const outputRoot = path.join(
    root,
    `update-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  const staged = path.join(outputRoot, 'Modex.app');
  const previous = path.join(outputRoot, 'Previous.app');
  const common = [
    '--mods',
    mods.join(','),
    '--source',
    source,
    ...(devRoot ? ['--dev-root', devRoot] : []),
  ];
  const prepare = [
    'modex.mjs',
    'prepare',
    ...common,
    '--identity-from',
    app,
    '--output',
    staged,
    ...(values['--backup'] ? ['--backup', values['--backup']] : []),
  ];
  console.log(
    `Updating ${app} with ${mods.join(', ')}${devRoot ? `; development modules: ${devRoot}` : ''}`,
  );
  if (values['--check']) {
    await services.run([...prepare, '--check']);
    return { app, staged, checkOnly: true };
  }
  fs.mkdirSync(root, { recursive: true });
  const release = acquireUpdateLock(root);
  try {
    await services.run(['install', '--frozen-lockfile']);
    await services.run([...prepare, '--check']);
    await services.run(['modex.mjs', 'verify', ...common]);
    await services.run(prepare);
    services.verifyApp(staged);
    console.log(`Verified staged app: ${staged}`);
    if (values['--stage-only']) return { app, staged, installed: false };
    await services.waitForExit(app, seconds);
    if ((await services.fingerprint(app)) !== original)
      throw Error('Installed app changed during the build; staged app preserved.');
    services.verifyApp(app);
    if (services.requirement(staged) !== services.requirement(app))
      throw Error('Staged app no longer matches the installed signing identity.');
    services.installStaged({ app, staged, previous });
    console.log(
      `Installed: ${app}\nPrevious app: ${previous}\nReopen Modex when ready. No app was launched or quit.`,
    );
    return { app, staged, previous, installed: true };
  } catch (error) {
    if (fs.existsSync(staged))
      console.error(`Staged app retained at ${staged}; it may be incomplete if packaging failed.`);
    throw error;
  } finally {
    release();
  }
}
