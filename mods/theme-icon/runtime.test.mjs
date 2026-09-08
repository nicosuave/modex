import {test} from 'bun:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {useTheme} from './runtime.mjs';
import {KEY,setVariant} from './state.mjs';

test('root theme subscription sends actual colors, reacts to custom changes, persisted choice and focus',async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const oldWindow=globalThis.window;
  const target=new EventTarget();globalThis.window=target;
  const messages=[],watchers=new Set();let settings=null,root;
  const read=()=>settings;
  const write=(key,value)=>{assert.equal(key,KEY);settings=value;for(const fn of watchers)fn();};
  const listen=(key,fallback,fn)=>{assert.equal(key,KEY);watchers.add(fn);return()=>watchers.delete(fn);};
  const bridge={dispatchMessage:(type,payload)=>messages.push({type,...payload})};
  function Host({theme,id='gruvbox',appearance='dark'}) {
    useTheme(React,{theme,id,appearance,read,write,listen,bridge});return null;
  }
  const settle=()=>new Promise(resolve=>setTimeout(resolve,100));
  try {
    await act(async()=>{root=TestRenderer.create(React.createElement(Host,{theme:{surface:'#282828',accent:'#458588'}}));});
    await act(settle);
    assert.deepEqual(messages.at(-1),{type:'modex-theme-icon',appearance:'dark',variant:'theme',surface:'#282828',accent:'#458588'});
    await act(async()=>root.update(React.createElement(Host,{theme:{surface:'#323020',accent:'#aacc11'}})));
    await act(settle);
    assert.equal(messages.at(-1).accent,'#aacc11');assert.equal(messages.at(-1).surface,'#323020');
    await act(async()=>write(KEY,setVariant(settings,'dark:gruvbox','light')));
    await act(settle);assert.equal(messages.at(-1).variant,'light');
    target.dispatchEvent(new Event('focus'));assert.equal(messages.at(-1).variant,'light');
    await act(async()=>root.update(React.createElement(Host,{id:'nord',appearance:'light',theme:{surface:'#ffffff',accent:'#88c0d0'}})));
    await act(settle);assert.equal(messages.at(-1).variant,'theme');assert.equal(messages.at(-1).appearance,'light');
    await act(async()=>root.unmount());assert.equal(watchers.size,0);
    const count=messages.length;target.dispatchEvent(new Event('focus'));assert.equal(messages.length,count);
  }finally {globalThis.window=oldWindow;}
});

test('settings offers each variant, persists selection and reports stock preference save failures',async()=>{
  const {Settings}=await import('./runtime.mjs');
  const oldWindow=globalThis.window,oldImage=globalThis.Image;
  globalThis.window=new EventTarget();
  // Image loading is left pending; visual/canvas behavior is checked in Electron.
  globalThis.Image=class {set src(value){}};
  let settings=null,root,enableCalls=0;
  const watchers=new Set(),read=()=>settings;
  const write=(key,value)=>{settings=value;for(const fn of watchers)fn();};
  const listen=(key,fallback,fn)=>{watchers.add(fn);return()=>watchers.delete(fn);};
  const Row=({label,description,control})=>React.createElement('section',null,label,description,control);
  const Dropdown=({triggerButton,children})=>React.createElement('div',null,triggerButton,children);
  const DropdownButton=props=>React.createElement('button',props);
  const CheckIcon=()=>null;
  const Menu={Section:({children})=>React.createElement('div',null,children),
    Item:({children})=>React.createElement('div',null,children)};
  function Host({enabled=false}) {
    useTheme(React,{theme:{accent:'#458588',surface:'#282828',ink:'#ebdbb2',semanticColors:{skill:'#b16286',diffAdded:'#98971a',diffRemoved:'#cc241d'}},id:'gruvbox',appearance:'dark',read,write,listen,bridge:{dispatchMessage(){}}});
    return React.createElement(Settings,{React,Row,Dropdown,DropdownButton,Menu,CheckIcon,enabled,previews:{codexDark:'test-dark',codexLight:'test-light'},
      onEnable:async()=>{enableCalls++;throw new Error('Could not save Dock preference');}});
  }
  try {
    await act(async()=>{root=TestRenderer.create(React.createElement(Host));});
    const radios=root.root.findAllByProps({name:'modex-theme-icon-color'});
    assert.deepEqual(radios.map(r=>r.props['aria-label']),['Accent','Foreground','Highlight','Added','Removed']);
    assert.equal(root.root.findAllByType('section').length,1);
    const items=()=>root.root.findAllByType(Menu.Item);
    assert.deepEqual(items().map(item=>item.props.children),['Theme background','Dark tile','Light tile','Original']);
    assert.equal(items()[0].props.RightIcon,CheckIcon);
    assert.equal(root.root.findByType(DropdownButton).props.children,'Theme background');
    await act(async()=>{await items()[2].props.onSelect();});
    assert.equal(items()[2].props.RightIcon,CheckIcon);
    assert.equal(items()[0].props.RightIcon,undefined);
    assert.equal(root.root.findByType(DropdownButton).props.children,'Light tile');
    assert.equal(settings.variants['dark:gruvbox'],'light');assert.equal(enableCalls,1);
    assert.equal(root.root.findByProps({role:'alert'}).children[0],'Could not save Dock preference');
    await act(async()=>root.update(React.createElement(Host,{enabled:true})));
    await act(async()=>{root.root.findAllByProps({name:'modex-theme-icon-color'})[3].props.onChange();});
    assert.equal(settings.colors['dark:gruvbox'],'semantic.diffAdded');
    assert.equal(root.root.findAllByProps({name:'modex-theme-icon-color'})[3].props.checked,true);
    assert.equal(enableCalls,1);
    await act(async()=>root.unmount());
  }finally {globalThis.window=oldWindow;globalThis.Image=oldImage;}
});
