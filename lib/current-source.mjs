import path from 'node:path';
import { entryFor, readEntry } from './asar.mjs';

// Stock can emit both an implementation and a lazy entrypoint that only imports
// it, initializes it, and re-exports a component. That facade is not a patch site.
function isEntrypointFacade(source, candidates) {
  const match = source
    .trim()
    .match(/^import\{([^{}]+)\}from"\.\/([^"/]+)";([\w$]+)\(\);export\{([\w$]+) as [\w$]+\};$/);
  if (!match || !candidates.includes(match[2])) return false;
  const bindings = match[1]
    .split(',')
    .map((specifier) => specifier.trim().match(/^([\w$]+)(?: as ([\w$]+))?$/));
  if (bindings.some((binding) => !binding)) return false;
  const locals = bindings.map((binding) => binding[2] ?? binding[1]);
  return (
    locals.length === 2 &&
    locals.includes(match[3]) &&
    locals.includes(match[4]) &&
    match[3] !== match[4]
  );
}

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
    // Main-process hashes use eight base64url characters, including dashes;
    // renderer hashes are hexadecimal. Do not confuse a hash dash with the stem.
    const prefix = basename.replace(/-(?:[A-Za-z0-9_-]{8}|[^-]+)\.js$/, '-');
    const node = entryFor(archive, directory);
    let candidates = Object.keys(node?.files ?? {}).filter(
      (candidate) =>
        candidate.startsWith(prefix) &&
        /^(?:[^-]+|[A-Za-z0-9_-]{8})\.js$/.test(candidate.slice(prefix.length)) &&
        !node.files[candidate].files,
    );
    if (candidates.length > 1 && archive.filename) {
      const names = candidates;
      candidates = names.filter(
        (candidate) =>
          !isEntrypointFacade(readEntry(archive, `${directory}/${candidate}`).toString(), names),
      );
    }
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
