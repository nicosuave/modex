#!/usr/bin/env bun
import fs from 'node:fs';
import { signApp, signingIdentity, validateAppIdentity } from './sign-app.mjs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  readArchive,
  readOverlay,
  rewriteArchive,
  readEntry,
  entryFor,
  integrityForBuffer,
} from './asar.mjs';
import { repairOverlay, nativeName } from '../mods/app-tools-auth/patch.mjs';
import { buildNative, checkNativeBuild } from '../mods/app-tools-auth/build-native.mjs';
import { metadataPath, metadataFor } from './mod-metadata.mjs';
import { recordChanges } from './build-receipt.mjs';

const help = `Usage: bun package-app.mjs --source /Applications/ChatGPT.app --overlay DIRECTORY --output /absolute/path/Modex.app --app-name NAME --bundle-id local.codex.mod-name [--inspect] [--unsigned]

Creates a NEW staged copy only; refuses an existing output. Never launches, installs,
changes the original app, copies user data, or changes Electron fuses.

Default signing: use your installed Developer ID Application certificate, preserve nested signatures, keep
runtime permission entitlements and allow JIT, add disable-library-validation for
the original vendor-signed framework, and remove vendor identity, keychain, app
group and push entitlements that a different signing identity cannot legitimately hold.
The staged copy is not notarized and cannot be assumed to retain account/keychain,
notifications, computer-use or other macOS permission access.

--inspect validates inputs and displays planned operations without writing.
--unsigned emits a staged bundle with an invalidated signature for inspection only.
See README.md and the selected mod documentation for launch instructions.`;

