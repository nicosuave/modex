import {PNG} from 'pngjs';
import path from 'node:path';
import {renderPixels,sourceVariant} from './render.mjs';
import {validatePayload} from './state.mjs';
let palette=null,refresh=null,electron=null,resources=null;
const originals=new Map(),cache=new Map();
export function configure(api,directory,update) {electron=api;resources=directory;refresh=update;}
export function update(value) {
  const valid=validatePayload(value);
  if(!valid)return false;
  palette=valid;
  refresh?.();
  return true;
}
export function apply(preference) {
  if(preference!=='codex-system'||!palette||!electron?.app.dock)return false;
  try {
    const key=JSON.stringify(palette);
    let image=cache.get(key);
    if(!image) {
      const variant=sourceVariant(palette.variant,palette.appearance);
      if(!originals.has(variant)) {
        const filename=variant==='dark'?'icon-codex-dark-color.png':'icon-codex-light.png';
        const original=electron.nativeImage.createFromPath(path.join(resources,filename));
        if(original.isEmpty())throw new Error('Original Codex icon is missing');
        originals.set(variant,PNG.sync.read(original.resize({width:256,height:256,quality:'best'}).toPNG()));
      }
      const source=originals.get(variant);
      const output=new PNG({width:source.width,height:source.height});
      output.data=Buffer.from(renderPixels(source.data,palette,palette.variant,palette.appearance));
      image=electron.nativeImage.createFromBuffer(PNG.sync.write(output));
      // Match Codex's native icon crop (one pixel per 128 pixels).
      image=image.crop({x:2,y:2,width:252,height:252});
      if(cache.size>=16)cache.delete(cache.keys().next().value);
      cache.set(key,image);
    }
    electron.app.dock.setIcon(image);
    return true;
  } catch(error) {console.error('[Theme Icon]',error);return false;}
}
