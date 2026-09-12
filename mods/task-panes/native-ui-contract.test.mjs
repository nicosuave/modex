import { expect, test } from 'bun:test';
import { parseModule } from '../../lib/source-contract.mjs';
import { renameBindings } from '../../lib/source-contract.test-support.mjs';
import { discoverNativeUi } from './native-ui-contract.mjs';

// A small compiler-shaped fixture keeps the public props, message IDs and
// initializer dependency behavior observable while allowing all locals to move.
const fixture = `
import {button as Button} from './button-123abc.js';
import {tooltip as Tooltip} from './tooltip-123abc.js';
import {maximize as Maximize, restore as Restore} from './icons-123abc.js';
let TabCache, ToggleCache, AppShell, jsx;
const tabInit = lazy(() => { TabCache = cache(); });
const toggleInit = lazy(() => { ToggleCache = cache(); jsx = nativeJsx; initializeNative(); });
const shellInit = lazy(() => {
  AppShell = {Root: root, MainContentLayout: layout,
    HeaderToolbar: Object.assign(toolbar, {Actions: actions}), RightPanel: right, BottomPanel: bottom};
});
function Tab(props) {
  TabCache.c(1);
  const {isActive, isClosable, onActivate, onClose, title, tabActivatorProps} = props;
  return jsx('div', {className: 'group/tab relative max-w-39', children: title});
}
function Toggle() {
  ToggleCache.c(4);
  const full = readState();
  const label = full
    ? intl.formatMessage({id: 'codex.rightPanel.restoreWidth'})
    : intl.formatMessage({id: 'codex.rightPanel.expandFullWidth'});
  const icon = full ? jsx.jsx(Restore, {}) : jsx.jsx(Maximize, {});
  const button = jsx.jsx(Button, {'data-app-shell-workspace-layout-toggle': 'right-panel', children: icon});
  return jsx.jsx(Tooltip, {tooltipContent: label, shortcut: 'key', delayOpen: true, children: button});
}
`;

test('native roles and lazy initializers survive complete lexical renaming', () => {
  const shadowed =
    fixture +
    `function unrelated(){let TabCache,ToggleCache,AppShell;
    TabCache=1;ToggleCache=2;AppShell=3;return AppShell;}`;
  for (const source of [fixture, shadowed, renameBindings(shadowed)]) {
    const module = parseModule(source);
    const roles = discoverNativeUi(module);
    expect(Object.keys(roles).sort()).toEqual([
      'AppShell',
      'Button',
      'MaximizeIcon',
      'RestoreIcon',
      'Tab',
      'Tooltip',
      'initialize',
    ]);
    expect(roles.initialize).toHaveLength(3);
    const body =
      source.replace(/^import .*;$/gm, '') +
      `
      ${roles.initialize.map((initialize) => `${initialize}();`).join('\n')}
      return {shell:${roles.AppShell}, tab:${roles.Tab}};
    `;
    const native = { initialized: 0 };
    const value = new Function(
      'lazy',
      'cache',
      'nativeJsx',
      'initializeNative',
      'root',
      'layout',
      'toolbar',
      'actions',
      'right',
      'bottom',
      body,
    )(
      (initialize) => initialize,
      () => ({ c: () => [] }),
      (type, props) => ({ type, props }),
      () => native.initialized++,
      'root',
      'layout',
      () => {},
      'actions',
      'right',
      'bottom',
    );
    expect(native.initialized).toBe(1);
    expect(value.shell.MainContentLayout).toBe('layout');
    expect(value.shell.HeaderToolbar.Actions).toBe('actions');
    expect(value.tab({ title: 'Task' }).props.children).toBe('Task');
  }
});

test('native discovery rejects missing and ambiguous contracts', () => {
  expect(() =>
    discoverNativeUi(parseModule(fixture.replace('tabActivatorProps', 'unknownProp'))),
  ).toThrow('compact native tab props');
  expect(() =>
    discoverNativeUi(parseModule(fixture.replace('Actions: actions', 'Unknown: actions'))),
  ).toThrow('Actions component');
  expect(() =>
    discoverNativeUi(parseModule(fixture + `const duplicate = 'codex.rightPanel.restoreWidth';`)),
  ).toThrow('native restore-width message');
  expect(() =>
    discoverNativeUi(parseModule(fixture.replace("'./button-123abc.js'", "'./other-123abc.js'"))),
  ).toThrow('Button has an unexpected native module');
});