function command(name, args) {
  return execFileSync(name, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (['--inspect', '--unsigned', '--help'].includes(name)) options[name.slice(2)] = true;
    else if (
      ['--source', '--overlay', '--output', '--app-name', '--bundle-id', '--dev-root'].includes(
        name,
      ) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      options[name.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete argument: ${name}`);
  }
  return options;
}
function contained(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function realTarget(filename) {
  if (fs.existsSync(filename)) return fs.realpathSync(filename);
  return path.join(realTarget(path.dirname(filename)), path.basename(filename));
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) return console.log(help);
  for (const key of ['source', 'overlay', 'output'])
    if (!options[key]) throw new Error(`Missing --${key}\n${help}`);
  if (process.platform !== 'darwin') throw new Error('App packaging and codesigning require macOS');
  if (!path.isAbsolute(options.output) || !options.output.endsWith('.app'))
    throw new Error('--output must be an absolute .app path');
  validateAppIdentity(options['app-name'], options['bundle-id']);
  const source = fs.realpathSync(options.source);
  const overlay = fs.realpathSync(options.overlay);
  const output = realTarget(options.output);
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  if (
    contained(source, output) ||
    contained(output, source) ||
    contained(overlay, output) ||
    contained(output, overlay)
  )
    throw new Error('Source, overlay and output must be separate directories');
  if (
    contained('/Applications', output) ||
    contained(path.join(os.homedir(), 'Applications'), output)
  )
    throw new Error('Output must be a staging location outside Applications');
  const sourceAsar = path.join(source, 'Contents/Resources/app.asar');
  const archive = readArchive(sourceAsar);
  const info = JSON.parse(
    command('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(source, 'Contents/Info.plist'),
    ]),
  );
  if (info.ElectronAsarIntegrity?.['Resources/app.asar']?.hash !== archive.headerHash)
    throw new Error('Stock ASAR header does not match its Info.plist integrity hash');
  const replacements = readOverlay(overlay);
  if (!replacements.size) throw new Error('Overlay is empty');
  const metadata = replacements.has(metadataPath)
    ? JSON.parse(replacements.get(metadataPath).toString())
    : null;
  const beforeRepair = new Map(replacements);
  // The main bundle may be absent in a Model Spread-only overlay.
  const { mainPath } = await import('../mods/app-tools-auth/patch.mjs');
  if (!beforeRepair.has(mainPath)) beforeRepair.set(mainPath, readEntry(archive, mainPath));
  repairOverlay(source, replacements);
  if (metadata?.receipt)
    metadata.receipt.transforms.push(
      ...recordChanges('app-tools-auth', 'app-tools authentication', beforeRepair, replacements),
    );
  if (options['dev-root']) {
    if (!metadata?.receipt)
      throw Error('Development packaging requires a build receipt; use modex prepare');
    const { applyDevelopment, readDevelopmentProtocol, protocolPath } =
      await import('../mods/development/patch.mjs');
    const beforeDevelopment = new Map(replacements);
    const protocolOriginal = readDevelopmentProtocol(source);
    beforeDevelopment.set(protocolPath, protocolOriginal);
    metadata.receipt.development = await applyDevelopment(
      replacements,
      options['dev-root'],
      metadata.mods,
      protocolOriginal,
    );
    metadata.receipt.transforms.push(
      ...recordChanges(
        'development',
        'development module bootstrap',
        beforeDevelopment,
        replacements,
      ),
    );
  }
  if (metadata?.receipt)
    replacements.set(
      metadataPath,
      Buffer.from(JSON.stringify(metadataFor(metadata.mods, metadata.receipt), null, 2) + '\n'),
    );
  checkNativeBuild();
  // Even an unsigned inspection copy embeds the eventual certificate identity.
  const signer = signingIdentity();
  const teamId = signer.name.match(/\(([A-Z0-9]+)\)$/)?.[1];
  if (!teamId) throw Error('Signing certificate has no team identifier');
  const plan = {
    source,
    output,
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
    sourceHeaderHash: archive.headerHash,
    files: [...replacements.keys()],
    signing: options.unsigned ? 'unsigned inspection only' : signer.name,
  };
  if (options.inspect) return console.log(JSON.stringify(plan, null, 2));
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // Refuse overwriting even if another process created the destination after validation.
  fs.mkdirSync(output);
  command('/usr/bin/ditto', [source, output]);
  const nativeOutput = path.join(output, 'Contents/Resources/native', nativeName);
  buildNative({ output: nativeOutput, teamId, bundleId: options['bundle-id'] });
  command('/usr/bin/codesign', [
    '--force',
    '--sign',
    signer.hash,
    '--options',
    'runtime',
    nativeOutput,
  ]);
  command('/usr/bin/codesign', ['--verify', '--strict', nativeOutput]);
  const destinationAsar = path.join(output, 'Contents/Resources/app.asar');
  const result = rewriteArchive(sourceAsar, destinationAsar, replacements);
  const generated = readArchive(destinationAsar);
  for (const [filename, bytes] of replacements) {
    const actual = readEntry(generated, filename);
    if (!actual.equals(bytes)) throw new Error(`Packaged content differs: ${filename}`);
    if (
      JSON.stringify(entryFor(generated, filename).integrity) !==
      JSON.stringify(integrityForBuffer(actual))
    )
      throw new Error(`Packaged integrity differs: ${filename}`);
  }
  const plist = path.join(output, 'Contents/Info.plist');
  // Replace the whole integrity dictionary so the dot in app.asar is not parsed as a key path.
  command('/usr/bin/plutil', [
    '-replace',
    'ElectronAsarIntegrity',
    '-json',
    JSON.stringify({ 'Resources/app.asar': { algorithm: 'SHA256', hash: result.headerHash } }),
    plist,
  ]);
  const signing = options.unsigned
    ? null
    : signApp(output, {
        identity: signer.hash,
        original: source,
        appName: options['app-name'],
        bundleID: options['bundle-id'],
      });
  // Check the original is still sealed and its ASAR header is unchanged.
  if (readArchive(sourceAsar).headerHash !== archive.headerHash)
    throw new Error('Source archive changed during packaging');
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
  console.log(
    JSON.stringify(
      {
        ...plan,
        ...result,
        removedEntitlements: signing?.removedEntitlements ?? [],
        addedEntitlements: signing?.addedEntitlements ?? [],
        designatedRequirement: signing?.requirement ?? null,
        sourceSignatureVerified: true,
        stagedSignatureVerified: !options.unsigned,
        launched: false,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  });
