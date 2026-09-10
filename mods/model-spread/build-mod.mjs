import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
  r(primary, 'if(!n)return u;let S=ohr', 'if(!n||i==null)return u;let S=ohr');
  out[primary] =
    'import * as ModelSpreadMod from "./model-spread.mjs";import {Editor as MSEditor} from "./model-spread-editor.mjs";import {nativeUI as MSNative} from "./model-spread-native.mjs";' +
    out[primary];
  // Only default spread is replaced; explicit model selection and locked models retain native behavior.
  r(
    primary,
    'Ve=wn(Pe,{includeUltraInSlider:y,sliderModelsConfig:ce,stripGptPrefix:!d}),He=',
    'Ve=ModelSpreadMod.customChoices(ModelSpreadMod.useSettings(S7),Pe,wn(Pe,{includeUltraInSlider:y,sliderModelsConfig:ce,stripGptPrefix:!d}),x.hostId),He=',
  );
  r(
    primary,
    'He=hle(Ve,U,Ie)==null?`model`:p??`default`',
    'He=ModelSpreadMod.store().get().slots!==null&&p!==`model`?`default`:hle(Ve,U,Ie)==null?`model`:p??`default`',
  );
  // HOME resolves saved settings against the stock preset after the async write.
  // A custom profile already owns its stops; retain native supported-effort validation.
  r(
    initial,
    'oe=V.reasoningEffort;if(ie&&ae?.data!=null)',
    'oe=V.reasoningEffort;if(ie&&ae?.data!=null&&PT(`nico.codex.model-spread.v1`,null)?.slots==null)',
  );
  // Custom profiles should not be altered by the native xhigh experiment/reset logic.
  r(
    primary,
    'skipExperimentExposure:S||He===`model`||y||b',
    'skipExperimentExposure:ModelSpreadMod.store().get().slots!==null||S||He===`model`||y||b',
  );
  // Hook precedes every early return. It uses the same access and model-change checks as the picker.
  r(
    primary,
    'let mt;t[59]===qe?',
    'ModelSpreadMod.useComposer(S7,{trigger:Se,choices:Ve,model:U,effort:Ie,enabled:Le&&Re&&!S&&!V?.isModelLocked,select:async choice=>{if(!ut(choice.model))return false;c.set(Qm,`default`);return dt(choice.model,choice.reasoningEffort);}});let mt;t[59]===qe?',
  );
  // Keep user-selected custom pairs when the active model is already represented in the spread.
  out[primary] += '\n' + fs.readFileSync(path.join(here, 'primary-adapter.template.js'), 'utf8');
  out[settings] = `import {ModelSpreadSettings} from "./${primary}";` + out[settings];
  // An independent child has its own subscription; the compiled parent memo cache cannot stale it.
  r(settings, 'children:[k,A]', 'children:[k,A,(0,Q.jsx)(ModelSpreadSettings,{hostId:n,row:ne})]');
  out[micro] =
    `import * as ModelSpreadMod from "./model-spread.mjs";import {ModelSpreadSettings} from "./${primary}";` +
    out[micro];
  const start = out[micro].indexOf('let xt=Oi[N.encoderMode]'),
    end = out[micro].indexOf('let Tt;', start);
  if (start < 0 || end < 0 || end - start > 3000)
    throw Error('Micro knob settings adapter changed');
  out[micro] =
    out[micro].slice(0, start) +
    'let wt=(0,$.jsx)(MSMode,{layout:N,options:_.options,onChange:e=>{pe(e===`custom`),Vt(i,ot.layout,{...N,encoderMode:e})}});' +
    out[micro].slice(end);
  out[micro] += '\n' + fs.readFileSync(path.join(here, 'micro-adapter.template.js'), 'utf8');
  out[bridge] = 'import * as ModelSpreadMod from "./model-spread.mjs";' + out[bridge];
  r(
    bridge,
    'f(s===`ArrowUp`?`composer.decreaseReasoningEffort`:`composer.increaseReasoningEffort`,`codex_micro_encoder`)',
    'ModelSpreadMod.microEnabled()?e.root.dispatchEvent(new CustomEvent(ModelSpreadMod.EVENT,{detail:{direction:s===`ArrowUp`?-1:1}})):f(s===`ArrowUp`?`composer.decreaseReasoningEffort`:`composer.increaseReasoningEffort`,`codex_micro_encoder`)',
  );
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
    .replace('__ROW__', bundles[micro].match(/selectable-list-row-[a-z0-9]+\.js/)[0])
    .replace('__REWIND__', 'rewind-C6Tfwm30-88a35b050d27.js');
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
