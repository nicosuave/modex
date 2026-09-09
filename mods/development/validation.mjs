import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const moduleSets={'theme-icon':['theme-icon-render','theme-icon-runtime'],'model-spread':['model-spread','model-spread-editor']};
export const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function readModule(root,manifest,id) {
  const entry=manifest.modules[id];
  if(!entry)throw new Error(`Unknown development module: ${id}`);
  if(typeof entry.file!=='string'||path.isAbsolute(entry.file)||entry.file.split(/[\\/]/).includes('..'))throw new Error('Invalid development module path');
  const base=fs.realpathSync(root),file=fs.realpathSync(path.join(base,entry.file));
  if(!file.startsWith(base+path.sep))throw new Error('Development module escapes root');
  const bytes=fs.readFileSync(file);
  if(digest(bytes)!==entry.hash)throw new Error(`Development module hash mismatch: ${id}`);
  return bytes.toString('utf8');
}
export function inspectDevelopment(root,expected) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.mods)||!manifest.mods.length||new Set(manifest.mods).size!==manifest.mods.length||manifest.mods.some(id=>!moduleSets[id])||!manifest.modules||!/^[a-f0-9]{64}$/.test(manifest.hookHash)||typeof manifest.source?.version!=='string'||typeof manifest.source?.build!=='string')throw new Error('Invalid development manifest');
  const allowed=manifest.mods.flatMap(id=>moduleSets[id]).sort();
  if(!same(Object.keys(manifest.modules).sort(),allowed))throw new Error('Unexpected development module set');
  if(expected) {
    if(manifest.hookHash!==expected.hookHash)throw new Error('Development hooks changed; repackage the app');
    if(!same([...manifest.mods].sort(),[...expected.mods].sort())||manifest.source.version!==expected.source?.version||manifest.source.build!==expected.source?.build)throw new Error('Development mods or source changed; repackage the app');
  }
  for(const id of allowed)readModule(root,manifest,id);
  return manifest;
}
export function evaluateModule(source) {
  const module={exports:{}};
  new Function('module','exports',source)(module,module.exports);
  if(typeof module.exports.renderPixels!=='function'||typeof module.exports.sourceVariant!=='function')throw new Error('Invalid Theme Icon renderer exports');
  return module.exports;
}
