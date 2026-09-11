import { entryFor, readEntry } from './asar.mjs';
import { moduleSets } from '../mods/development/validation.mjs';

export const metadataPath = 'modex.json';
function validateMods(mods) {
  if (
    !Array.isArray(mods) ||
    !mods.length ||
    mods.some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) ||
    new Set(mods).size !== mods.length
  )
    throw Error('Invalid packaged mod list');
  return [...mods];
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Invalid ${label}`);
  return value;
}
function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw Error(`Invalid ${label} SHA256`);
  return value;
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw Error(`Invalid ${label}`);
  return value;
}
function archivePath(value) {
  text(value, 'transform path');
  if (
    value.includes('\\') ||
    value
      .split('/')
      .some(
        (part) => !part || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part),
      ) ||
    value === metadataPath
  )
    throw Error('Invalid transform path');
  return value;
}
/** Build facts are supplied by the caller; no working tree or clock is consulted. */
export function metadataFor(mods, receipt) {
  const selected = validateMods(mods);
  if (receipt === undefined) return { schemaVersion: 1, mods: selected };
  object(receipt, 'build receipt');
  const source = object(receipt.source, 'receipt source');
  const build = object(receipt.build, 'receipt build');
  if (
    build.revision !== null &&
    (typeof build.revision !== 'string' || !/^[a-f0-9]{40,64}$/.test(build.revision))
  )
    throw Error('Invalid build revision');
  if (build.dirty !== null && typeof build.dirty !== 'boolean')
    throw Error('Invalid build dirty state');
  if (!Array.isArray(receipt.transforms) || !receipt.transforms.length)
    throw Error('Invalid receipt transforms');
  const names = new Set();
  const latest = new Map();
  const transforms = receipt.transforms.map((value) => {
    const record = object(value, 'transform');
    if (!selected.includes(record.mod) && !['app-tools-auth', 'development'].includes(record.mod))
      throw Error('Unknown transform owner');
    const name = text(record.name, 'transform name');
    const filename = archivePath(record.path);
    const key = JSON.stringify([record.mod, name, filename]);
    if (names.has(key)) throw Error('Duplicate transform record');
    names.add(key);
    const beforeHash =
      record.beforeHash === null ? null : hash(record.beforeHash, 'transform before');
    const afterHash = hash(record.afterHash, 'transform after');
    if (latest.has(filename) && latest.get(filename) !== beforeHash)
      throw Error(`Broken transform hash chain: ${filename}`);
    latest.set(filename, afterHash);
    return { mod: record.mod, name, path: filename, beforeHash, afterHash };
  });
  const result = {
    schemaVersion: 2,
    mods: selected,
    receipt: {
      source: {
        version: text(source.version, 'source version'),
        build: text(source.build, 'source build'),
        asarHash: hash(source.asarHash, 'source archive'),
      },
      build: {
        revision: build.revision,
        dirty: build.dirty,
        sourceHash: hash(build.sourceHash, 'build source'),
      },
      transforms,
    },
  };
  if (receipt.development !== undefined) {
    const development = object(receipt.development, 'development descriptor');
    const root = text(development.root, 'development root');
    if (!root.startsWith('/') || root.includes('\0'))
      throw Error('Development root must be absolute');
    const developmentMods = validateMods(development.mods);
    if (developmentMods.some((id) => !selected.includes(id)))
      throw Error('Development mod is not selected');
    result.receipt.development = { root, mods: developmentMods };
    if (development.source !== undefined) {
      const moduleSource = object(development.source, 'development source');
      result.receipt.development.source = {
        version: text(moduleSource.version, 'development source version'),
        build: text(moduleSource.build, 'development source build'),
      };
    }
    if (development.hookHash !== undefined)
      result.receipt.development.hookHash = hash(development.hookHash, 'development hook');
    if (development.moduleHashes !== undefined) {
      const hashes = object(development.moduleHashes, 'development module hashes');
      const allowed = developmentMods.flatMap((id) => moduleSets[id] ?? []);
      result.receipt.development.moduleHashes = Object.fromEntries(
        Object.entries(hashes).map(([id, value]) => {
          if (!allowed.includes(id)) throw Error(`Unknown development module: ${id}`);
          return [id, hash(value, 'development module')];
        }),
      );
    }
  }
  return result;
}
/** Missing metadata is distinguishable from a malformed or unsupported receipt. */
export function readInstalledMetadata(archive) {
  if (!entryFor(archive, metadataPath)) return null;
  const metadata = JSON.parse(readEntry(archive, metadataPath).toString('utf8'));
  if (metadata?.schemaVersion === 1) return metadataFor(metadata.mods);
  if (metadata?.schemaVersion === 2) {
    if (metadata.receipt === undefined) throw Error('Missing packaged build receipt');
    return metadataFor(metadata.mods, metadata.receipt);
  }
  throw Error('Unsupported packaged mod metadata schema');
}
export function readInstalledMods(archive, legacyMarkers = {}) {
  const metadata = readInstalledMetadata(archive);
  if (metadata) return metadata.mods;
  const found = Object.entries(legacyMarkers)
    .filter(([, marker]) => entryFor(archive, marker))
    .map(([id]) => id);
  if (!found.length)
    throw Error('Cannot determine installed mods: no metadata or recognized legacy mod files');
  return found;
}
export function assertModSelection(installed, selected, explicitSelection = false) {
  const removed = installed.filter((id) => !selected.includes(id));
  if (removed.length && !explicitSelection)
    throw Error(
      `Update would remove installed mods: ${removed.join(', ')}. Use --mods with the complete intended list to explicitly request removal.`,
    );
  return removed;
}
