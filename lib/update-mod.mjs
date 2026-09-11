import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readStatus } from './status.mjs';
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
  return fs.realpathSync(app);
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

function verifyApp(app) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const status = readStatus(app, { legacyMarkers });
  if (status.receiptStatus === 'mismatch') throw Error(`Build receipt mismatch: ${app}`);
  return status;
}

function realOutputPath(output) {
  if (fs.existsSync(output)) return fs.realpathSync(output);
  return path.join(realOutputPath(path.dirname(output)), path.basename(output));
}

export async function updateMain(args, overrides = {}) {
  if (process.platform !== 'darwin' || !process.versions.bun)
    throw Error('Updating Modex requires macOS and Bun.');
  const values = Object.fromEntries(
    args.flatMap((flag, index) =>
      flag.startsWith('--') ? [[flag, flag === '--check' ? true : args[index + 1]]] : [],
    ),
  );
  const services = { run, verifyApp, requirement: designatedRequirement, ...overrides };
  const app = findInstalledApp(values['--app'], services.candidates);
  const status = services.verifyApp(app);
  const mods = selectMods(status.mods);
  const requirement = services.requirement(app);
  const source = values['--source'] ?? '/Applications/ChatGPT.app';
  const devRoot = status.metadata?.receipt?.development?.root;
  const root = services.root ?? path.join(repository, 'work/updates');
  const staged =
    values['--output'] ??
    path.join(root, `update-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, 'Modex.app');
  if (!path.isAbsolute(staged) || !staged.endsWith('.app') || fs.existsSync(staged))
    throw Error('--output must be a new absolute .app path');
  const realOutput = realOutputPath(staged);
  if (realOutput === app || realOutput.startsWith(`${app}${path.sep}`))
    throw Error('--output must be separate from the installed app');
  const common = [
    '--current-source',
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
    `Building a new Modex copy with ${mods.join(', ')}${devRoot ? `; development modules: ${devRoot}` : ''}`,
  );
  if (values['--check']) {
    await services.run([...prepare, '--check']);
    return { app, staged, checkOnly: true };
  }
  try {
    await services.run(['install', '--frozen-lockfile']);
    await services.run([...prepare, '--check']);
    await services.run(['modex.mjs', 'verify', ...common]);
    await services.run(prepare);
    services.verifyApp(staged);
    if (services.requirement(staged) !== requirement)
      throw Error('New copy does not match the installed signing identity.');
    console.log(`Verified new app: ${staged}\nInstalled app unchanged: ${app}`);
    return { app, staged, installed: false };
  } catch (error) {
    if (fs.existsSync(staged))
      console.error(`New copy retained at ${staged}; it may be incomplete if packaging failed.`);
    throw error;
  }
}
