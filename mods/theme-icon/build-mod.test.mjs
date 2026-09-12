import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transform } from './build-mod.mjs';
import {
  settingsBindings,
  mainBindings,
  patchThemeSettings,
  patchThemeMain,
  patchThemeProvider,
} from './source-hooks.mjs';
import { parseModule, literalValue } from '../../lib/source-contract.mjs';
import { renameBindings } from '../../lib/source-contract.test-support.mjs';

test('unknown source structures fail closed', () => {
  for (const patch of [patchThemeProvider, patchThemeSettings, patchThemeMain])
    assert.throws(() => patch('export const unknown = true;'));
});
test.skipIf(!process.env.THEME_ICON_BUNDLES)(
  'stock bundles transform deterministically and reject replay',
  async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
    const original = Object.fromEntries(
      Object.keys(manifest.files).map((name) => [
        name,
        fs.readFileSync(path.join(process.env.THEME_ICON_BUNDLES, name), 'utf8'),
      ]),
    );
    const patched = await transform(original);
    assert.deepEqual(patched, await transform(original));
    await assert.rejects(() =>
      transform(Object.fromEntries(Object.keys(original).map((name) => [name, patched[name]]))),
    );
    const main = patched['.vite/build/theme-icon-main.cjs'];
    assert.ok(main.length > 1000);
    // CJS must actually load without renderer globals or native Electron imports.
    const module = { exports: {} };
    new Function('module', 'exports', 'require', main)(module, module.exports, require);
    assert.equal(typeof module.exports.configure, 'function');
    assert.equal(typeof module.exports.apply, 'function');
    assert.equal(module.exports.update({ appearance: 'invalid' }), false);
    verifyMain(
      original[Object.keys(original).find((name) => name.startsWith('.vite/build/main-'))],
    );
  },
  120000,
);

function verifyMain(original) {
  const bindings = mainBindings(original);
  const patched = patchThemeMain(original);
  const start = patched.indexOf('case`modex-theme-icon`:');
  const end = patched.indexOf('case`persisted-atom-sync-request`:', start);
  const receive = new Function(
    bindings.origin,
    bindings.message,
    bindings.electron,
    'ThemeIconMain',
    'switch(' + bindings.message + '.type){' + patched.slice(start, end) + '}',
  );
  const primary = {},
    browser = {},
    other = {},
    accepted = [];
  const message = { type: 'modex-theme-icon', appearance: 'dark' };
  const handler = { getBrowserOwnerWebContentsForOrigin: () => primary };
  for (const [origin, focused, expected] of [
    [primary, primary, true],
    [primary, null, true],
    [browser, primary, false],
    [primary, other, false],
  ]) {
    accepted.length = 0;
    receive.call(
      handler,
      origin,
      message,
      {
        BrowserWindow: {
          getFocusedWindow: () => (focused == null ? null : { webContents: focused }),
        },
      },
      { update: (value) => accepted.push(value) },
    );
    assert.deepEqual(accepted, expected ? [message] : []);
  }
}

