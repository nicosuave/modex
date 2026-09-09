import {test,expect} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {buildDevelopment,buildRuntime,computeHookHash} from './build.mjs';
import {inspectDevelopment,digest,evaluateModule} from './validation.mjs';
import {createRefresh,start,responseFor,rendererSource} from './main.mjs';
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'modex-dev-test-'));}
function publish(root,manifest){fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest));}
test('publishes repeatable complete generations and bundles runtime modules',async()=>{
  const root=temporary();try {
    const first=await buildDevelopment(root,['model-spread','theme-icon']);
    const second=await buildDevelopment(root,['theme-icon','model-spread']);
    expect(second).toEqual(first);
    expect(Object.keys(first.modules)).toHaveLength(4);
    const modelSource=fs.readFileSync(path.join(root,first.modules['model-spread'].file),'utf8');
    const model={exports:{}};new Function('module','exports',modelSource)(model,model.exports);
    expect(Object.keys(model.exports).length).toBeGreaterThan(0);
    const runtime=await buildRuntime();expect(Object.keys(runtime)).toEqual(['main.cjs']);
    expect(inspectDevelopment(root,first)).toEqual(first);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects manifest, tampered bytes, escaped files and mismatched hooks',async()=>{
  const root=temporary(),outside=temporary();try {
    const manifest=await buildDevelopment(root,['theme-icon']);
    expect(()=>inspectDevelopment(root,{...manifest,hookHash:'0'.repeat(64)})).toThrow('repackage');
    publish(root,{...manifest,modules:{...manifest.modules,unexpected:{}}});
    expect(()=>inspectDevelopment(root)).toThrow('module set');
    publish(root,manifest);
    const entry=manifest.modules['theme-icon-render'],file=path.join(root,entry.file),original=fs.readFileSync(file);
    fs.writeFileSync(file,'corrupted');expect(()=>inspectDevelopment(root)).toThrow('hash mismatch');
    fs.rmSync(file);fs.writeFileSync(path.join(outside,'module.cjs'),original);fs.symlinkSync(path.join(outside,'module.cjs'),file);
    expect(()=>inspectDevelopment(root)).toThrow('escapes root');
    publish(root,{...manifest,modules:{...manifest.modules,'theme-icon-render':{...entry,file:'../outside.cjs'}}});
    expect(()=>inspectDevelopment(root)).toThrow('Invalid development module path');
  }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
test('refresh adopts valid pure renderer, retains last good on failure, never reloads windows',async()=>{
  const root=temporary();try {
    const manifest=await buildDevelopment(root,['theme-icon']);let renderer,calls=0;const errors=[],messages=[];
    const refresh=createRefresh({root,expected:manifest,onIconRenderer:value=>{renderer=value;calls++;},log:{error:(...values)=>errors.push(values),info:value=>messages.push(value)}});
    expect(refresh()).toEqual(manifest);expect(calls).toBe(1);
    const prior=renderer,entry=manifest.modules['theme-icon-render'];
    const priorBrowser=refresh.readModule('theme-icon-runtime');
    fs.writeFileSync(path.join(root,entry.file),'throw new Error("broken");');
    expect(refresh()).toEqual(manifest);expect(renderer).toBe(prior);expect(calls).toBe(1);
    refresh();expect(errors).toHaveLength(1);expect(refresh.readModule('theme-icon-runtime')).toBe(priorBrowser);
    entry.hash=digest('throw new Error("broken");');publish(root,manifest);
    refresh();expect(renderer).toBe(prior);expect(calls).toBe(1);
    const source='exports.sourceVariant=()=>"dark";exports.renderPixels=p=>p;';
    fs.writeFileSync(path.join(root,entry.file),source);entry.hash=digest(source);publish(root,manifest);
    refresh();expect(calls).toBe(2);expect(renderer.sourceVariant()).toBe('dark');
    expect(errors.length).toBe(2);expect(messages).toEqual(['[Modex development] Module loading recovered.']);
    const browserEntry=manifest.modules['theme-icon-runtime'];
    fs.appendFileSync(path.join(root,browserEntry.file),'\n// changed renderer');
    browserEntry.hash=digest(fs.readFileSync(path.join(root,browserEntry.file)));publish(root,manifest);
    refresh();expect(messages).toHaveLength(2);expect(messages[1]).toContain('reload the window or restart');expect(calls).toBe(2);
    expect(()=>evaluateModule('module.exports={}')).toThrow('renderer exports');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('refuses app bundles, unowned output, corrupt owned output and invalid selections without replacing user files',async()=>{
  const root=temporary();try {
    const userFile=path.join(root,'manifest.json');fs.writeFileSync(userFile,'user document');
    await expect(buildDevelopment(root,['theme-icon'])).rejects.toThrow('Existing development output is invalid');
    expect(fs.readFileSync(userFile,'utf8')).toBe('user document');fs.renameSync(userFile,path.join(root,'notes.txt'));
    await expect(buildDevelopment(root,['theme-icon'])).rejects.toThrow('not owned');
    await expect(buildDevelopment(path.join(root,'Stock.app','dev'),['theme-icon'])).rejects.toThrow('app bundle');
    const output=path.join(root,'output');
    await expect(buildDevelopment(output,['theme-icon','theme-icon'])).rejects.toThrow('duplicates');
    await expect(buildDevelopment(output,['unknown'])).rejects.toThrow('unsupported');
    expect(fs.existsSync(output)).toBe(false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('hook hash tracks packaging and native authentication changes while excluding editable and generated sources',()=>{
  const root=temporary();try {
    const write=(file,content)=>{fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),content);};
    write('mods/combined/build-mod.mjs','bootstrap');write('mods/app-tools-auth/bridge.cpp','native');write('mods/app-tools-auth/bridge.h','header');
    const before=computeHookHash(['theme-icon'],root);
    write('mods/app-tools-auth/bridge.h','changed header');const header=computeHookHash(['theme-icon'],root);expect(header).not.toBe(before);
    write('mods/combined/build-mod.mjs','changed bootstrap');const combined=computeHookHash(['theme-icon'],root);expect(combined).not.toBe(header);
    write('mods/theme-icon/render.mjs','editable');write('mods/combined/dist/bundle.mjs','generated');
    expect(computeHookHash(['theme-icon'],root)).toBe(combined);
    write('mods/theme-icon/state.mjs','native validation');
    const state=computeHookHash(['theme-icon'],root);expect(state).not.toBe(combined);
    write('mods/theme-icon/state.mjs','changed native validation');
    expect(computeHookHash(['theme-icon'],root)).not.toBe(state);
    write('mods/model-spread/primary-adapter.template.js','primary hook');
    write('mods/model-spread/micro-adapter.template.js','micro hook');
    const primary=computeHookHash(['model-spread'],root);
    write('mods/model-spread/primary-adapter.template.js','changed primary hook');
    const micro=computeHookHash(['model-spread'],root);expect(micro).not.toBe(primary);
    write('mods/model-spread/micro-adapter.template.js','changed micro hook');
    expect(computeHookHash(['model-spread'],root)).not.toBe(micro);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('serves fixed renderer ESM URLs without eval, rejects invalid requests, shuts down cleanly',async()=>{
  const root=temporary();try {
    const manifest=await buildDevelopment(root,['theme-icon']);const handlers=new Map();let calls=0;
    const electron={app:{on:(name,fn)=>handlers.set(name,fn),removeListener:name=>handlers.delete(name)}};
    const request=(url,method='GET')=>({url,method});
    const valid=request('app://-/assets/modex-development-theme-icon-runtime.mjs');
    expect(responseFor(valid).status).toBe(503);
    const stop=start({electron,root,expected:manifest,onIconRenderer:()=>calls++,intervalMs:5});
    try {
      expect(responseFor(request('app://-/assets/stock.js'))).toBe(null);
      for(const url of ['https://-/assets/modex-development-theme-icon-runtime.mjs','app://fs/assets/modex-development-theme-icon-runtime.mjs','app://user@-/assets/modex-development-theme-icon-runtime.mjs','app://-:9/assets/modex-development-theme-icon-runtime.mjs','app://-/assets/modex-development-theme-icon-runtime.mjs?q=x','app://-/assets/modex-development-theme-icon-runtime.mjs#x','app://-/assets/modex-development-theme-icon-render.mjs'])expect(responseFor(request(url)).status).toBe(404);
      expect(responseFor(request(valid.url,'POST')).status).toBe(405);
      const response=responseFor(valid);expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('text/javascript');expect(response.headers.get('Cache-Control')).toBe('no-store');expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
      const source=await response.text();expect(source).not.toContain('new Function');
      const modulePath=path.join(root,'received.mjs');fs.writeFileSync(modulePath,source);
      const loaded=await import(modulePath);expect(typeof loaded.Settings).toBe('function');expect(typeof loaded.useTheme).toBe('function');
      handlers.get('will-quit')();await new Promise(resolve=>setTimeout(resolve,15));
      expect(responseFor(valid).status).toBe(503);expect(calls).toBe(1);
    }finally{stop();}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('editor ESM wrapper binds only its fixed model spread dependency',async()=>{
  const root=temporary();try {
    fs.writeFileSync(path.join(root,'model-spread.mjs'),'export const marker="from-model-spread";');
    const source=rendererSource('model-spread-editor','exports.Editor=require("./model-spread.mjs").marker;');
    const file=path.join(root,'editor.mjs');fs.writeFileSync(file,source);
    expect((await import(file)).Editor).toBe('from-model-spread');
    const bad=path.join(root,'bad.mjs');fs.writeFileSync(bad,rendererSource('model-spread-editor','require("node:fs");'));
    await expect(import(bad)).rejects.toThrow('Unexpected development dependency');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('external pane runtime shares the same drag coordinator as stock hooks',async()=>{
  const root=temporary(),priorActEnvironment=globalThis.IS_REACT_ACT_ENVIRONMENT;
  let view;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  try {
    const manifest=await buildDevelopment(root,['task-panes']);
    expect(Object.keys(manifest.modules).sort()).toEqual(['task-panes-drag','task-panes-runtime']);
    for(const id of ['task-panes-drag','task-panes-runtime']){
      const source=fs.readFileSync(path.join(root,manifest.modules[id].file),'utf8');
      fs.writeFileSync(path.join(root,`${id}.mjs`),rendererSource(id,source));
    }
    const dragModule=await import(path.join(root,'task-panes-drag.mjs'));
    const paneModule=await import(path.join(root,'task-panes-runtime.mjs'));
    expect(typeof paneModule.Workspace).toBe('function');
    const store=paneModule.createWorkspaceStore(),navigations=[];
    await act(async()=>{
      view=TestRenderer.create(React.createElement(paneModule.Workspace,{
        React,store,route:{routeKind:'local-thread',conversationId:'a',hostId:'local',pathname:'/local/a'},
        navigate:path=>navigations.push(path),
        Task:({task})=>React.createElement('div',{'data-rendered-task':task.key},task.title),
      },React.createElement('div',{'data-stock-task':true},'Stock task A')),
      {createNodeMock:element=>element.type==='div'?{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:700})}:null});
    });
    expect(view.root.findByProps({'data-stock-task':true})).toBeTruthy();
    // Use the external stock-hook dependency, without injecting a coordinator
    // or attaching a test handler: Workspace must own this same singleton.
    await act(async()=>{
      dragModule.drag.start([{key:'local:local:b',path:'/local/b',kind:'local',routeKind:'local-thread',conversationId:'b',hostId:'local',title:'Task B'}]);
      dragModule.drag.move({x:990,y:350});
    });
    expect(view.root.findByProps({'data-modex-drop-preview':'right'}).findByType('span').children).toEqual(['Split right']);
    await act(async()=>{expect(dragModule.drag.drop()).toBe(true);});
    expect(store.getSnapshot().root.type).toBe('split');
    expect(store.getSnapshot().root.first.tabs.map(task=>task.key)).toEqual(['local:local:a']);
    expect(store.getSnapshot().root.second.tabs.map(task=>task.key)).toEqual(['local:local:b']);
    expect(view.root.findByProps({'data-modex-task-key':'local:local:b'}).props['data-modex-pane-active']).toBe('true');
    expect(view.root.findAllByProps({'data-modex-drop-preview':'right'})).toHaveLength(0);
    expect(navigations).toEqual(['/local/b']);
    const bad=path.join(root,'pane-bad.mjs');fs.writeFileSync(bad,rendererSource('task-panes-runtime','require("node:fs");'));
    await expect(import(bad)).rejects.toThrow('Unexpected development dependency');
  }finally{
    if(view)await act(async()=>view.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT=priorActEnvironment;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('custom CLI stays packaged while selected renderer modules remain editable',async()=>{
  const root=temporary();
  try {
    const manifest=await buildDevelopment(root,['task-panes','custom-cli']);
    expect(manifest.mods).toEqual(['custom-cli','task-panes']);
    expect(Object.keys(manifest.modules).sort()).toEqual(['task-panes-drag','task-panes-runtime']);
    expect(inspectDevelopment(root,{hookHash:computeHookHash(['task-panes','custom-cli']),mods:['task-panes','custom-cli'],source:manifest.source})).toEqual(manifest);
    expect(()=>inspectDevelopment(root,{hookHash:computeHookHash(['task-panes']),mods:['task-panes'],source:manifest.source})).toThrow();
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
