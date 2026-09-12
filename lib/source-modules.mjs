import fs from 'node:fs';
import path from 'node:path';
import { entryFor, readEntry } from './asar.mjs';

// Native adapters can follow dependency imports without copying the complete
// vendor graph into the transform output or its receipt.
export function archiveModules(archive, directory = 'webview/assets') {
  const entries = entryFor(archive, directory)?.files ?? {};
  const names = Object.keys(entries)
    .filter((name) => /\.[cm]?js$/.test(name) && !entries[name].files)
    .sort();
  const allowed = new Set(names);
  return {
    names,
    read(name) {
      if (!allowed.has(name)) throw Error(`Unknown source module: ${name}`);
      return readEntry(archive, `${directory}/${name}`).toString();
    },
  };
}

export function directoryModules(directory) {
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?js$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const allowed = new Set(names);
  return {
    names,
    read(name) {
      if (!allowed.has(name)) throw Error(`Unknown source module: ${name}`);
      return fs.readFileSync(path.join(directory, name), 'utf8');
    },
  };
}
