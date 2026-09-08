export const KEY = 'nico.codex.model-spread.v1';
export const EVENT = 'nico:model-spread-step';
export const EMPTY = Object.freeze({version:1, slots:null, micro:false});
export function validate(value) {
  if (!value || value.version !== 1 || typeof value.micro !== 'boolean') throw Error('Invalid model spread settings');
  if (value.slots !== null && (!Array.isArray(value.slots) || value.slots.length < 1 || value.slots.length > 32 || value.slots.some(s => !s || typeof s.model !== 'string' || !s.model || typeof s.reasoningEffort !== 'string' || !s.reasoningEffort))) throw Error('A spread needs 1–32 model and reasoning slots');
  return {version:1, micro:value.micro, slots:value.slots?.map(({model,reasoningEffort})=>({model,reasoningEffort})) ?? null};
}
export function resolveSlots(slots, models) {
  return (slots ?? []).map((slot,index) => {
    const model = models?.find(m => m.model === slot.model);
    const available = !!model?.supportedReasoningEfforts?.some(e => e.reasoningEffort === slot.reasoningEffort);
    return {...slot, id:`${slot.model}:${slot.reasoningEffort}`, modelLabel:model?.displayName ?? slot.model, slotIndex:index, available};
  });
}
export function selections(slots, models) {
  // The native slider identifies selections by model:effort. Keep repeated models,
  // but collapse identical pairs so native selection/focus remains unambiguous.
  const seen = new Set();
  return resolveSlots(slots, models).filter(s => s.available && !seen.has(s.id) && seen.add(s.id)).map((s,index)=>({...s,powerSettingIndex:index}));
}
export function step(list, model, effort, direction) {
  if (!list.length) return null;
  const index=list.findIndex(s=>s.model===model && s.reasoningEffort===effort);
  if(index < 0) return direction > 0 ? list[0] : list.at(-1);
  return list[Math.max(0,Math.min(list.length-1,index + direction))];
}
export function createStore(storage, target) {
  let state=EMPTY, error=null;
  const listeners=new Set();
  function read() {try {const raw=storage?.getItem(KEY);state=raw ? validate(JSON.parse(raw)) : EMPTY;error=null;} catch(e) {error=e.message;state=EMPTY;}}
  read();
  const notify=()=>listeners.forEach(fn=>fn());
  target?.addEventListener('storage', e=>{if(e.key===KEY || e.key===null){read();notify();}});
  return {get:()=>state, getError:()=>error, subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}, save(value){const next=validate(value);if(!storage)throw Error('Settings storage is unavailable');storage.setItem(KEY,JSON.stringify(next));state=next;error=null;notify();}};
}
let singleton,persistence;
export function configurePersistence(storage,target){if(singleton)throw Error('Model spread store already initialized');persistence={storage,target};}
export function store() {
  if(!singleton){let storage=persistence?.storage;try{storage??=globalThis.localStorage;}catch{} singleton=createStore(storage,persistence?.target??globalThis.window);}
  return singleton;
}
export function useSettings(React) {return React.useSyncExternalStore(store().subscribe,store().get,store().get);}
export function microEnabled() {return store().get().micro;}
export function setMicro(enabled) {store().save({...store().get(),micro:enabled});}
export function useComposer(React,{trigger,choices,model,effort,enabled,select}) {
  const {micro}=useSettings(React);
  const latest=React.useRef(null);
  const tracking=React.useRef({observed:null,pending:[],root:null,handle:null});
  latest.current={choices,model,effort,enabled,micro,select};
  function reconcile() {
    const state=tracking.current,now=latest.current,id=`${now.model}:${now.effort}`;
    if(!now.enabled || !microEnabled()) state.pending=[];
    if(state.observed!==id) {
      // A rendered knob selection acknowledges that request and earlier ones.
      // Any other change came from the picker/task and replaces the knob cursor.
      const index=state.pending.findIndex(request=>request.choice.id===id);
      state.pending=index<0 ? [] : state.pending.slice(index+1);
      state.observed=id;
    }
    state.pending=state.pending.filter(request=>now.choices.some(choice=>choice.id===request.choice.id));
  }
  // No dependency array: the native component can initially render null while
  // models load, and a stable trigger ref can later point at a different root.
  React.useEffect(()=>{
    const state=tracking.current;
    reconcile();
    // A burst can return to the original pair without changing the observed id.
    // A committed render at that final target still acknowledges the burst.
    if(state.pending.at(-1)?.choice.id===`${model}:${effort}`)state.pending=[];
    const root=trigger.current?.closest('[data-codex-composer-root]')??null;
    if(root===state.root) return;
    if(state.root) state.root.removeEventListener(EVENT,state.handle);
    state.root=root;
    state.pending=[];
    if(!root) return;
    state.handle=e=>{
      reconcile();
      const now=latest.current;
      if(!microEnabled() || !now.enabled || ![-1,1].includes(e.detail?.direction)) return;
      const current=state.pending.at(-1)?.choice??{model:now.model,reasoningEffort:now.effort};
      const next=step(now.choices,current.model,current.reasoningEffort,e.detail.direction);
      if(!next || (next.model===current.model && next.reasoningEffort===current.reasoningEffort)) return;
      const request={choice:next};
      state.pending.push(request);
      const discard=()=>{state.pending=state.pending.filter(item=>item!==request);};
      try {
        Promise.resolve(now.select(next)).then(result=>{if(result===false)discard();}).catch(error=>{discard();console.error('Model spread selection failed',error);});
      } catch(error) {discard();console.error('Model spread selection failed',error);}
    };
    root.addEventListener(EVENT,state.handle);
  });
  React.useEffect(()=>()=>{
    const state=tracking.current;
    if(state.root)state.root.removeEventListener(EVENT,state.handle);
    state.root=null;
    state.pending=[];
  },[]);
}
const hostDefaults=new Map();
export function customChoices(settings,models,defaults,hostId) {
  hostDefaults.set(hostId,defaults);
  return settings.slots===null ? defaults : selections(settings.slots,models);
}
export function defaultChoices(hostId,fallback) {return hostDefaults.get(hostId)??fallback;}
