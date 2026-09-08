import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {transform} from './build-mod.mjs';

const directory=process.env.MODEL_SPREAD_BUNDLES ? path.resolve(process.env.MODEL_SPREAD_BUNDLES) : path.join(import.meta.dirname,'bundles');
const manifest=JSON.parse(fs.readFileSync(new URL('./compatibility.json',import.meta.url),'utf8'));
const available=Object.keys(manifest.files).every(name=>fs.existsSync(path.join(directory,name)));

test('actual HOME normalization retains custom High/Max after optimistic selection clears',{skip:!available},()=>{
  const bundles=Object.fromEntries(Object.keys(manifest.files).map(name=>[name,fs.readFileSync(path.join(directory,name),'utf8')]));
  const initial=Object.keys(bundles).find(name=>name.startsWith('app-initial-'));
  const patched=transform(bundles);
  function normalize(source){
    const start=source.indexOf('oe=V.reasoningEffort;if(ie');
    const end=source.indexOf('let se=$$a(',start);
    assert.ok(start>=0&&end>start);
    // Execute the shipped post-save normalization block, with the stock preset
    // supplied at its existing oQa dependency boundary.
    return new Function('V','ie','ae','oQa','F','re','r1a','n1a','PT',`let ${source.slice(start,end)};return oe;`);
  }
  const original=normalize(bundles[initial]),modified=normalize(patched[initial]);
  const stock=['low','medium','xhigh'].map(reasoningEffort=>({model:'gpt-6-astra',reasoningEffort}));
  function run(fn,effort,settings,home=true){
    return fn({model:'gpt-6-astra',reasoningEffort:effort},home,{data:{}},()=>stock,{models:[]},null,()=>false,e=>e.reasoningEffort,()=>settings);
  }
  const custom={slots:[{model:'gpt-6-astra',reasoningEffort:'high'},{model:'gpt-6-astra',reasoningEffort:'max'}]};
  for(const effort of ['high','max']){
    assert.equal(run(original,effort,custom),'xhigh','reproduces native snap-back after save');
    assert.equal(run(modified,effort,custom),effort,'custom spread preserves the exact saved effort');
    assert.equal(run(modified,effort,{slots:null}),'xhigh','restore defaults keeps stock behavior');
    assert.equal(run(modified,effort,null),'xhigh','unconfigured app keeps stock behavior');
    assert.equal(run(modified,effort,null,false),effort,'existing non-HOME behavior is unchanged');
  }
  assert.equal(run(modified,'medium',custom),'medium');
});
