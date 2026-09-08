import {entryFor,readEntry} from './asar.mjs';

export const metadataPath='modex.json';
function validateMods(mods) {
  if(!Array.isArray(mods)||!mods.length||mods.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]*$/.test(id))||new Set(mods).size!==mods.length)throw Error('Invalid packaged mod list');
  return [...mods];
}
export function metadataFor(mods) {return {schemaVersion:1,mods:validateMods(mods)};}
export function readInstalledMods(archive,legacyMarkers={}) {
  if(entryFor(archive,metadataPath)) {
    const metadata=JSON.parse(readEntry(archive,metadataPath).toString('utf8'));
    if(metadata?.schemaVersion!==1)throw Error('Unsupported packaged mod metadata schema');
    return validateMods(metadata.mods);
  }
  const found=Object.entries(legacyMarkers).filter(([,marker])=>entryFor(archive,marker)).map(([id])=>id);
  if(!found.length)throw Error('Cannot determine installed mods: no metadata or recognized legacy mod files');
  return found;
}
export function assertModSelection(installed,selected,explicitSelection=false) {
  const removed=installed.filter(id=>!selected.includes(id));
  if(removed.length&&!explicitSelection)throw Error(`Update would remove installed mods: ${removed.join(', ')}. Use --mods with the complete intended list to explicitly request removal.`);
  return removed;
}
