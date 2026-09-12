import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseModule, editSource } from '../../lib/source-contract.mjs';
import { directoryModules } from '../../lib/source-modules.mjs';
import {
  patchUsageBanners,
  patchSelectionMode,
  patchExperimentExposure,
  patchMicroDispatch,
} from './source-hooks.mjs';
import {
  discoverComposer,
  discoverMicroSettings,
  discoverHomeNormalization,
  patchAgentSettings,
} from './source-contracts.mjs';
import { renderNativeAdapters } from './native-contract.mjs';
const here = import.meta.dirname;
export function replaceOnce(source, old, value, label = old.slice(0, 70)) {
  if (source.split(old).length !== 2)
    throw Error(`Compatibility check failed: expected one ${label}`);
  return source.replace(old, value);
}
function renderBindings(name, bindings) {
  const { initialize, ...values } = bindings;
  return `function ${name}(){${initialize ? initialize + '();' : ''}return {${Object.entries(values)
    .map(([role, value]) => role + ':' + value)
    .join(',')}};}`;
}
export function transform(bundles, context = {}) {
  const names = Object.keys(bundles);
  const find = (prefix) => {
    const matches = names.filter((name) => name.startsWith(prefix));
    if (matches.length !== 1) throw Error(`Expected one ${prefix} bundle`);
    return matches[0];
  };
  const primary = find('app-primary-'),
    initial = find('app-initial-'),
    settings = find('agent-settings-'),
    micro = find('codex-micro-settings-'),
    bridge = find('codex-micro-bridge-');
  const modules = {
    primary: parseModule(bundles[primary]),
    initial: parseModule(bundles[initial]),
    settings: parseModule(bundles[settings]),
    micro: parseModule(bundles[micro]),
  };
  const composer = discoverComposer(modules.primary),
    microSettings = discoverMicroSettings(modules.micro),
    home = discoverHomeNormalization(modules.initial);
  const native = renderNativeAdapters(bundles, { ...context, initial, primary, modules });
  const readTemplate = (name) => fs.readFileSync(path.join(here, name), 'utf8');
  const out = { ...bundles, ...native.files };
  // Inject the custom catalog and hook at the native picker operation, retaining
  // its availability check, model access guard and atomic model/effort setter.
  out[primary] = editSource(bundles[primary], [composer.edit, composer.hook]);
  out[primary] = patchExperimentExposure(patchSelectionMode(patchUsageBanners(out[primary])));
  out[primary] =
    'import * as ModelSpreadMod from "./model-spread.mjs";import {Editor as MSEditor} from "./model-spread-editor.mjs";import {nativeUI as MSNative} from "./model-spread-native.mjs";' +
    out[primary] +
    '\n' +
    renderBindings('modelSpreadBindings', composer.bindings) +
    '\n' +
    readTemplate('primary-adapter.template.js') +
    '\n' +
    native.primaryExports;
  // HOME still validates supported efforts; only its saved stock-preset coercion
  // is conditional on the absence of an explicitly configured custom spread.
  out[initial] = editSource(bundles[initial], [
    {
      start: home.testEnd,
      end: home.testEnd,
      text: `&&${native.readPersisted}(\`nico.codex.model-spread.v1\`,null)?.slots==null`,
    },
  ]);
  out[settings] =
    `import {ModelSpreadSettings} from "./${primary}";` + patchAgentSettings(modules.settings);
  // Reuse the native layout update closure. The independently subscribed child
  // keeps shared spread settings fresh without depending on the parent's memo.
  out[micro] =
    `import * as ModelSpreadMod from "./model-spread.mjs";import {ModelSpreadSettings} from "./${primary}";` +
    editSource(bundles[micro], [microSettings.edit]) +
    '\n' +
    renderBindings('modelSpreadMicroBindings', microSettings.bindings) +
    '\n' +
    readTemplate('micro-adapter.template.js');
  out[bridge] =
    'import * as ModelSpreadMod from "./model-spread.mjs";' + patchMicroDispatch(bundles[bridge]);
  out['model-spread.mjs'] =
    'import {storage as nativeStorage,target as nativeTarget} from "./model-spread-storage.mjs";' +
    readTemplate('model-spread.mjs') +
    '\nconfigurePersistence(nativeStorage,nativeTarget);';
  out['model-spread-editor.mjs'] = readTemplate('editor.mjs');
  return out;
}
if (import.meta.main) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output)
    throw Error(
      'Usage: bun build-mod.mjs BUNDLE_DIRECTORY OVERLAY_DIRECTORY; use prepare-mod.mjs for a complete app build',
    );
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'compatibility.json'), 'utf8'));
  const bundles = {};
  for (const [name, expected] of Object.entries(manifest.files)) {
    const content = fs.readFileSync(path.join(input, name), 'utf8');
    if (crypto.createHash('sha256').update(content).digest('hex') !== expected)
      throw Error(`Unsupported bundle ${name}; stock app left unchanged`);
    bundles[name] = content;
  }
  const patched = transform(bundles, { sourceModules: directoryModules(input) });
  fs.mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(patched))
    if (content !== bundles[name]) fs.writeFileSync(path.join(output, name), content);
  console.log(
    `Validated ${Object.keys(bundles).length} stock bundles; wrote ${Object.keys(patched).filter((k) => patched[k] !== bundles[k]).length} overlay files to ${output}`,
  );
}
