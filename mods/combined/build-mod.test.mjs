import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  combineCompatibility,
  compatibility,
  compatibilityFor,
  componentManifests,
} from './compatibility.mjs';
import { transform, validateInputs } from './build-mod.mjs';
import { transform as spreadTransform } from '../model-spread/build-mod.mjs';
import { transform as iconTransform } from '../theme-icon/build-mod.mjs';
import { parseArgs, validateIdentityContinuity } from '../../lib/prepare-mod.mjs';
import { discoverHomeNormalization } from '../model-spread/source-contracts.mjs';
import { patchThemeProvider } from '../theme-icon/source-hooks.mjs';
import { parseModule, propertyName, unique } from '../../lib/source-contract.mjs';
import { fixtureSourceModules, renameBindings } from '../../lib/source-contract.test-support.mjs';
const fixtureContext = () => ({
  sourceModules: fixtureSourceModules(process.env.COMBINED_BUNDLES),
});
function assertThemeHook(source) {
  const hook = unique(
    [...source.matchAll(/ThemeIconRuntime\.useTheme\([^;]+\);/g)],
    'injected theme hook',
  )[0];
  const module = parseModule(hook);
  const call = module.one(
    (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      propertyName(node.callee.property) === 'useTheme',
    'theme hook call',
  );
  const fields = Object.fromEntries(
    call.arguments[1].properties.map((property) => [propertyName(property.key), property.value]),
  );
  const id = fields.id,
    themeKeys = id.arguments[0];
  expect(themeKeys.type).toBe('ConditionalExpression');
  for (const appearance of ['light', 'dark']) {
    const theme = { fonts: { codeFace: appearance } };
    let observed;
    const bindings = {
      ThemeIconRuntime: {
        useTheme: (_react, options) => {
          observed = options;
        },
      },
      [call.arguments[0].name]: {},
      [fields.theme.name]: theme,
      [fields.appearance.name]: appearance,
      [id.callee.name]: (key) => key,
      [themeKeys.consequent.object.name]: {
        lightCodeThemeId: 'light-id',
        darkCodeThemeId: 'dark-id',
      },
      [fields.read.name]: () => {},
      [fields.write.name]: () => {},
      [fields.listen.name]: () => {},
      [fields.bridge.name]: {},
    };
    new Function(...Object.keys(bindings), hook)(...Object.values(bindings));
    expect(observed.appearance).toBe(appearance);
    expect(observed.theme).toBe(theme);
    expect(observed.id).toBe(appearance + '-id');
  }
}

test('combination normalizes shared paths and rejects incompatible versions or hashes', () => {
  const a = { version: '1', build: '2', files: { 'app-initial-x.js': 'a' } };
  expect(
    combineCompatibility([a, { ...a, files: { 'webview/assets/app-initial-x.js': 'a' } }]).files,
  ).toEqual({ 'webview/assets/app-initial-x.js': 'a' });
  expect(() => combineCompatibility([a, { ...a, build: '3' }])).toThrow('same stock');
  expect(() =>
    combineCompatibility([a, { ...a, files: { 'webview/assets/app-initial-x.js': 'b' } }]),
  ).toThrow('Conflicting');
  expect(() => validateInputs({})).toThrow('Unsupported bundle');
});
test('installed identity requires matching mod identifier and signer team', () => {
  const requirement =
    'identifier "local.codex.theme-icon" and anchor apple generic and certificate leaf[subject.OU] = ABC123';
  expect(parseArgs(['--identity-from', '/Applications/Modex.app'])['identity-from']).toBe(
    '/Applications/Modex.app',
  );
  expect(() =>
    validateIdentityContinuity(
      'local.codex.theme-icon',
      requirement,
      'Developer ID Application: Person (ABC123)',
    ),
  ).not.toThrow();
  expect(() =>
    validateIdentityContinuity(
      'local.codex.theme-icon',
      requirement,
      'Developer ID Application: Person (OTHER)',
    ),
  ).toThrow('preserve');
  expect(() =>
    validateIdentityContinuity(
      'local.codex.theme-icon',
      requirement,
      'Developer ID Application: Person (ABC12)',
    ),
  ).toThrow('preserve');
  expect(() =>
    validateIdentityContinuity(
      'local.codex.model-spread',
      requirement,
      'Developer ID Application: Person (ABC123)',
    ),
  ).toThrow('preserve');
});
test.skipIf(!process.env.COMBINED_BUNDLES)(
  'final combined initial bundle executes HOME preservation and theme hook together',
  async () => {
    const original = Object.fromEntries(
      Object.keys(compatibility.files).map((name) => [
        name,
        fs.readFileSync(path.join(process.env.COMBINED_BUNDLES, name), 'utf8'),
      ]),
    );
    validateInputs(original, undefined, {
      currentSource: process.env.APP_TOOLS_AUTH_CURRENT_SOURCE === '1',
    });
    const context = fixtureContext();
    const result = await transform(original, undefined, context);
    expect(await transform(original, undefined, context)).toEqual(result);
    const initial =
      result[Object.keys(result).find((name) => name.startsWith('webview/assets/app-initial-'))];
    const home = discoverHomeNormalization(initial);
    const stock = ['low', 'medium', 'xhigh'].map((reasoningEffort) => ({
      model: 'gpt-6-astra',
      reasoningEffort,
    }));
    for (const reasoningEffort of ['high', 'max'])
      for (const custom of [true, false]) {
        const values = {
          selection: { model: 'gpt-6-astra', reasoningEffort },
          enabled: true,
          response: { data: {} },
          presetChoices: () => stock,
          models: { models: [] },
          sliderConfig: null,
          skipPresetCoercion: () => false,
          effortValue: (entry) => entry.reasoningEffort,
          readSettings: () => ({
            slots: custom ? [{ model: 'gpt-6-astra', reasoningEffort }] : null,
          }),
        };
        const bindings = Object.fromEntries(
          Object.entries(home.parameters).map(([role, name]) => [name, values[role]]),
        );
        const value = new Function(...Object.keys(bindings), home.code + ';return ' + home.result)(
          ...Object.values(bindings),
        );
        expect(value).toBe(custom ? reasoningEffort : 'xhigh');
      }
    assertThemeHook(initial);
    const initialName = Object.keys(original).find((name) =>
      name.startsWith('webview/assets/app-initial-'),
    );
    assertThemeHook(patchThemeProvider(renameBindings(original[initialName])));
    expect(result['webview/assets/model-spread.mjs']).toBeDefined();
    expect(result['.vite/build/theme-icon-main.cjs']).toBeDefined();
    await expect(transform(result, undefined, context)).rejects.toThrow();
  },
  240000,
);

test.skipIf(!process.env.COMBINED_BUNDLES)(
  'explicit singleton builds equal the standalone transforms and exclude the other mod',
  async () => {
    const inputsFor = (mods) =>
      Object.fromEntries(
        Object.keys(compatibilityFor(mods).files).map((name) => [
          name,
          fs.readFileSync(path.join(process.env.COMBINED_BUNDLES, name), 'utf8'),
        ]),
      );
    const spreadInputs = inputsFor(['model-spread']);
    const legacyInputs = Object.fromEntries(
      Object.keys(componentManifests['model-spread'].files).map((name) => [
        name,
        spreadInputs[`webview/assets/${name}`],
      ]),
    );
    const context = fixtureContext();
    const spread = await transform(spreadInputs, ['model-spread'], context);
    expect(spread).toEqual(
      Object.fromEntries(
        Object.entries(spreadTransform(legacyInputs, context)).map(([name, source]) => [
          `webview/assets/${name}`,
          source,
        ]),
      ),
    );
    expect(spread['webview/assets/theme-icon-runtime.mjs']).toBeUndefined();
    const iconInputs = inputsFor(['theme-icon']),
      icon = await transform(iconInputs, ['theme-icon']);
    expect(icon).toEqual(await iconTransform(iconInputs));
    expect(icon['webview/assets/model-spread.mjs']).toBeUndefined();
    const both = inputsFor(['model-spread', 'theme-icon']);
    expect(await transform(both, ['theme-icon', 'model-spread'], context)).toEqual(
      await transform(both, undefined, context),
    );
  },
  240000,
);
