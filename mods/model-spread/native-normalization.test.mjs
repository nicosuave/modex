import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverHomeNormalization } from './source-contracts.mjs';
import { bundle, evaluate, nativeFixtures } from './native-test-helpers.mjs';

const fixtures = nativeFixtures();

for (const fixture of fixtures) {
  test(
    `${fixture.name}: actual HOME normalization retains custom High/Max after optimistic selection clears`,
    { timeout: 120000 },
    () => {
      const original = discoverHomeNormalization(bundle(fixture, 'app-initial-', false));
      const modified = discoverHomeNormalization(bundle(fixture, 'app-initial-'));
      const stock = ['low', 'medium', 'xhigh'].map((reasoningEffort) => ({
        model: 'gpt-6-astra',
        reasoningEffort,
      }));
      function run(contract, effort, settings, home = true) {
        // Execute the shipped post-save normalization statements. The native preset
        // provider and persisted-setting reader remain their existing boundaries.
        const values = {
          selection: { model: 'gpt-6-astra', reasoningEffort: effort },
          enabled: home,
          response: { data: {} },
          presetChoices: () => stock,
          models: { models: [] },
          sliderConfig: null,
          skipPresetCoercion: () => false,
          effortValue: (choice) => choice.reasoningEffort,
          readSettings: (key, fallback) => {
            assert.equal(key, 'nico.codex.model-spread.v1');
            assert.equal(fallback, null);
            return settings;
          },
        };
        const bindings = Object.fromEntries(
          Object.entries(contract.parameters).map(([role, name]) => {
            assert.ok(Object.hasOwn(values, role), `known HOME dependency role: ${role}`);
            return [name, values[role]];
          }),
        );
        return evaluate(`${contract.code};return ${contract.result};`, bindings);
      }
      const custom = {
        slots: [
          { model: 'gpt-6-astra', reasoningEffort: 'high' },
          { model: 'gpt-6-astra', reasoningEffort: 'max' },
        ],
      };
      for (const effort of ['high', 'max']) {
        assert.equal(
          run(original, effort, custom),
          'xhigh',
          'reproduces native snap-back after save',
        );
        assert.equal(
          run(modified, effort, custom),
          effort,
          'custom spread preserves the exact saved effort',
        );
        assert.equal(
          run(modified, effort, { slots: null }),
          'xhigh',
          'restore defaults keeps stock behavior',
        );
        assert.equal(run(modified, effort, null), 'xhigh', 'unconfigured app keeps stock behavior');
        assert.equal(
          run(modified, effort, null, false),
          effort,
          'existing non-HOME behavior is unchanged',
        );
      }
      assert.equal(run(modified, 'medium', custom), 'medium');
    },
  );
}

if (!fixtures.length) test('native HOME fixtures unavailable', { skip: true }, () => {});