function verifyDock(original) {
  const b = settingsBindings(original);
  const patched = patchThemeSettings(original);
  const stock = parseModule(patched);
  const description = stock.one(
    (node) => literalValue(node) === 'settings.general.appearance.dockIcon.row.description',
    'Dock description',
  );
  const row = stock.ancestor(description);
  const Row = () => {},
    Dropdown = () => {},
    DropdownButton = () => {},
    CheckIcon = () => {},
    Menu = {},
    React = {},
    store = {};
  const preference = { key: 'dock-icon-preference' };
  const previews = { appDefault: 'stock', codexDark: 'dark', codexLight: 'light' };
  const writes = [],
    jsx = (type, props) => ({ type, props });
  const values = { Symbol, ThemeIconSettings: () => {} };
  values[b.jsx] = { jsx, jsxs: jsx, Fragment: 'fragment' };
  for (const [name, value] of [
    [b.Row, Row],
    [b.Dropdown, Dropdown],
    [b.DropdownButton, DropdownButton],
    [b.CheckIcon, CheckIcon],
    [b.Menu, Menu],
  ])
    values[name] = value;
  values.ThemeIconReact = () => React;
  values[b.preferenceRead.arguments[0].object.name] = { dockIconPreference: preference };
  values[b.preferenceRead.callee.name] = () => 'app-default';
  values[b.preferenceWrite.callee.name] = (...args) => writes.push(args);
  const storeLocal = b.preferenceWrite.arguments[0].name;
  for (const node of b.rowNodes) {
    if (node.type === 'VariableDeclarator' && node.id.name === storeLocal)
      values[node.init.callee.name] = () => store;
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern') {
      const key = node.id.properties[0].key.name;
      if (key === 'platform') values[node.init.callee.name] = () => ({ platform: 'darwin' });
      if (key === 'data')
        values[node.init.callee.name] = () => ({ data: { dockIconPreviews: previews } });
    }
    if (node.type === 'MemberExpression' && node.property.name === 'formatMessage') {
      const local = b.rowNodes.find(
        (n) => n.type === 'VariableDeclarator' && n.id.name === node.object.name,
      );
      values[local.init.callee.name] = () => ({ formatMessage: () => 'Dock icon' });
    }
    if (node.type === 'MemberExpression' && node.property.name === 'ChatGPT')
      values[node.object.name] = { ChatGPT: 'chatgpt', Codex: 'codex' };
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'SequenceExpression' &&
      node.callee.expressions.at(-1).property?.name === 'c'
    )
      values[node.callee.expressions.at(-1).object.name] = { c: () => [] };
    if (
      node.type === 'CallExpression' &&
      node.arguments[0]?.type === 'ObjectExpression' &&
      node.arguments[0].properties.some((p) => p.key.name === 'dockIconPreviews')
    )
      values[node.callee.name] = ({ dockIconPreviews }) => dockIconPreviews;
  }
  const environment = new Proxy(values, {
    has: () => true,
    get: (target, key) => (key === Symbol.unscopables ? undefined : (target[key] ?? (() => {}))),
  });
  const render = new Function('environment', 'with(environment){return (' + stock.text(row) + ')}')(
    environment,
  );
  const result = render();
  assert.equal(result.props.children[0].type, Row);
  const options = result.props.children[1].props;
  assert.deepEqual(
    [
      options.React,
      options.Row,
      options.Dropdown,
      options.DropdownButton,
      options.Menu,
      options.CheckIcon,
    ],
    [React, Row, Dropdown, DropdownButton, Menu, CheckIcon],
  );
  assert.equal(options.previews, previews);
  assert.equal(options.enabled, false);
  options.onEnable();
  assert.deepEqual(writes, [[store, preference, 'codex-system']]);
}

test.skipIf(!process.env.THEME_ICON_BUNDLES)(
  'stock Dock row uses source-derived native bindings',
  () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
    const name = Object.keys(manifest.files).find((name) => name.includes('/general-settings-'));
    verifyDock(fs.readFileSync(path.join(process.env.THEME_ICON_BUNDLES, name), 'utf8'));
  },
  120000,
);

test.skipIf(!process.env.THEME_ICON_BUNDLES)(
  'lexical renaming preserves native Dock controls and IPC authorization',
  () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
    const settingsName = Object.keys(manifest.files).find((name) =>
      name.includes('/general-settings-'),
    );
    const settings = fs.readFileSync(
      path.join(process.env.THEME_ICON_BUNDLES, settingsName),
      'utf8',
    );
    const renamedSettings = renameBindings(settings);
    verifyDock(renamedSettings);
    verifyDock(renamedSettings.replaceAll('modexRenamed_', '$theme_'));
    assert.throws(() =>
      patchThemeSettings(settings.replaceAll('dockIconPreference', 'removedDockPreference')),
    );
    assert.throws(() =>
      patchThemeSettings(
        settings +
          '\n;const duplicateDockDescription=`settings.general.appearance.dockIcon.row.description`;',
      ),
    );
    const mainName = Object.keys(manifest.files).find((name) =>
      name.startsWith('.vite/build/main-'),
    );
    const main = fs.readFileSync(path.join(process.env.THEME_ICON_BUNDLES, mainName), 'utf8');
    const b = mainBindings(main);
    // Retain the actual lifecycle and message-handler bodies, with a declaration
    // for their shared native import, so the rename covers both local and module bindings.
    const lifecycle = b.ast.text(b.ast.owner(b.dock.start - 1));
    const handler = b.ast.owner(b.sync.start);
    const fixture = `let ${b.electron};${lifecycle};async function receive${b.ast.text(handler)}`;
    const renamedMain = renameBindings(fixture);
    verifyMain(renamedMain);
    verifyMain(renamedMain.replaceAll('modexRenamed_', '$theme_'));
  },
  120000,
);
