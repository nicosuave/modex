import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readArchive, readEntry, entryFor } from './asar.mjs';
import { readInstalledMetadata } from './mod-metadata.mjs';
import { inspectDevelopment } from '../mods/development/validation.mjs';

// Describes configured module bytes on disk, not code loaded by a running app.
function developmentStatus(receipt) {
  const descriptor = receipt?.development;
  if (!descriptor) return null;
  if (!descriptor.hookHash)
    return {
      status: 'unavailable',
      modules: [],
      error: 'Packaged receipt has no development hook hash',
    };
  try {
    fs.statSync(descriptor.root);
  } catch (error) {
    return { status: 'unavailable', modules: [], error: error.message };
  }
  try {
    const manifest = inspectDevelopment(descriptor.root, {
      hookHash: descriptor.hookHash,
      mods: descriptor.mods,
      source: receipt.source,
    });
    const modules = Object.entries(manifest.modules).map(([id, entry]) => ({
      id,
      hash: entry.hash,
      changedSincePackaging:
        descriptor.moduleHashes?.[id] === undefined
          ? null
          : descriptor.moduleHashes[id] !== entry.hash,
    }));
    return { status: 'ready', modules };
  } catch (error) {
    return { status: 'incompatible', modules: [], error: error.message };
  }
}

/** Inspect only. Verification covers recorded final files, not the app signature or all stock files. */
export function readStatus(appPath, { legacyMarkers = {} } = {}) {
  if (typeof appPath !== 'string' || !path.isAbsolute(appPath))
    throw Error('Status requires an absolute app path');
  const archive = readArchive(path.join(appPath, 'Contents', 'Resources', 'app.asar'));
  const metadata = readInstalledMetadata(archive);
  const mods =
    metadata?.mods ??
    Object.entries(legacyMarkers)
      .filter(([, marker]) => entryFor(archive, marker))
      .map(([id]) => id);
  const expected = new Map();
  for (const transform of metadata?.receipt?.transforms ?? [])
    expected.set(transform.path, transform.afterHash);
  const files = [...expected].map(([filename, expectedHash]) => {
    let actualHash = null;
    let status = 'missing';
    if (entryFor(archive, filename)) {
      try {
        actualHash = crypto.createHash('sha256').update(readEntry(archive, filename)).digest('hex');
        status = actualHash === expectedHash ? 'match' : 'mismatch';
      } catch {
        status = 'unreadable';
      }
    }
    return { path: filename, expectedHash, actualHash, status };
  });
  return {
    appPath: path.resolve(appPath),
    metadata,
    mods,
    receiptStatus: !metadata?.receipt
      ? 'unavailable'
      : files.every((file) => file.status === 'match')
        ? 'verified'
        : 'mismatch',
    files,
    development: developmentStatus(metadata?.receipt),
  };
}
