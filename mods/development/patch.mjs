import fs from 'node:fs';
import path from 'node:path';
import { inspectDevelopment, digest } from './validation.mjs';
import { buildRuntime, computeHookHash, sourceForMods } from './build.mjs';
import { mainPath } from '../app-tools-auth/patch.mjs';
import { inspectCompatibility } from '../../lib/prepare-mod.mjs';
import { rendererModules } from './contract.mjs';
import { parseModule, literalValue, propertyName, unique } from '../../lib/source-contract.mjs';
const compatibility = JSON.parse(
  fs.readFileSync(new URL('./compatibility.json', import.meta.url), 'utf8'),
);
export const protocolPath = Object.keys(compatibility.files)[0];
export function readDevelopmentProtocol(source, options = {}) {
  return inspectCompatibility(source, compatibility, options).bundles.get(protocolPath);
}
export function transformProtocol(code) {
  if (code.includes('modex-development-main.cjs'))
    throw Error('Unsupported development protocol call site');
  const parsed = parseModule(code);
  const call = unique(
    parsed
      .ofType('CallExpression')
      .filter(
        (node) =>
          node.callee.type === 'MemberExpression' &&
          propertyName(node.callee.property) === 'handle' &&
          node.callee.object.type === 'MemberExpression' &&
          propertyName(node.callee.object.property) === 'protocol' &&
          literalValue(node.arguments[0]) === 'app',
      ),
    'Unsupported development protocol call site',
  );
  const callback = call.arguments[1];
  if (
    !callback?.async ||
    callback.body?.type !== 'BlockStatement' ||
    callback.params.length !== 1 ||
    callback.params[0].type !== 'Identifier'
  )
    throw Error('Unsupported development protocol callback');
  const request = callback.params[0].name;
  const insertion = callback.body.start + 1;
  const hook = `const modexResponse=require(\`./modex-development-main.cjs\`).responseFor(${request});if(modexResponse)return modexResponse;`;
  return code.slice(0, insertion) + hook + code.slice(insertion);
}
export function inspectDevelopmentForBuild(root, mods, source, options = {}) {
  if (!path.isAbsolute(root)) throw Error('--dev-root must be an absolute development directory');
  if (source) readDevelopmentProtocol(source, options);
  return inspectDevelopment(root, {
    hookHash: computeHookHash(mods),
    mods,
    source: sourceForMods(mods),
  });
}
export function rendererShim(id, { file, exports: exportsList }) {
  const bundled = file.replace(/\.mjs$/, '-bundled.mjs');
  const persistence =
    id === 'model-spread' ? `import {storage,target} from './model-spread-storage.mjs';\n` : '';
  return `import * as bundled from './${bundled}';
${persistence}let selected=bundled;
try {
  const external=await import('./modex-development-${id}.mjs');
  for(const name of ${JSON.stringify(exportsList)})if(typeof external[name]!==typeof bundled[name])throw Error('Incompatible development export: '+name);
  ${id === 'model-spread' ? 'external.configurePersistence(storage,target);' : ''}
  selected=external;
} catch(error) {console.error('[Modex development] ${id}: using packaged module; rebuild development output and reload or restart.',error);}
${exportsList.map((name) => `export const ${name}=selected.${name};`).join('\n')}
`;
}
/** Opt-in only. Uses the existing app origin without changing renderer CSP. */
export async function applyDevelopment(
  replacements,
  root,
  mods,
  protocolOriginal,
  { currentSource = false } = {},
) {
  const manifest = inspectDevelopmentForBuild(root, mods);
  if (
    !protocolOriginal ||
    (!currentSource && digest(protocolOriginal) !== compatibility.files[protocolPath])
  )
    throw Error('Unsupported development protocol source hash');
  if (replacements.has(protocolPath))
    throw Error('Unexpected development protocol transform owner');
  const expected = { hookHash: manifest.hookHash, mods: manifest.mods, source: manifest.source };
  for (const id of Object.keys(rendererModules)) {
    if (!manifest.modules[id]) continue;
    const module = rendererModules[id],
      filename = `webview/assets/${module.file}`;
    const existing = replacements.get(filename);
    if (!existing) throw Error(`Missing installed hook module: ${filename}`);
    replacements.set(filename.replace(/\.mjs$/, '-bundled.mjs'), existing);
    replacements.set(filename, Buffer.from(rendererShim(id, module)));
  }
  const runtime = await buildRuntime();
  replacements.set('.vite/build/modex-development-main.cjs', Buffer.from(runtime['main.cjs']));
  replacements.set(protocolPath, Buffer.from(transformProtocol(protocolOriginal.toString())));
  const main = replacements.get(mainPath);
  if (!main) throw Error('Development bootstrap requires the verified main bundle');
  const callback = mods.includes('theme-icon')
    ? `,onIconRenderer:renderer=>require('./theme-icon-main.cjs').setRenderer(renderer)`
    : '';
  const bootstrap = `require('./modex-development-main.cjs').start({electron:require('electron'),root:${JSON.stringify(path.resolve(root))},expected:${JSON.stringify(expected)}${callback}});\n`;
  replacements.set(mainPath, Buffer.from(bootstrap + main.toString()));
  return {
    root: path.resolve(root),
    source: manifest.source,
    mods,
    hookHash: manifest.hookHash,
    moduleHashes: Object.fromEntries(
      Object.entries(manifest.modules).map(([id, module]) => [id, module.hash]),
    ),
  };
}
