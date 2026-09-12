import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildDevelopment } from './build.mjs';
import {
  rendererShim,
  applyDevelopment,
  readDevelopmentProtocol,
  protocolPath,
  transformProtocol,
} from './patch.mjs';
import { mainPath } from '../app-tools-auth/patch.mjs';
import { renameBindings } from '../../lib/source-contract.test-support.mjs';

// Real ES modules exercise the same import path used under stock CSP, with no eval.
test('renderer shim imports external modules and falls back on missing or incompatible exports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-shim-'));
  const priorError = console.error,
    errors = [];
  try {
    console.error = (...args) => errors.push(args);
    for (const [name, source, expected] of [
      ['valid', 'export const value=()=>"external";', 'external'],
      ['invalid', 'export const value=42;', 'bundled'],
      ['missing', null, 'bundled'],
    ]) {
      const directory = path.join(root, name);
      fs.mkdirSync(directory);
      fs.writeFileSync(
        path.join(directory, 'example-bundled.mjs'),
        'export function value(){return "bundled";}',
      );
      fs.writeFileSync(
        path.join(directory, 'example.mjs'),
        rendererShim('example', { file: 'example.mjs', exports: ['value'] }),
      );
      if (source) fs.writeFileSync(path.join(directory, 'modex-development-example.mjs'), source);
      assert.equal((await import(path.join(directory, 'example.mjs'))).value(), expected);
    }
    assert.equal(errors.length, 2);
    assert.match(String(errors[0][0]), /using packaged module/);
  } finally {
    console.error = priorError;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const stock = process.env.APP_TOOLS_AUTH_SOURCE ?? '/Applications/ChatGPT.app';
test.skipIf(!fs.existsSync(stock))(
  'development packaging binds verified app protocol and preserves fallbacks',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-dev-patch-'));
    try {
      await buildDevelopment(root, ['theme-icon']);
      const original = Buffer.from(
        'export const useTheme=()=>{};export const previewIcon=()=>{};export const Settings=()=>{};',
      );
      const replacements = new Map([
        [mainPath, Buffer.from('const originalMain=true;')],
        ['webview/assets/theme-icon-runtime.mjs', original],
      ]);
      const currentSource = process.env.APP_TOOLS_AUTH_CURRENT_SOURCE === '1';
      const protocol = readDevelopmentProtocol(stock, { currentSource });
      await applyDevelopment(replacements, root, ['theme-icon'], protocol, { currentSource });
      assert.deepEqual(replacements.get('webview/assets/theme-icon-runtime-bundled.mjs'), original);
      assert.match(replacements.get(mainPath).toString(), /onIconRenderer/);
      assert.ok(replacements.get(mainPath).toString().includes(JSON.stringify(root)));
      assert.ok(replacements.has(protocolPath));
      assert.ok(!replacements.has('webview/assets/model-spread.mjs'));
      await assert.rejects(
        () => applyDevelopment(new Map(), root, ['theme-icon'], Buffer.from('unknown')),
        /source hash/,
      );
      await assert.rejects(
        () => applyDevelopment(new Map(), root, ['model-spread'], protocol),
        /mods or source|hooks changed/,
      );
      assert.equal(transformProtocol(protocol.toString()), transformProtocol(protocol.toString()));
      assert.throws(
        () => transformProtocol(replacements.get(protocolPath).toString()),
        /Unsupported/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
for (const setup of ['initialize()', 'initialize(restrictions)'])
  test('protocol hook preserves routing and initialization: ' + setup, async () => {
    const source =
      'function install(root,restrictions){' +
      setup +
      ',electron.protocol.handle(`app`,async request=>{return route(request.url,root)})};install("root",restrictions);';
    for (const stock of [source, renameBindings(source)]) {
      let handler,
        ordinary = 0,
        initialized = false;
      const restrictions = {};
      const marked = new Response('module');
      new Function(
        'require',
        'initialize',
        'electron',
        'route',
        'restrictions',
        transformProtocol(stock),
      )(
        () => ({
          responseFor: (request) => (request.url.includes('modex-development-') ? marked : null),
        }),
        (value) => {
          assert.equal(value, setup.includes('restrictions') ? restrictions : undefined);
          initialized = true;
        },
        {
          protocol: {
            handle: (name, callback) => {
              assert.equal(name, 'app');
              handler = callback;
            },
          },
        },
        (url, root) => {
          assert.equal(root, 'root');
          ordinary++;
          return 'stock';
        },
        restrictions,
      );
      assert.equal(initialized, true);
      assert.equal(
        await handler({ url: 'app://-/assets/modex-development-theme-icon-runtime.mjs' }),
        marked,
      );
      assert.equal(ordinary, 0);
      assert.equal(await handler({ url: 'app://-/index.html' }), 'stock');
      assert.equal(ordinary, 1);
      assert.throws(() => transformProtocol(`{${stock}}{${stock}}`), /Unsupported/);
      assert.throws(
        () => transformProtocol(stock.replace('protocol.handle', 'protocol.other')),
        /Unsupported/,
      );
    }
  });
test('external editor and slot logic share the configured native store after a window reload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-dev-singleton-'));
  try {
    const { rendererSource } = await import('./main.mjs');
    const output = path.join(root, 'modules'),
      manifest = await buildDevelopment(output, ['model-spread']);
    const source = fs.readFileSync(
      new URL('../model-spread/model-spread.mjs', import.meta.url),
      'utf8',
    );
    const exportsList = new Bun.Transpiler({ loader: 'js' }).scan(source).exports;
    fs.writeFileSync(path.join(root, 'model-spread-bundled.mjs'), source);
    fs.writeFileSync(
      path.join(root, 'model-spread-storage.mjs'),
      'const data=new Map();export const storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};export const target={addEventListener(){}};',
    );
    fs.writeFileSync(
      path.join(root, 'model-spread.mjs'),
      rendererShim('model-spread', { file: 'model-spread.mjs', exports: exportsList }),
    );
    fs.writeFileSync(
      path.join(root, 'model-spread-editor-bundled.mjs'),
      'export const Editor=()=>null;',
    );
    fs.writeFileSync(
      path.join(root, 'model-spread-editor.mjs'),
      rendererShim('model-spread-editor', { file: 'model-spread-editor.mjs', exports: ['Editor'] }),
    );
    fs.writeFileSync(
      path.join(root, 'modex-development-model-spread.mjs'),
      rendererSource(
        'model-spread',
        fs.readFileSync(path.join(output, manifest.modules['model-spread'].file), 'utf8'),
      ),
    );
    fs.writeFileSync(
      path.join(root, 'modex-development-model-spread-editor.mjs'),
      rendererSource(
        'model-spread-editor',
        'exports.Editor=()=>require("./model-spread.mjs").store();',
      ),
    );
    const slots = await import(path.join(root, 'model-spread.mjs'));
    const { Editor } = await import(path.join(root, 'model-spread-editor.mjs'));
    slots
      .store()
      .save({ version: 1, slots: [{ model: 'test', reasoningEffort: 'high' }], micro: true });
    assert.equal(Editor(), slots.store());
    assert.deepEqual(Editor().get().slots, [{ model: 'test', reasoningEffort: 'high' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
