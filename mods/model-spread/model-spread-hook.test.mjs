import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {EVENT,EMPTY,store,useComposer} from './model-spread.mjs';
import {testStorage} from './test-storage.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const choices=['a','b','c','d'].map(model=>({model,reasoningEffort:'high',id:`${model}:high`}));
function Probe(props){useComposer(React,props);return null;}
function turn(root,direction=1){root.dispatchEvent(new CustomEvent(EVENT,{detail:{direction}}));}
async function harness(initial={}) {
  testStorage.fail=false;
  store().save({...EMPTY,micro:true});
  const root=new EventTarget(),trigger={current:{closest:()=>root}},calls=[];
  let props={trigger,choices,model:'a',effort:'high',enabled:true,select:choice=>{calls.push(choice.model);},...initial};
  let renderer;
  await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe,props));});
  return {root,trigger,calls,
    async update(next){props={...props,...next};await act(async()=>renderer.update(React.createElement(Probe,props)));},
    async turn(direction=1){await act(async()=>turn(root,direction));},
    async close(){await act(async()=>renderer.unmount());},
  };
}

test('attaches after initial loading when the stable trigger ref receives a root',async()=>{
  const trigger={current:null},h=await harness({trigger,enabled:false});
  try {
    await h.turn();assert.deepEqual(h.calls,[]);
    trigger.current={closest:()=>h.root};
    await h.update({enabled:true});
    await h.turn();assert.deepEqual(h.calls,['b']);
  } finally {await h.close();}
});

test('knob then mouse picker then knob follows the latest actual selection',async()=>{
  const h=await harness();
  try {
    await h.turn();assert.deepEqual(h.calls,['b']);
    await h.update({model:'b'});
    await h.update({model:'d'});
    await h.turn(-1);assert.deepEqual(h.calls,['b','c']);
  } finally {await h.close();}
});

test('rapid detents advance before React renders and acknowledge intermediate updates',async()=>{
  const h=await harness();
  try {
    await act(async()=>{turn(h.root);turn(h.root);});
    assert.deepEqual(h.calls,['b','c']);
    await h.update({model:'b'});
    await h.turn();assert.deepEqual(h.calls,['b','c','d']);
    await h.update({model:'d'});
    await h.turn();assert.deepEqual(h.calls,['b','c','d']);
    await h.turn(-1);assert.deepEqual(h.calls,['b','c','d','c']);
  } finally {await h.close();}
});

test('a rejected selection does not leave an optimistic cursor behind',async()=>{
  const calls=[];let fail=true;
  const h=await harness({select:choice=>{calls.push(choice.model);return Promise.resolve(fail?false:undefined);}});
  try {
    await h.turn();assert.deepEqual(calls,['b']);
    fail=false;
    await h.turn();assert.deepEqual(calls,['b','b']);
  } finally {await h.close();}
});

test('a rapid reversal back to the original pair is acknowledged before mouse selection',async()=>{
  const h=await harness();
  try {
    await act(async()=>{turn(h.root);turn(h.root,-1);});
    assert.deepEqual(h.calls,['b','a']);
    await h.update({model:'a'});
    await h.update({model:'b'});
    await h.turn();assert.deepEqual(h.calls,['b','a','c']);
  } finally {await h.close();}
});

test('mode and composer disable suppress events and reset unacknowledged navigation',async()=>{
  const h=await harness();
  try {
    await h.turn();
    await act(async()=>store().save({...store().get(),micro:false}));
    await h.turn();assert.deepEqual(h.calls,['b']);
    await act(async()=>store().save({...store().get(),micro:true}));
    await h.turn();assert.deepEqual(h.calls,['b','b']);
    await h.update({enabled:false});
    await h.turn();assert.deepEqual(h.calls,['b','b']);
    await h.update({enabled:true});
    await h.turn();assert.deepEqual(h.calls,['b','b','b']);
  } finally {await h.close();}
});

test('moving roots and unmounting detach the old event listener',async()=>{
  const h=await harness(),replacement=new EventTarget();
  h.trigger.current={closest:()=>replacement};
  await h.update({});
  await h.turn();assert.deepEqual(h.calls,[]);
  await act(async()=>turn(replacement));assert.deepEqual(h.calls,['b']);
  await h.close();
  turn(replacement);assert.deepEqual(h.calls,['b']);
});
