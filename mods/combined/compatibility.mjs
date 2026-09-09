import fs from 'node:fs';
import {compatibilityEntryPath} from '../../lib/prepare-mod.mjs';
export const componentManifests=Object.fromEntries(['model-spread','theme-icon','task-panes','custom-cli'].map(id=>[id,JSON.parse(fs.readFileSync(new URL(`../${id}/compatibility.json`,import.meta.url),'utf8'))]));
export const defaultMods=['model-spread','theme-icon'];
export const legacyMarkers={'model-spread':'webview/assets/model-spread.mjs','theme-icon':'webview/assets/theme-icon-runtime.mjs','task-panes':'webview/assets/task-panes-runtime.mjs','custom-cli':'.vite/build/modex-custom-cli.cjs'};
export function selectMods(mods=defaultMods) {
  const known=Object.keys(componentManifests);
  if(!Array.isArray(mods)||!mods.length||mods.some(id=>!Object.hasOwn(componentManifests,id))||new Set(mods).size!==mods.length)throw Error(`Select unique known mods: ${known.join(', ')}`);
  return known.filter(id=>mods.includes(id));
}
export function combineCompatibility(manifests) {
  const result={version:manifests[0].version,build:manifests[0].build,files:{},resources:{}};
  for(const manifest of manifests) {
    if(manifest.version!==result.version||manifest.build!==result.build)throw Error('Combined mods require the same stock version and build');
    for(const section of ['files','resources'])for(const [name,hash]of Object.entries(manifest[section]??{})) {
      const key=section==='files'?compatibilityEntryPath(name):name;
      if(result[section][key]&&result[section][key]!==hash)throw Error(`Conflicting compatibility hash: ${key}`);
      result[section][key]=hash;
    }
  }
  return result;
}
export const compatibility=combineCompatibility(defaultMods.map(id=>componentManifests[id]));
export function compatibilityFor(mods=defaultMods) {return combineCompatibility(selectMods(mods).map(id=>componentManifests[id]));}
