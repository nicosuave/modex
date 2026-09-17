#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signingIdentity, validateAppIdentity, designatedRequirement } from './sign-app.mjs';
import { readArchive, readEntry } from './asar.mjs';
import {
  metadataPath,
  metadataFor,
  readInstalledMods,
  assertModSelection,
} from './mod-metadata.mjs';
import { verifyRepair } from '../mods/app-tools-auth/patch.mjs';
import { checkNativeBuild } from '../mods/app-tools-auth/build-native.mjs';
import { archiveModules } from './source-modules.mjs';
import { buildIdentity, recordChanges } from './build-receipt.mjs';
import { readOverlay } from './asar.mjs';
import { resolveBundlePaths, rewriteBundleNames } from './current-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(args) {
  const options = { source: '/Applications/ChatGPT.app' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (['--help', '--check', '--current-source'].includes(flag)) options[flag.slice(2)] = true;
    else if (
      ['--source', '--output', '--identity-from', '--dev-root'].includes(flag) &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    ) {
      const key = flag.slice(2);
      if (Object.hasOwn(options, key) && key !== 'source') throw Error(`Repeated ${flag}`);
      options[key] = args[++index];
    } else throw Error(`Unknown or incomplete argument: ${flag}`);
  }
  return options;
}
function contained(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
function realTarget(filename) {
  if (fs.existsSync(filename)) return fs.realpathSync(filename);
  return path.join(realTarget(path.dirname(filename)), path.basename(filename));
}
function command(executable, args) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function run(executable, args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', inherit ? 'inherit' : 'pipe', 'pipe'],
    });
    let error = '',
      output = '';
    child.stdout?.on('data', (data) => {
      if (output.length < 32768) output += data.toString();
    });
    child.stderr.on('data', (data) => {
      if (error.length < 32768) error += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(Error(`${path.basename(executable)} exited ${code}: ${error || output}`));
    });
  });
}
export async function hashFile(filename) {
  const digest = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(filename)) digest.update(bytes);
  return digest.digest('hex');
}
export function compatibilityResourcePath(name) {
  if (
    typeof name !== 'string' ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw Error(`Invalid compatibility filename: ${name}`);
  return name;
}
export function compatibilityEntryPath(name) {
  compatibilityResourcePath(name);
  if (!name.endsWith('.js')) throw Error(`Invalid compatibility filename: ${name}`);
  return name.includes('/') ? name : `webview/assets/${name}`;
}
export function inspectCompatibility(source, manifest, { currentSource = false } = {}) {
  const archive = readArchive(path.join(source, 'Contents/Resources/app.asar'));
  const info = JSON.parse(
    command('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(source, 'Contents/Info.plist'),
    ]),
  );
  if (
    !currentSource &&
    (info.CFBundleShortVersionString !== manifest.version ||
      info.CFBundleVersion !== manifest.build)
  )
    throw Error(
      `Unsupported app ${info.CFBundleShortVersionString} (${info.CFBundleVersion}); supported ${manifest.version} (${manifest.build}). Original app unchanged.`,
    );
  if (info.ElectronAsarIntegrity?.['Resources/app.asar']?.hash !== archive.headerHash)
    throw Error('Source ASAR header does not match Info.plist integrity');
  const bundles = new Map();
  const paths = currentSource
    ? resolveBundlePaths(archive, Object.keys(manifest.files).map(compatibilityEntryPath))
    : new Map();
  for (const [name, expected] of Object.entries(manifest.files)) {
    const entry = compatibilityEntryPath(name);
    const bytes = readEntry(archive, paths.get(entry) ?? entry);
    if (!currentSource && crypto.createHash('sha256').update(bytes).digest('hex') !== expected)
      throw Error(`Unsupported bundle ${name}; original app unchanged`);
    bundles.set(name, currentSource ? Buffer.from(rewriteBundleNames(bytes, paths)) : bytes);
  }
  const resourceRoot = fs.realpathSync(path.join(source, 'Contents/Resources'));
  for (const [name, expected] of Object.entries(manifest.resources ?? {})) {
    const filename = fs.realpathSync(path.join(resourceRoot, compatibilityResourcePath(name)));
    if (!contained(resourceRoot, filename))
      throw Error(`Compatibility resource escapes app resources: ${name}`);
    const bytes = fs.readFileSync(filename);
    if (!currentSource && crypto.createHash('sha256').update(bytes).digest('hex') !== expected)
      throw Error(`Unsupported resource ${name}; original app unchanged`);
  }
  return { info, archive, bundles, paths };
}
export async function sourceFingerprints(source) {
  const [sourceAsarHash, sourceInfoHash] = await Promise.all([
    hashFile(path.join(source, 'Contents/Resources/app.asar')),
    hashFile(path.join(source, 'Contents/Info.plist')),
  ]);
  return { sourceAsarHash, sourceInfoHash };
}

