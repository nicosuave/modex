import {inspectDevelopment,readModule,evaluateModule} from './validation.mjs';
import {rendererModules} from './contract.mjs';
const rendererIds=new Set(Object.keys(rendererModules));
// Refreshes the pure renderer only. Browser state belongs to the user's window.
export function createRefresh({root,expected,onIconRenderer,log=console}) {
  let current,lastError,sources={};
  const refresh=function() {
    try {
      const next=inspectDevelopment(root,expected);
      const nextSources=Object.fromEntries([...rendererIds].filter(id=>next.modules[id]).map(id=>[id,readModule(root,next,id)]));
      const icon=next.modules['theme-icon-render'];
      if(icon&&icon.hash!==current?.modules['theme-icon-render']?.hash)onIconRenderer(evaluateModule(readModule(root,next,'theme-icon-render')));
      if(current&&[...rendererIds].some(id=>next.modules[id]?.hash!==current.modules[id]?.hash))log.info('[Modex development] Renderer modules changed; reload the window or restart when ready.');
      current=next;
      sources=nextSources;
      if(lastError)log.info('[Modex development] Module loading recovered.');
      lastError=undefined;
      return next;
    }catch(error){if(lastError!==error.message)log.error('[Modex development] Keeping last good modules:',error.message);lastError=error.message;return current;}
  };
  refresh.readModule=id=>{refresh();if(!Object.hasOwn(sources,id))throw new Error('Development module unavailable');return sources[id];};
  return refresh;
}
let active;
export function rendererSource(id,source) {
  const contract=rendererModules[id];
  if(!contract)throw Error('Unknown development renderer module');
  const dependency=id==='model-spread-editor'?`import * as ModelSpread from './model-spread.mjs';\n`:'';
  return `${dependency}const module={exports:{}};
const require=name=>{${id==='model-spread-editor'?`if(name==='./model-spread.mjs')return ModelSpread;`:''}throw Error('Unexpected development dependency: '+name);};
(function(require,module,exports){\n${source}\n})(require,module,module.exports);
${contract.exports.map(name=>`export const ${name}=module.exports.${name};`).join('\n')}
`;
}
export function responseFor(request) {
  let url;try{url=new URL(request.url);}catch{return null;}
  if(!url.pathname.startsWith('/assets/modex-development-'))return null;
  if(url.protocol!=='app:'||url.hostname!=='-'||url.port||url.username||url.password||url.search||url.hash)return new Response(null,{status:404});
  const match=/^\/assets\/modex-development-([a-z-]+)\.mjs$/.exec(url.pathname),id=match?.[1];
  if(!id||!Object.hasOwn(rendererModules,id))return new Response(null,{status:404});
  if(request.method!=='GET')return new Response(null,{status:405,headers:{Allow:'GET'}});
  try {
    if(!active)throw Error('Development runtime unavailable');
    return new Response(rendererSource(id,active.readModule(id)),{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
}
export function start({electron,root,expected,onIconRenderer,intervalMs=1000}) {
  const refresh=createRefresh({root,expected,onIconRenderer});let stopped=false;
  refresh();active=refresh;
  const timer=setInterval(()=>{if(!stopped)refresh();},intervalMs);timer.unref?.();
  const stop=()=>{
    if(stopped)return;stopped=true;clearInterval(timer);if(active===refresh)active=undefined;electron.app.removeListener('will-quit',stop);
  };
  electron.app.on('will-quit',stop);
  return stop;
}
