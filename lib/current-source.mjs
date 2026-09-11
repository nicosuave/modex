import path from 'node:path';
import { entryFor } from './asar.mjs';

// Bundlers change the content suffix even when the module's contract is intact.
// Resolve by module stem; ambiguity is an actual input error, not a version gate.
export function resolveBundlePaths(archive, names) {
  const result = new Map();
  for (const name of names) {
    if (entryFor(archive, name)) {
      result.set(name, name);
      continue;
    }
    const directory = path.posix.dirname(name);
    const basename = path.posix.basename(name);
    // The known filename's final dash separates its module stem and build suffix.
    const prefix = basename.replace(/-[^-]+\.js$/, '-');
    const node = entryFor(archive, directory);
    const candidates = Object.keys(node?.files ?? {}).filter(
      (candidate) =>
        candidate.startsWith(prefix) && candidate.endsWith('.js') && !node.files[candidate].files,
    );
    if (prefix === basename || candidates.length !== 1)
      throw Error(
        `Cannot locate unique current module for ${name}: ${candidates.length} candidates`,
      );
    result.set(name, `${directory}/${candidates[0]}`);
  }
  return result;
}

export function rewriteBundleNames(content, paths, reverse = false) {
  let value = content.toString();
  for (const [canonical, actual] of paths) {
    const from = path.posix.basename(reverse ? canonical : actual);
    const to = path.posix.basename(reverse ? actual : canonical);
    if (from !== to) value = value.split(from).join(to);
  }
  return value;
}

export function actualBundles(bundles, paths) {
  return Object.fromEntries(
    Object.entries(bundles).map(([name, content]) => [
      paths.get(name) ?? name,
      rewriteBundleNames(content, paths, true),
    ]),
  );
}

export function canonicalBundles(bundles, paths) {
  const canonical = new Map([...paths].map(([known, actual]) => [actual, known]));
  return Object.fromEntries(
    Object.entries(bundles).map(([name, content]) => [
      canonical.get(name) ?? name,
      rewriteBundleNames(content, paths),
    ]),
  );
}
