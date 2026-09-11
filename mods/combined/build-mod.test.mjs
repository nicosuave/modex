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
    const result = await transform(original);
    expect(await transform(original)).toEqual(result);
    const initial =
      result[Object.keys(result).find((name) => name.startsWith('webview/assets/app-initial-'))];
    const start = initial.indexOf('oe=te.reasoningEffort;if(ie'),
      end = initial.indexOf('let se=B8a(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const normalize = new Function(
      'te',
      'ie',
      'ae',
      'q3a',
      'F',
      're',
      'W8a',
      'U8a',
      'Jx',
      `let ${initial.slice(start, end)};return oe;`,
    );
    const stock = ['low', 'medium', 'xhigh'].map((reasoningEffort) => ({
      model: 'gpt-6-astra',
      reasoningEffort,
    }));
    for (const reasoningEffort of ['high', 'max'])
      for (const custom of [true, false]) {
        const value = normalize(
          { model: 'gpt-6-astra', reasoningEffort },
          true,
          { data: {} },
          () => stock,
          { models: [] },
          null,
          () => false,
          (e) => e.reasoningEffort,
          () => ({ slots: custom ? [{ model: 'gpt-6-astra', reasoningEffort }] : null }),
        );
        expect(value).toBe(custom ? reasoningEffort : 'xhigh');
      }
    const hook = initial.match(/ThemeIconRuntime\.useTheme\(u6,\{[^;]+\}\);/)?.[0];
    expect(hook).toBeDefined();
    const light = { fonts: { codeFace: 'light' } },
      dark = { fonts: { codeFace: 'dark' } };
    for (const appearance of ['light', 'dark']) {
      let observed;
      new Function('ThemeIconRuntime', 'u6', 'b', 's', 'aO', 'xv', 'Jx', 'Yx', 'W1t', 'H', hook)(
        { useTheme: (react, options) => (observed = options) },
        {},
        appearance === 'light' ? light : dark,
        appearance,
        (id) => id,
        { lightCodeThemeId: 'light-id', darkCodeThemeId: 'dark-id' },
        () => {},
        () => {},
        () => {},
        {},
      );
      expect(observed.appearance).toBe(appearance);
      expect(observed.theme).toBe(appearance === 'light' ? light : dark);
      expect(observed.id).toBe(`${appearance}-id`);
    }
    expect(result['webview/assets/model-spread.mjs']).toBeDefined();
    expect(result['.vite/build/theme-icon-main.cjs']).toBeDefined();
    await expect(transform(result)).rejects.toThrow();
  },
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
    const spread = await transform(spreadInputs, ['model-spread']);
    expect(spread).toEqual(
      Object.fromEntries(
        Object.entries(spreadTransform(legacyInputs)).map(([name, source]) => [
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
    expect(await transform(both, ['theme-icon', 'model-spread'])).toEqual(await transform(both));
  },
);
