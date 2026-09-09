import {test,expect} from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {act,create} from 'react-test-renderer';
import {transform,files,providerAdapter} from './build-mod.mjs';
import {composerAvailable,getPaneContext} from './runtime.mjs';
import {createDragCoordinator} from './drag.mjs';
import {selectMods,defaultMods,compatibilityFor} from '../combined/compatibility.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
test('panes are opt-in and canonical selection preserves existing defaults',()=>{
  expect(defaultMods).toEqual(['model-spread','theme-icon']);
  expect(selectMods(['task-panes','theme-icon','model-spread'])).toEqual(['model-spread','theme-icon','task-panes']);
  expect(Object.keys(compatibilityFor(['task-panes']).files)).toContain(files.localThread);
  expect(()=>transform({})).toThrow('Task Panes anchor');
});

for(const kind of ['local','cloud'])test(`stock provider adapter isolates ${kind} task location, params, and scopes`,async()=>{
  const Location=React.createContext(null),Route=React.createContext({matches:[]});
  const location={pathname:'/local/other',search:'',state:{prefillPrompt:'private draft'}};
  const task=kind==='local'?{kind,conversationId:'task-a',hostId:'nicbook-atm',key:'local:nicbook-atm:task-a',path:'/local/task-a?hostId=nicbook-atm'}:{kind,taskId:'cloud-a',key:'cloud:cloud-a',path:'/remote/cloud-a'};
  let observed;
  function Scope({route,children}){observed={...observed,route};return children;}
  function Composer({children}){observed={...observed,composer:true};return children;}
  function Content(){observed={...observed,location:React.useContext(Location).location,params:React.useContext(Route).matches.at(-1).params};return null;}
  const body=providerAdapter.slice(0,providerAdapter.indexOf('function ModexPaneShell')).replace('export function','function');
  const Adapter=new Function('mT','$Ds','IDs','iT','TaskPanesRuntime','Zw','pT','fT','JDs','NDs',body+';return ModexPaneProviders;')(()=>{},()=>{},()=>{},React,{usePane:()=>React.useContext(getPaneContext(React))},()=>location,Route,Location,Scope,Composer);
  let tree;
  await act(async()=>{tree=create(React.createElement(Route.Provider,{value:{matches:[{params:{conversationId:'other',taskId:'wrong'}}]}},React.createElement(getPaneContext(React).Provider,{value:{active:false}},React.createElement(Adapter,{task},React.createElement(Content)))));});
  expect(observed.location.state).toBe(null);
  expect(observed.location.pathname).toBe(kind==='local'?'/local/task-a':'/remote/cloud-a');
  expect(observed.params).toEqual(kind==='local'?{conversationId:'task-a'}:{taskId:'cloud-a'});
  expect(observed.route.routeKind).toBe(kind==='local'?'local-thread':'remote-thread');
  expect(observed.composer).toBe(true);
  if(kind==='local')expect(observed.route.hostId).toBe('nicbook-atm');
  await act(async()=>tree.unmount());
});

const root=process.env.TASK_PANES_BUNDLES;
let patched;
function output(){
  if(!patched){const manifest=JSON.parse(fs.readFileSync(new URL('./compatibility.json',import.meta.url)));patched=transform(Object.fromEntries(Object.keys(manifest.files).map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')])));}
  return patched;
}
test.skipIf(!root)('transformed native composer registry never selects a hidden or unfocused pane',()=>{
  const code=output()[files.initial],start=code.indexOf('function iN(){'),end=code.indexOf('function d5n(',start);
  const range=code.slice(start,end);
  const element=(active,visible=true)=>({isConnected:true,closest:()=>({getAttribute:name=>String(name==='data-modex-pane-active'?active:visible),hidden:!visible,inert:!visible})});
  const hidden=element(true,false),inactive=element(false),active=element(true),map=new Map([[hidden,{isPrimaryComposer:true}],[inactive,{isPrimaryComposer:true}],[active,{isPrimaryComposer:true}]]);
  const choose=new Function('aN','cN','TaskPanesRuntime','document','y5n',range+';return iN();');
  expect(choose(map,hidden,{composerAvailable},{querySelectorAll:()=>[hidden,inactive,active]},[])).toBe(active);
  expect(choose(new Map([[hidden,{isPrimaryComposer:true}]]),hidden,{composerAvailable},{querySelectorAll:()=>[hidden]},[])).toBe(null);
});
test.skipIf(!root)('actual stock drag end still inserts references, while accepted pane drops cancel reordering',()=>{
  const code=output()[files.primary],start=code.indexOf('te=e=>{if(mEn(k.current,A.current)==null&&TaskPanesDrag.drop())'),end=code.indexOf(',t[14]=a,t[15]=o,t[16]=s,t[17]=te',start);
  expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
  const handler=code.slice(start+3,end);
  for(const reference of [true,false]){
    const drag=createDragCoordinator();let paneDrops=0,references=0,cancels=0;
    drag.attach({preview:()=>{},drop:()=>{paneDrops++;return true;}});
    drag.start([{key:'local:a',path:'/local/a'}]);drag.move({x:100,y:100});
    const target={},payload=[{threadId:'a',hostId:'local',title:'A'}],thread={threadId:'a',threadKey:'local:a'};
    const bindings={TaskPanesDrag:drag,mEn:()=>reference?target:null,ee:()=>cancels++,l:{current:null},S:()=>{},k:{current:100},A:{current:100},EZ:x=>x,cEn:()=>null,D:{current:[thread]},kCn:()=>payload,yZ:()=>{},SZ:()=>{},j:{current:null},w:{current:null},L:()=>{},v:()=>{},m:()=>{},hEn:(element,items)=>{expect(element).toBe(target);expect(items).toEqual(payload);references++;return true;}};
    const fn=new Function(...Object.keys(bindings),'return '+handler)(...Object.values(bindings));
    fn({active:{data:{current:{kind:'sidebar-item',thread}}}});
    expect(references).toBe(reference?1:0);expect(paneDrops).toBe(reference?0:1);expect(cancels).toBe(reference?0:1);
  }
});
test.skipIf(!root)('exact transforms reject repeated application and changed call sites',()=>{
  expect(()=>transform(output())).toThrow('Task Panes anchor');
  const changed={...output(),[files.initial]:output()[files.initial].replace('ModexTaskPage','UnknownTaskPage')};
  expect(()=>transform(changed)).toThrow();
});

test.skipIf(!root)('stock reference lookup yields whole-panel hits only while the workspace accepts the task drag',()=>{
  const code=output()[files.primary],start=code.indexOf('function mEn('),end=code.indexOf('function hEn(',start);
  class Element {closest(){return this;}}
  const target=new Element(),registry=new WeakMap([[target,{hostId:'local'}]]);
  let accepts=false;
  const lookup=new Function('TaskPanesDrag','document','HTMLElement','CZ','gEn',code.slice(start,end)+';return mEn;')({claims:()=>accepts},{elementsFromPoint:()=>[target]},Element,registry,'data-codex-thread-reference-drop-target');
  expect(lookup(100,100)).toBe(target);
  accepts=true;expect(lookup(100,100)).toBeNull();
  accepts=false;expect(lookup(100,100)).toBe(target);
  expect(lookup(100,100,'other-host')).toBeNull();
});