export async function assertSourceUnchanged(source, expected) {
  const actual = await sourceFingerprints(source);
  if (
    actual.sourceAsarHash !== expected.sourceAsarHash ||
    actual.sourceInfoHash !== expected.sourceInfoHash
  )
    throw Error('Original app changed during preparation; rerun against its new version');
}

export function validateIdentityContinuity(bundleId, requirement, signerName) {
  validateAppIdentity('Modex', bundleId);
  const team = signerName.match(/\(([A-Z0-9]+)\)$/)?.[1];
  const installedTeam = requirement.match(
    /certificate leaf\[subject\.OU\] = (?:"([A-Z0-9]+)"|([A-Z0-9]+))(?:\s|$)/,
  );
  if (
    !team ||
    !requirement.includes(`identifier "${bundleId}"`) ||
    (installedTeam?.[1] ?? installedTeam?.[2]) !== team
  )
    throw Error(
      'Selected signing certificate does not preserve the installed mod identity and team',
    );
}

export async function prepareMain(
  args = process.argv.slice(2),
  {
    modDirectory,
    overlayAtRoot = false,
    help,
    manifest: providedManifest,
    selectedMods,
    explicitSelection = true,
    legacyMarkers = {},
    buildOverlay,
  } = {},
) {
  const mod = JSON.parse(fs.readFileSync(path.join(modDirectory, 'mod.json'), 'utf8'));
  const options = parseArgs(args);
  if (options.help) return console.log(help);
  const mods = metadataFor(selectedMods ?? [mod.id]).mods;
  console.log(`Selected mods: ${mods.join(', ')}`);
  if (!process.versions.bun)
    throw Error('Run this helper with Bun: bun prepare-mod.mjs --output /absolute/path/Name.app');
  if (process.platform !== 'darwin') throw Error('Preparing the signed app copy requires macOS');
  if (!options.output || !path.isAbsolute(options.output) || !options.output.endsWith('.app'))
    throw Error('--output must be a NEW absolute .app path');
  const source = fs.realpathSync(options.source),
    output = realTarget(options.output);
  if (fs.existsSync(output)) throw Error(`Output already exists: ${output}`);
  if (contained(source, output) || contained(output, source))
    throw Error('Output must be separate from the original app');
  if (
    contained('/Applications', output) ||
    contained(path.join(os.homedir(), 'Applications'), output)
  )
    throw Error('Output must be outside Applications');
  let expectedRequirement = null;
  let installedMods = null,
    removedMods = [];
  const signer = signingIdentity();
  if (options['identity-from']) {
    const installed = fs.realpathSync(options['identity-from']);
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
    const installedInfo = JSON.parse(
      command('/usr/bin/plutil', [
        '-convert',
        'json',
        '-o',
        '-',
        path.join(installed, 'Contents/Info.plist'),
      ]),
    );
    mod.bundleId = installedInfo.CFBundleIdentifier;
    expectedRequirement = designatedRequirement(installed);
    validateIdentityContinuity(mod.bundleId, expectedRequirement, signer.name);
    installedMods = readInstalledMods(
      readArchive(path.join(installed, 'Contents/Resources/app.asar')),
      legacyMarkers,
    );
    removedMods = assertModSelection(installedMods, mods, explicitSelection);
  }
  validateAppIdentity(mod.appName, mod.bundleId);
  const manifest =
    providedManifest ??
    JSON.parse(fs.readFileSync(path.join(modDirectory, 'compatibility.json'), 'utf8'));
  const currentSource = options['current-source'] === true;
  const evidence = await sourceFingerprints(source);
  const { info, archive, bundles, paths } = inspectCompatibility(source, manifest, {
    currentSource,
  });
  if (options['dev-root']) {
    const { inspectDevelopmentForBuild } = await import('../mods/development/patch.mjs');
    inspectDevelopmentForBuild(options['dev-root'], mods, source, { currentSource });
  }
  verifyRepair(source, { currentSource });
  checkNativeBuild();
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
  await assertSourceUnchanged(source, evidence);
  if (options.check) {
    console.log(
      JSON.stringify(
        {
          checkOnly: true,
          mods,
          installedMods,
          removedMods,
          source,
          output,
          development: options['dev-root'] ?? null,
          bundleId: mod.bundleId,
          expectedRequirement,
          signer: signer.name,
          version: info.CFBundleShortVersionString,
          build: info.CFBundleVersion,
          sourceHeaderHash: archive.headerHash,
          compatibleBundles: bundles.size,
          ...evidence,
          launched: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log('Building and signing the separate app copy…');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-prepare-'));
  try {
    const input = path.join(temporary, 'bundles'),
      overlay = path.join(temporary, overlayAtRoot ? 'overlay' : 'overlay/webview/assets');
    fs.mkdirSync(input);
    for (const [name, bytes] of bundles) {
      const filename = path.join(input, name);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, bytes);
    }
    let transforms;
    if (buildOverlay)
      transforms = await buildOverlay(input, overlay, {
        currentSource,
        paths,
        sourceModules: archiveModules(archive),
      });
    else
      await run(process.execPath, [path.join(modDirectory, 'build-mod.mjs'), input, overlay], {
        inherit: true,
      });
    if (!transforms)
      transforms = recordChanges(
        mods[0],
        `${mods[0]} adapters`,
        new Map([...bundles].map(([name, bytes]) => [compatibilityEntryPath(name), bytes])),
        readOverlay(path.join(temporary, 'overlay')),
      );
    const receipt = {
      source: {
        version: info.CFBundleShortVersionString,
        build: info.CFBundleVersion,
        asarHash: evidence.sourceAsarHash,
      },
      build: buildIdentity(),
      transforms,
    };
    fs.writeFileSync(
      path.join(temporary, 'overlay', metadataPath),
      JSON.stringify(metadataFor(mods, receipt), null, 2) + '\n',
    );
    await assertSourceUnchanged(source, evidence);
    await run(
      process.execPath,
      [
        path.join(here, 'package-app.mjs'),
        '--source',
        source,
        '--overlay',
        path.join(temporary, 'overlay'),
        '--output',
        output,
        '--app-name',
        mod.appName,
        '--bundle-id',
        mod.bundleId,
        ...(options['dev-root'] ? ['--dev-root', options['dev-root']] : []),
        ...(currentSource ? ['--current-source'] : []),
      ],
      { inherit: true },
    );
    if (expectedRequirement && designatedRequirement(output) !== expectedRequirement)
      throw Error(
        'Packaged designated requirement differs from installed app; do not adopt this staged copy',
      );
    if (
      JSON.stringify(
        readInstalledMods(readArchive(path.join(output, 'Contents/Resources/app.asar'))),
      ) !== JSON.stringify(mods)
    )
      throw Error('Packaged mod selection differs from requested mods');
    await assertSourceUnchanged(source, evidence);

    console.log(
      JSON.stringify(
        {
          mods,
          installedMods,
          removedMods,
          source,
          output,
          bundleId: mod.bundleId,
          expectedRequirement,
          signer: signer.name,
          ...evidence,
          secondCopyCreated: true,
          originalModified: false,
          launched: false,
        },
        null,
        2,
      ),
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
