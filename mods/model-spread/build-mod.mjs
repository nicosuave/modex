import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  patchUsageBanners,
  patchSelectionMode,
  patchExperimentExposure,
  patchMicroDispatch,
} from './source-hooks.mjs';
const here = import.meta.dirname;
export function replaceOnce(source, old, value, label = old.slice(0, 70)) {
  if (source.split(old).length !== 2)
    throw Error(`Compatibility check failed: expected one ${label}`);
  return source.replace(old, value);
}
export function transform(bundles) {
  const out = { ...bundles };
  const names = Object.keys(out),
    find = (prefix) => {
      const matches = names.filter((n) => n.startsWith(prefix));
      if (matches.length !== 1) throw Error(`Expected one ${prefix} bundle`);
      return matches[0];
    };
  const primary = find('app-primary-'),
    initial = find('app-initial-'),
    settings = find('agent-settings-'),
    micro = find('codex-micro-settings-'),
    bridge = find('codex-micro-bridge-');
  const r = (file, old, value) => (out[file] = replaceOnce(out[file], old, value));
  // Hide composer usage banners while preserving the image-limit path and lower-priority content.
  out[primary] = patchUsageBanners(out[primary]);
  out[primary] =
    'import * as ModelSpreadMod from "./model-spread.mjs";import {Editor as MSEditor} from "./model-spread-editor.mjs";import {nativeUI as MSNative} from "./model-spread-native.mjs";' +
    out[primary];
  // Only default spread is replaced; explicit model selection and locked models retain native behavior.
  r(
    primary,
    'Ue=IIe(Ie,{includeUltraInSlider:y,sliderModelsConfig:ue,stripGptPrefix:!d}),We=',
    'Ue=ModelSpreadMod.customChoices(ModelSpreadMod.useSettings(S7),Ie,IIe(Ie,{includeUltraInSlider:y,sliderModelsConfig:ue,stripGptPrefix:!d}),S.hostId),We=',
  );
  out[primary] = patchSelectionMode(out[primary]);
  // HOME resolves saved settings against the stock preset after the async write.
  // A custom profile already owns its stops; retain native supported-effort validation.
  r(
    initial,
    'oe=te.reasoningEffort;if(ie&&ae?.data!=null)',
    'oe=te.reasoningEffort;if(ie&&ae?.data!=null&&Jx(`nico.codex.model-spread.v1`,null)?.slots==null)',
  );
  // Custom profiles should not be altered by the native xhigh experiment/reset logic.
  out[primary] = patchExperimentExposure(out[primary]);
  // Hook precedes every early return. It uses the same access and model-change checks as the picker.
  r(
    primary,
    'let vt;t[60]===Xe?',
    'ModelSpreadMod.useComposer(S7,{trigger:Ce,choices:Ue,model:G,effort:Re,enabled:Be&&Ve&&!C&&!U?.isModelLocked,select:async choice=>{if(!mt(choice.model))return false;c.set($w,`default`);return ht(choice.model,choice.reasoningEffort);}});let vt;t[60]===Xe?',
  );
  // Keep user-selected custom pairs when the active model is already represented in the spread.
  out[primary] += '\n' + fs.readFileSync(path.join(here, 'primary-adapter.template.js'), 'utf8');
  out[settings] = `import {ModelSpreadSettings} from "./${primary}";` + out[settings];
  // An independent child has its own subscription; the compiled parent memo cache cannot stale it.
  r(settings, 'children:[A,M]', 'children:[A,M,(0,Q.jsx)(ModelSpreadSettings,{hostId:n,row:St})]');
  out[micro] =
    `import * as ModelSpreadMod from "./model-spread.mjs";import {ModelSpreadSettings} from "./${primary}";` +
    out[micro];
  const startAnchor = 'let _t=Oi[T.encoderMode]',
    endAnchor = 'let xt;t[130]!==L||t[131]!==T||t[132]!==r?',
    start = out[micro].indexOf(startAnchor),
    end = out[micro].indexOf(endAnchor, start);
  if (
    out[micro].split(startAnchor).length !== 2 ||
    out[micro].split(endAnchor).length !== 2 ||
    start < 0 ||
    end <= start ||
    end - start > 3000
  )
    throw Error('Micro knob settings adapter changed');
  out[micro] =
    out[micro].slice(0, start) +
    'let bt=(0,$.jsx)(MSMode,{layout:T,options:Oe.options,onChange:e=>{le(e===`custom`),je(r,B.layout,{...T,encoderMode:e})}});' +
    out[micro].slice(end);
  out[micro] += '\n' + fs.readFileSync(path.join(here, 'micro-adapter.template.js'), 'utf8');
  out[bridge] = 'import * as ModelSpreadMod from "./model-spread.mjs";' + out[bridge];
  out[bridge] = patchMicroDispatch(out[bridge]);
  out['model-spread.mjs'] =
    'import {storage as nativeStorage,target as nativeTarget} from "./model-spread-storage.mjs";' +
    fs.readFileSync(path.join(here, 'model-spread.mjs'), 'utf8') +
    '\nconfigurePersistence(nativeStorage,nativeTarget);';
  out['model-spread-storage.mjs'] = fs
    .readFileSync(path.join(here, 'native-storage.template.mjs'), 'utf8')
    .replace('__INITIAL__', initial);
  out['model-spread-editor.mjs'] = fs.readFileSync(path.join(here, 'editor.mjs'), 'utf8');
  out['model-spread-native.mjs'] = fs
    .readFileSync(path.join(here, 'native-ui.template.mjs'), 'utf8')
    .replace('__INITIAL__', initial)
    .replace('__PRIMARY__', primary)
    .replace('__REWIND__', 'rewind-C6Tfwm30-f2d000b3c617.js');
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
  const patched = transform(bundles);
  fs.mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(patched))
    if (content !== bundles[name]) fs.writeFileSync(path.join(output, name), content);
  console.log(
    `Validated ${Object.keys(bundles).length} stock bundles; wrote ${Object.keys(patched).filter((k) => patched[k] !== bundles[k]).length} overlay files to ${output}`,
  );
}
