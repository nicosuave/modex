import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {transform as modelSpread} from '../model-spread/build-mod.mjs';
import {transform as themeIcon} from '../theme-icon/build-mod.mjs';
import {compatibility,compatibilityFor,selectMods,componentManifests} from './compatibility.mjs';
export async function transform(bundles,mods) {
  const selected=selectMods(mods);
  // Both manifests validate pristine bytes. Only transforms compose: the shared
  // app-initial bundle must pass from Model Spread into Theme Icon, never merge.
  let composed={...bundles};
  if(selected.includes('model-spread')) {
    const spreadInputs=Object.fromEntries(Object.keys(componentManifests['model-spread'].files).map(name=>[name,composed[`webview/assets/${name}`]]));
    const spread=modelSpread(spreadInputs);
    composed={...composed,...Object.fromEntries(Object.entries(spread).map(([name,content])=>[`webview/assets/${name}`,content]))};
  }
  return selected.includes('theme-icon')?themeIcon(composed):composed;
}
export function validateInputs(bundles,mods) {
  for(const [name,hash]of Object.entries(compatibilityFor(mods).files)) {
    if(typeof bundles[name]!=='string'||crypto.createHash('sha256').update(bundles[name]).digest('hex')!==hash)throw Error(`Unsupported bundle: ${name}`);
  }
}
if(import.meta.main) {
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Usage: bun build-mod.mjs INPUT_DIRECTORY OVERLAY_ROOT');
  const bundles=Object.fromEntries(Object.keys(compatibility.files).map(name=>[name,fs.readFileSync(path.join(input,name),'utf8')]));
  validateInputs(bundles);
  const patched=await transform(bundles);
  for(const [name,content]of Object.entries(patched)) {
    const target=path.join(output,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);
  }
  console.log(`Model Spread + Theme Icon: wrote ${Object.keys(patched).length} composed overlay files`);
}
