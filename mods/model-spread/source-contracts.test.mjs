import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverHomeNormalization } from './source-contracts.mjs';
import { editSource } from '../../lib/source-contract.mjs';
import { renameBindings } from '../../lib/source-contract.test-support.mjs';

// This small owner retains the native preset coercion contract. Full archived
// owners, composer access, and the Micro layout callback run in native tests.
const normalization = `function home(saved,enabled,response,models,config){
let effort=saved.reasoningEffort;
if(enabled&&response?.data!=null){
let choices=presets(models?.models,{sliderModelsConfig:config,includeUltraInSlider:response.data.ultraEffortEnabled===true});
if(!choices.some(exempt)){let efforts=choices.filter(choice=>choice.model===saved.model).map(effortValue);efforts.some(value=>value===effort)||(effort=efforts.at(-1)??effort);}
}
return effort;
}`;

for (const rename of [false, true]) {
  test(`HOME extraction executes saved and default behavior after renamed=${rename}`, () => {
    const source = rename ? renameBindings(normalization) : normalization;
    const before = discoverHomeNormalization(source);
    const patched = editSource(source, [
      {
        start: before.testEnd,
        end: before.testEnd,
        text: '&&readSettings(`nico.codex.model-spread.v1`,null)?.slots==null',
      },
    ]);
    const after = discoverHomeNormalization(patched);
    const run = (contract, settings, enabled = true) => {
      const dependencies = {
        selection: { model: 'astra', reasoningEffort: 'max' },
        enabled,
        response: { data: {} },
        models: { models: [] },
        sliderConfig: null,
        presetChoices: () => [{ model: 'astra', reasoningEffort: 'xhigh' }],
        skipPresetCoercion: () => false,
        effortValue: (choice) => choice.reasoningEffort,
        readSettings: () => settings,
      };
      return new Function(
        ...Object.values(contract.parameters),
        `${contract.code};return ${contract.result};`,
      )(...Object.keys(contract.parameters).map((role) => dependencies[role]));
    };
    assert.equal(run(before, { slots: [] }), 'xhigh');
    assert.equal(run(after, { slots: [] }), 'max');
    assert.equal(run(after, { slots: null }), 'xhigh');
    assert.equal(run(after, null), 'xhigh');
    assert.equal(run(after, null, false), 'max');
  });
}

test('HOME discovery rejects ambiguous owners and changed fallback contracts', () => {
  for (const source of [
    normalization + '\n' + normalization.replace('function home', 'function duplicate'),
    normalization.replace('efforts.at(-1)??effort', 'efforts.at(0)??effort'),
    normalization.replace('efforts.at(-1)??effort', 'efforts.at(-1)??saved'),
    normalization.replace('models?.models', 'models?.items'),
    normalization.replace('response?.data!=null', 'response?.data==null'),
  ])
    assert.throws(() => discoverHomeNormalization(source), /Compatibility check failed/);
});
