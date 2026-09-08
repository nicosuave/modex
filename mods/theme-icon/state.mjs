export const KEY = 'nico.codex.theme-icon.v1';
export const VARIANTS = Object.freeze([
  {id:'theme',label:'Theme'}, {id:'dark',label:'Dark tile'},
  {id:'light',label:'Light tile'}, {id:'original',label:'Original'},
]);
export function themeKey(id, appearance) {
  if(typeof id !== 'string' || !id.length || id.length>128 || !['light','dark'].includes(appearance)) throw new TypeError('Invalid theme identity');
  return `${appearance}:${id}`;
}
export function normalizeSettings(value) {
  const variants={};
  if(value?.version===1 && value.variants && typeof value.variants==='object') {
    for(const [key,variant] of Object.entries(value.variants).slice(0,512)) {
      if(/^(light|dark):.{1,128}$/.test(key) && VARIANTS.some(v=>v.id===variant)) variants[key]=variant;
    }
  }
  const colors={};
  if(value?.version===1)for(const [key,color]of Object.entries(value.colors??{}).slice(0,512)) {
    if(/^(light|dark):.{1,128}$/.test(key)&&typeof color==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(color))colors[key]=color;
  }
  return {version:1,variants,...Object.keys(colors).length?{colors}:{}};
}
export function selectedColor(value,key){return normalizeSettings(value).colors?.[key]??'accent';}
export function setColor(value,key,color){
  if(!/^(light|dark):.{1,128}$/.test(key)||typeof color!=='string'||!/^[a-zA-Z0-9._-]{1,128}$/.test(color))throw new TypeError('Invalid palette choice');
  const next=normalizeSettings(value);next.colors={...next.colors,[key]:color};return next;
}
export function selectedVariant(value,key) {return normalizeSettings(value).variants[key]??'theme';}
export function setVariant(value,key,variant) {
  if(!/^(light|dark):.{1,128}$/.test(key)||!VARIANTS.some(v=>v.id===variant)) throw new TypeError('Invalid icon variant');
  const next=normalizeSettings(value);
  next.variants[key]=variant;
  return next;
}
export function validatePayload(value) {
  if(!value || !['dark','light'].includes(value.appearance) || !VARIANTS.some(v=>v.id===value.variant)) return null;
  if(!/^#[\da-f]{6}$/i.test(value.accent)||!/^#[\da-f]{6}$/i.test(value.surface))return null;
  return {appearance:value.appearance,variant:value.variant,accent:value.accent,surface:value.surface};
}
