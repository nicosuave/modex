import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {Editor} from './editor.mjs';
import {EMPTY,store} from './model-spread.mjs';
import {testStorage as storage} from './test-storage.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const h=React.createElement;
const models=[
  {model:'a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},
  {model:'b',displayName:'Model B',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high'}]},
  {model:'c',displayName:'Model C',defaultReasoningEffort:'max',supportedReasoningEfforts:[{reasoningEffort:'max'}]},
];
const initial=[{model:'a',reasoningEffort:'low'},{model:'b',reasoningEffort:'high'}];
const defaults=[{model:'a',reasoningEffort:'high'}];
function Container({children}){return h('div',null,children);}
function Dialog({open,onOpenChange,triggerContent,children,size}) {
  return h(React.Fragment,null,
    triggerContent&&React.cloneElement(triggerContent,{onClick:()=>onOpenChange(true)}),
    open&&h('section',{role:'dialog','data-size':size},
      h('button',{'aria-label':size==='wide'?'Close editor':'Close confirmation',onClick:()=>onOpenChange(false)},'Close'),children));
}
const Native={Dialog,Body:Container,Section:Container,Footer:Container,
  Heading:({title,subtitle})=>h('header',null,title,subtitle),Title:({children})=>h('h2',null,children),Description:({children})=>h('p',null,children),
  Button:({children,color,uniform,size,...props})=>h('button',props,children),
  Rewind:()=>h('span',null,'rewind'),
};
function Picker({slot,onChange}) {
  return h('div',null,
    h('select',{'aria-label':'Slot model',value:slot.model,onChange:event=>{
      const model=models.find(item=>item.model===event.target.value);
      onChange({model:model.model,reasoningEffort:model.defaultReasoningEffort});
    }},models.map(model=>h('option',{key:model.model,value:model.model},model.displayName))),
    h('select',{'aria-label':'Slot effort',value:slot.reasoningEffort,onChange:event=>onChange({...slot,reasoningEffort:event.target.value})},
      models.find(model=>model.model===slot.model)?.supportedReasoningEfforts.map(({reasoningEffort})=>h('option',{key:reasoningEffort,value:reasoningEffort},reasoningEffort))));
}
function text(node) {
  if(typeof node==='string')return node;
  return node.children?.map(text).join('')??'';
}
async function harness(slots=initial) {
  storage.fail=false;
  store().save({...EMPTY,micro:true,slots});
  let renderer;
  await act(async()=>{renderer=TestRenderer.create(h(Editor,{React,Native,Picker,models,defaults,trigger:h('button',null,'Configure')}));});
  const button=label=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']===label||text(node)===label);
  const groups=()=>renderer.root.findAll(node=>node.type==='div'&&node.props.role==='group');
  const indicators=()=>groups().flatMap((node,index)=>[
    ...(node.props['data-drop-before']?[{index,edge:'before'}]:[]),
    ...(node.props['data-drop-after']?[{index,edge:'after'}]:[]),
  ]);
  return {renderer,
    async click(label){const node=button(label);assert.ok(node,`Button ${label} exists`);assert.notEqual(node.props.disabled,true,`Button ${label} is enabled`);await act(async()=>node.props.onClick());},
    async choose(label,value,index=0){const group=groups()[index];assert.ok(group,`Slot ${index+1} exists`);const select=group.findAllByType('select').find(node=>node.props['aria-label']===label);assert.ok(select);await act(async()=>select.props.onChange({target:{value}}));},
    async key(index,key){const node=button(`Reorder slot ${index+1}`);assert.ok(node);let prevented=false;await act(async()=>node.props.onKeyDown({key,preventDefault(){prevented=true;}}));return prevented;},
    async drag(from,to,edge='before',{cancel=false}={}){
      const handle=button(`Reorder slot ${from+1}`),data=new Map();
      const dataTransfer={setData:(key,value)=>data.set(key,value)};
      assert.equal(handle.props.draggable,true);
      await act(async()=>handle.props.onDragStart({dataTransfer}));
      const target=groups()[to];let accepted=false;
      const rect={top:100+to*48,height:44};
      const event={dataTransfer,clientY:rect.top+(edge==='after'?33:11),currentTarget:{getBoundingClientRect:()=>rect},preventDefault(){accepted=true;}};
      await act(async()=>target.props.onDragOver(event));
      assert.equal(accepted,true);assert.equal(dataTransfer.effectAllowed,'move');assert.equal(dataTransfer.dropEffect,'move');
      const expected=edge==='after'&&to<groups().length-1?{index:to+1,edge:'before'}:{index:to,edge};
      assert.deepEqual(indicators(),[expected],'one insertion divider appears at the hovered boundary');
      if(cancel)await act(async()=>handle.props.onDragEnd());
      else await act(async()=>groups()[to].props.onDrop(event));
      assert.deepEqual(indicators(),[],'the insertion divider clears after drop or cancellation');
    },
    rows(){return groups().map(node=>node.props['aria-label']);},
    pickerCounts(){return groups().map(node=>node.findAllByType('select').length);},
    alerts(){return renderer.root.findAll(node=>node.props.role==='alert').map(text);},
    async close(){storage.fail=false;await act(async()=>renderer.unmount());},
  };
}

test('opening reads saved slots; add, edit, reorder and remove persist only on Done',async()=>{
  const editor=await harness();
  try {
    assert.deepEqual(editor.rows(),[]);
    await editor.click('Configure');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, low','Slot 2: Model B, high']);
    assert.deepEqual(editor.pickerCounts(),[2,2]);
    await editor.click('Add slot');
    await editor.choose('Slot model','c',2);
    await editor.key(2,'ArrowUp');
    await editor.click('Remove slot 1');
    assert.deepEqual(editor.rows(),['Slot 1: Model C, max','Slot 2: Model B, high']);
    assert.deepEqual(store().get().slots,initial);
    await editor.click('Done');
    assert.deepEqual(store().get().slots,[{model:'c',reasoningEffort:'max'},initial[1]]);
    assert.equal(store().get().micro,true);
    assert.deepEqual(editor.rows(),[]);
  } finally {await editor.close();}
});

test('drag reorders inline slots and editing afterward targets the moved row',async()=>{
  const editor=await harness([...initial,{model:'c',reasoningEffort:'max'}]);
  try {
    await editor.click('Configure');
    await editor.drag(2,0,'before');
    assert.deepEqual(editor.rows(),['Slot 1: Model C, max','Slot 2: Model A, low','Slot 3: Model B, high']);
    await editor.choose('Slot effort','high',1);
    await editor.drag(0,2,'after');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, high','Slot 2: Model B, high','Slot 3: Model C, max']);
    await editor.click('Done');
    assert.deepEqual(store().get().slots,[{model:'a',reasoningEffort:'high'},initial[1],{model:'c',reasoningEffort:'max'}]);
  } finally {await editor.close();}
});

test('drag insertion boundaries beside the source are no-ops and canceled drag preserves order',async()=>{
  const slots=[...initial,{model:'c',reasoningEffort:'max'}],editor=await harness(slots);
  try {
    await editor.click('Configure');
    const original=editor.rows();
    for(const [from,to,edge]of [[1,1,'before'],[1,1,'after'],[1,2,'before'],[1,0,'after'],[0,0,'before'],[2,2,'after']]) {
      await editor.drag(from,to,edge);
      assert.deepEqual(editor.rows(),original);
    }
    await editor.drag(0,2,'after',{cancel:true});
    assert.deepEqual(editor.rows(),original);
    await editor.click('Done');
    assert.deepEqual(store().get().slots,slots);
  } finally {await editor.close();}
});

test('keyboard drag handles reorder in both directions and stop at endpoints',async()=>{
  const editor=await harness();
  try {
    await editor.click('Configure');
    assert.equal(await editor.key(0,'ArrowUp'),true);
    assert.equal(await editor.key(1,'ArrowDown'),true);
    assert.equal(await editor.key(0,'Enter'),false);
    assert.deepEqual(editor.rows(),['Slot 1: Model A, low','Slot 2: Model B, high']);
    await editor.key(0,'ArrowDown');
    assert.deepEqual(editor.rows(),['Slot 1: Model B, high','Slot 2: Model A, low']);
    await editor.key(1,'ArrowUp');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, low','Slot 2: Model B, high']);
    await editor.click('Done');
    assert.deepEqual(store().get().slots,initial);
  } finally {await editor.close();}
});

test('closing without Done discards draft edits and reopening reads saved state',async()=>{
  const editor=await harness();
  try {
    await editor.click('Configure');
    await editor.choose('Slot effort','high');
    await editor.click('Close editor');
    assert.deepEqual(store().get().slots,initial);
    await editor.click('Configure');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, low','Slot 2: Model B, high']);
  } finally {await editor.close();}
});

test('rewind confirmation cancel preserves draft; confirm changes draft and Done restores defaults',async()=>{
  const editor=await harness();
  try {
    await editor.click('Configure');
    await editor.choose('Slot model','c');
    const draft=editor.rows();
    await editor.click('Restore default spread');
    assert.equal(editor.renderer.root.findAll(node=>node.type==='section'&&node.props.role==='dialog').length,2);
    await editor.click('Cancel');
    assert.deepEqual(editor.rows(),draft);
    assert.deepEqual(store().get().slots,initial);
    await editor.click('Restore default spread');
    await editor.click('Restore defaults');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, high']);
    assert.deepEqual(store().get().slots,initial);
    await editor.click('Done');
    assert.equal(store().get().slots,null);
    await editor.click('Configure');
    assert.deepEqual(editor.rows(),['Slot 1: Model A, high']);
  } finally {await editor.close();}
});

test('unavailable saved slots remain visible and retain their original model pair',async()=>{
  const unavailable={model:'retired-model',reasoningEffort:'ultra'},editor=await harness([unavailable]);
  try {
    await editor.click('Configure');
    assert.deepEqual(editor.rows(),['Slot 1: retired-model, ultra']);
    assert.ok(editor.renderer.root.findAllByType('span').some(node=>text(node).includes('Unavailable on this host')));
    await editor.click('Done');
    assert.deepEqual(store().get().slots,[unavailable]);
  } finally {await editor.close();}
});

test('storage failure is displayed and leaves the saved spread and draft intact',async()=>{
  const editor=await harness();
  try {
    await editor.click('Configure');
    await editor.choose('Slot effort','high');
    storage.fail=true;
    await editor.click('Done');
    assert.deepEqual(editor.alerts(),['Storage quota exceeded']);
    assert.deepEqual(store().get().slots,initial);
    assert.deepEqual(editor.rows(),['Slot 1: Model A, high','Slot 2: Model B, high']);
    storage.fail=false;
    await editor.click('Done');
    assert.deepEqual(store().get().slots,[{model:'a',reasoningEffort:'high'},initial[1]]);
  } finally {await editor.close();}
});
