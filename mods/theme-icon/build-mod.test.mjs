import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transform, replaceOnce } from './build-mod.mjs';

test('unknown or duplicated patch locations fail closed', () => {
  assert.throws(() => replaceOnce('none', 'needle', 'replacement'));
  assert.throws(() => replaceOnce('needle needle', 'needle', 'replacement'));
  assert.equal(replaceOnce('x needle y', 'needle', 'replacement'), 'x replacement y');
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
  },
);

test.skipIf(!process.env.THEME_ICON_BUNDLES)(
  'stock Dock row binds native controls and enables the existing icon preference',
  async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
    const original = Object.fromEntries(
      Object.keys(manifest.files).map((name) => [
        name,
        fs.readFileSync(path.join(process.env.THEME_ICON_BUNDLES, name), 'utf8'),
      ]),
    );
    const patched = await transform(original);
    const settings =
      patched[Object.keys(original).find((name) => name.includes('/general-settings-'))];
    const start = settings.indexOf('function Lo(){');
    const end = settings.indexOf('function Ro(e){', start);
    assert.ok(start >= 0 && end > start);
    const Row = () => {},
      Dropdown = () => {},
      DropdownButton = () => {},
      CheckIcon = () => {};
    const Menu = {},
      React = {},
      store = {},
      preference = { key: 'dock-icon-preference' };
    const previews = { appDefault: 'stock', codexDark: 'dark', codexLight: 'light' };
    const writes = [];
    const jsx = (type, props) => ({ type, props });
    const dependencies = {
      Q: { c: () => [] },
      c: () => store,
      G: {},
      V: () => ({ formatMessage: () => 'Dock icon' }),
      y: () => ({ platform: 'darwin' }),
      D: () => ({ data: { dockIconPreviews: previews } }),
      Fe: {},
      H: () => 'app-default',
      it: { dockIconPreference: preference },
      si: ({ dockIconPreviews }) => dockIconPreviews,
      $: { jsx, jsxs: jsx, Fragment: 'fragment' },
      x: () => {},
      In: { ChatGPT: 'chatgpt', Codex: 'codex' },
      Ro: () => {},
      K: Row,
      ThemeIconSettings: () => {},
      $o: React,
      he: Dropdown,
      Ue: DropdownButton,
      z: Menu,
      xn: CheckIcon,
      U: (...args) => writes.push(args),
    };
    const render = new Function(
      ...Object.keys(dependencies),
      `return (${settings.slice(start, end)});`,
    )(...Object.values(dependencies));
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
  },
);
