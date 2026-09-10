import fs from 'node:fs';
import { inspectCompatibility } from '../../lib/prepare-mod.mjs';

export const manifest = JSON.parse(
  fs.readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'),
);
export const mainPath = Object.keys(manifest.files)[0];
export const runtimePath = '.vite/build/modex-app-tools-auth.cjs';
export const nativeName = 'modex-app-tools-auth.node';
const anchor =
  'async function mie({callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=Tf()})';
const replacement =
  'async function mie({callTool:e,listTools:t,pipePath:n,socketPeerAuthorizer:r=process.platform===`darwin`?require(`./modex-app-tools-auth.cjs`).wrap(Tf(),require(require(`node:path`).join(process.resourcesPath,`native`,`modex-app-tools-auth.node`))):Tf()})';

export function transform(main) {
  if (main.split(anchor).length !== 2) throw Error('Unsupported app-tools authorization call site');
  return main.replace(anchor, replacement);
}

export function repairOverlay(source, replacements) {
  // Validate pristine stock even when an earlier selected mod changed main.
  const { bundles } = inspectCompatibility(source, manifest);
  const input = replacements.get(mainPath) ?? bundles.get(mainPath);
  if (replacements.has(runtimePath)) throw Error('App-tools authorization runtime already present');
  const patched = transform(input.toString('utf8'));
  new Bun.Transpiler({ loader: 'js' }).transformSync(patched);
  replacements.set(mainPath, Buffer.from(patched));
  replacements.set(runtimePath, fs.readFileSync(new URL('./runtime.cjs', import.meta.url)));
}

export function verifyRepair(source) {
  const { bundles } = inspectCompatibility(source, manifest);
  const input = bundles.get(mainPath).toString('utf8');
  const first = transform(input);
  if (first !== transform(input)) throw Error('Nondeterministic app-tools authorization transform');
  new Bun.Transpiler({ loader: 'js' }).transformSync(first);
  return { appToolsAuthorization: 'verified', version: manifest.version, build: manifest.build };
}
