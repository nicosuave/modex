import { expect, test } from 'bun:test';
import { parseModule } from '../../lib/source-contract.mjs';
import { renameBindings } from '../../lib/source-contract.test-support.mjs';
import {
  discoverPersistence,
  discoverRewind,
  findInitializer,
  renderNativeAdapters,
} from './native-contract.mjs';

const persistence = `
import {bus} from './bus.js';
let cache, publisher, initialize = once(() => { cache = new Map; publisher = null; });
function guard() { if (publisher) return publisher; throw Error('Persisted atom store accessed before initialization'); }
function read(key, fallback) { return typeof window === 'undefined' ? fallback : (guard(), cache.has(key) ? cache.get(key) : fallback); }
function publish(key, value, send) { let dispatch = guard(); value === undefined ? cache.delete(key) : cache.set(key,value); if (send) dispatch(key,value); }
function write(key, value) { guard(), cancel(key), publish(key,value,!0); }
function request() { bus.dispatchMessage('persisted-atom-sync-request', {}); }
export { read, write, initialize, bus };
`;

test('persistence roles follow cache ownership and publish semantics after lexical renaming', () => {
  for (const source of [persistence, renameBindings(persistence)]) {
    const module = parseModule(source),
      roles = discoverPersistence(module);
    const exported = new Map(
      module.ast.body
        .filter((n) => n.type === 'ExportNamedDeclaration')
        .flatMap((n) => n.specifiers.map((s) => [s.local.name, s.exported.name])),
    );
    for (const role of ['read', 'write', 'initialize'])
      expect(exported.get(roles[role])).toBe(role);
    expect(exported.get(roles.bridge)).toBe('bus');
  }
});

test('persistence discovery rejects changed publication and ambiguous readers', () => {
  expect(() =>
    discoverPersistence(parseModule(persistence.replace('value,!0', 'value,!1'))),
  ).toThrow('writer');
  expect(() =>
    discoverPersistence(
      parseModule(
        persistence +
          '\nfunction another(key,fallback){return typeof window === "undefined" ? fallback : (guard(),cache.has(key)?cache.get(key):fallback);}',
      ),
    ),
  ).toThrow('reader');
});

test('component initializer follows the assigned compiler runtime into its lazy owner', () => {
  const source = `let compiler, setup=once(()=>{compiler=runtime();}); function Row(props){const memo=compiler.c(2);return props.title;} export{setup,Row};`;
  const shadowed =
    source + `function unrelated(){let compiler=1; return compiler;} {let compiler;compiler=2;}`;
  for (const candidate of [source, shadowed, renameBindings(shadowed)]) {
    const module = parseModule(candidate);
    const exports = module.ast.body.find((n) => n.type === 'ExportNamedDeclaration').specifiers;
    const row = exports.find((n) => n.exported.name === 'Row').local.name;
    expect(findInitializer(module, row)).toBe(
      exports.find((n) => n.exported.name === 'setup').local.name,
    );
  }
});

test('rewind resolves the factory and its initializer without a generated filename or export alias', () => {
  const source = `import{once}from'./runtime.js';import{init,icon}from'./icons.js';let rewind,setup=once(()=>{init();rewind=icon('Rewind',[['polygon',{points:'0 1 2'}]]);});export{rewind as graphic,setup as prepare};`;
  for (const candidate of [source, renameBindings(source)]) {
    const roles = discoverRewind({ names: ['rewind-changed.js'], read: () => candidate });
    expect(roles).toEqual({
      icon: { file: './rewind-changed.js', name: 'graphic' },
      initialize: { file: './rewind-changed.js', name: 'prepare' },
    });
  }
  expect(() =>
    discoverRewind({ names: ['rewind-a.js', 'rewind-b.js'], read: () => source }),
  ).toThrow('found 2');
  expect(() =>
    discoverRewind({ names: ['rewind-a.js'], read: () => source.replace("'Rewind'", "'Changed'") }),
  ).toThrow('found 0');
});

const ui = `
let compiler, items, titleName, descriptionName, rawTitle, rawDescription, titleAlias, descriptionAlias;
let setup=once(()=>{compiler=runtime();items={Trigger:trigger};titleName='DialogTitle';descriptionName='DialogDescription';rawTitle=forwardRef(()=>{});rawDescription=forwardRef(()=>{});rawTitle.displayName=titleName;rawDescription.displayName=descriptionName;titleAlias=rawTitle;descriptionAlias=rawDescription;});
function dialog({triggerContent,triggerAsChild,dialogCloseLabel,contentProps}){compiler.c(1);}
function body(props){compiler.c(1);return runtime.jsx('div',{name:'DialogBody'});}
function section(props){compiler.c(1);return runtime.jsx('div',{name:'DialogSection'});}
function heading(props){compiler.c(1);return runtime.jsx('div',{name:'DialogHeader'});}
function footer(props){compiler.c(1);return runtime.jsx('div',{name:'DialogFooter'});}
function title(props){compiler.c(1);return runtime.jsx(titleAlias,{...props});}
function description(props){compiler.c(1);return runtime.jsx(descriptionAlias,{...props});}
function button(props){compiler.c(1);return props;}
function settings({contentClassName,chevronClassName,color}){compiler.c(1);return runtime.jsx(button,{size:'toolbar',color});}
function menu({triggerButton,contentVariant,contentMaxHeight,onContentPointerEnter}){compiler.c(1);return runtime.jsx(items.Trigger,{});}
export{setup,dialog,body,section,heading,footer,title,description,button,settings,menu,items};
`;
const row = `let compiler,setup=once(()=>{compiler=runtime();});function selectable({ariaCurrent,compactSecondLine,hasInteractiveContent,secondLineRightText,titleAdornment,onSelect}){compiler.c(1);}export{setup,selectable};`;
const rewind = `let icon,setup=once(()=>{icon=createIcon('Rewind',[]);});export{icon,setup};`;

test('all native UI roles and their lazy owners survive alpha renaming', () => {
  const initial = 'initial.js',
    primary = 'primary.js';
  const build = (rename) =>
    renderNativeAdapters(
      { [initial]: rename(ui + persistence), [primary]: rename(row) },
      {
        initial,
        primary,
        sourceModules: { names: ['rewind-any.js'], read: () => rename(rewind) },
      },
    );
  const original = build((s) => s),
    renamed = build(renameBindings);
  expect(renamed.files).toEqual(original.files);
  const native = original.files['model-spread-native.mjs'];
  for (const role of [
    'Dialog',
    'Body',
    'Section',
    'Heading',
    'Title',
    'Description',
    'Footer',
    'Button',
    'SettingsTrigger',
    'Menu',
    'Items',
    'Rewind',
  ])
    expect(native).toContain(` as ${role}}`);
  expect(native.match(/initializeNative\d+\(\);/g)).toHaveLength(1);
  expect(original.primaryExports).toContain('selectable as ModelSpreadSelectableRow');
  expect(renamed.primaryExports).not.toBe(original.primaryExports);
});
