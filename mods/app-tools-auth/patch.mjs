import fs from 'node:fs';
import { inspectCompatibility } from '../../lib/prepare-mod.mjs';
import { rewriteBundleNames } from '../../lib/current-source.mjs';

export const manifest = JSON.parse(
  fs.readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'),
);
export const mainPath = Object.keys(manifest.files)[0];
export const runtimePath = '.vite/build/modex-app-tools-auth.cjs';
export const nativeName = 'modex-app-tools-auth.node';
// Match the app-tools parameter contract, not the minifier's function/binding names.
// Other pipes share the factory but have different contracts and must stay untouched.
const identifier = '[A-Za-z_$][A-Za-z0-9_$]*';
const authorizationContract = new RegExp(
  String.raw`\basync\s+function\s+${identifier}\s*\(\s*\{\s*callTool\s*:\s*${identifier}\s*,\s*listTools\s*:\s*${identifier}\s*,\s*pipePath\s*:\s*${identifier}\s*,\s*socketPeerAuthorizer\s*:\s*${identifier}\s*=\s*(?<factory>${identifier})\s*\(\s*\)(?=\s*\}\s*\)\s*\{)`,
  'g',
);

export function transform(main) {
  const matches = [...main.matchAll(authorizationContract)];
  if (matches.length !== 1) throw Error('Unsupported app-tools authorization call site');
  const match = matches[0];
  const factoryCall = `${match.groups.factory}()`;
  const replacement = match[0].replace(
    /[A-Za-z_$][A-Za-z0-9_$]*\s*\(\s*\)$/,
    () =>
      `process.platform===\`darwin\`?require(\`./modex-app-tools-auth.cjs\`).wrap(${factoryCall},require(require(\`node:path\`).join(process.resourcesPath,\`native\`,\`modex-app-tools-auth.node\`))):${factoryCall}`,
  );
  return main.slice(0, match.index) + replacement + main.slice(match.index + match[0].length);
}

export function repairOverlay(source, replacements, options = {}) {
  // Validate pristine stock even when an earlier selected mod changed main.
  const { bundles, paths } = inspectCompatibility(source, manifest, options);
  const target = paths.get(mainPath) ?? mainPath;
  const input =
    replacements.get(target) ?? Buffer.from(rewriteBundleNames(bundles.get(mainPath), paths, true));
  if (replacements.has(runtimePath)) throw Error('App-tools authorization runtime already present');
  const patched = transform(input.toString('utf8'));
  new Bun.Transpiler({ loader: 'js' }).transformSync(patched);
  replacements.set(target, Buffer.from(patched));
  replacements.set(runtimePath, fs.readFileSync(new URL('./runtime.cjs', import.meta.url)));
}

export function verifyRepair(source, options = {}) {
  const { bundles, info } = inspectCompatibility(source, manifest, options);
  const input = bundles.get(mainPath).toString('utf8');
  const first = transform(input);
  if (first !== transform(input)) throw Error('Nondeterministic app-tools authorization transform');
  new Bun.Transpiler({ loader: 'js' }).transformSync(first);
  return {
    appToolsAuthorization: 'verified',
    version: info.CFBundleShortVersionString,
    build: info.CFBundleVersion,
  };
}
