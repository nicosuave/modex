import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseModule,
  unique,
  literalValue,
  propertyName,
  editSource,
  bindingInitializer,
} from './source-contract.mjs';
import { renameBindings } from './source-contract.test-support.mjs';

test('source contracts identify semantic operations and retain owner/source ranges', () => {
  const source = 'function original(value){ return {label:`settings`, answer:value}; }';
  const module = parseModule(source);
  const label = module.one(
    (node) => node.type === 'Property' && propertyName(node.key) === 'label',
    'settings label',
  );
  assert.equal(literalValue(label.value), 'settings');
  assert.equal(module.ancestor(label).id.name, 'original');
  assert.equal(module.text(label), 'label:`settings`');
  assert.equal(module.ofType('Property').length, 2);
  assert.equal(parseModule(source), module);
  assert.notEqual(parseModule(source + '\n'), module);
  assert.throws(() => unique([], 'missing operation'), /found 0/);
  assert.throws(
    () => module.one((node) => node.type === 'Property', 'ambiguous operation'),
    /found 2/,
  );
});

test('source edits preserve unrelated text and reject overlaps', () => {
  assert.equal(
    editSource('abcdef', [
      { start: 4, end: 6, text: 'Z' },
      { start: 1, end: 3, text: 'X' },
    ]),
    'aXdZ',
  );
  assert.throws(
    () =>
      editSource('abcdef', [
        { start: 1, end: 4, text: 'X' },
        { start: 3, end: 5, text: 'Y' },
      ]),
    /overlapping/,
  );
  assert.throws(() => editSource('abc', [{ start: 0, end: 4, text: '' }]), /Invalid/);
});

test('initializer resolution follows lexical bindings and rejects actual duplicate writes', () => {
  const source = `let runtime; const setup=lazy(()=>{runtime=create();});
    function unrelated(){let runtime; runtime=other();}
    {let runtime; runtime=another();}
    function closure(){runtime.use();}`;
  const module = parseModule(source);
  const reference = module.one(
    (node) => node.type === 'MemberExpression' && node.property.name === 'use',
    'runtime use',
  ).object;
  assert.equal(bindingInitializer(module, reference), 'setup');
  assert.equal(bindingInitializer(module, 'runtime'), 'setup');
  assert.throws(
    () => bindingInitializer(parseModule(source + 'runtime=second();'), 'runtime'),
    /found 2/,
  );
  assert.throws(() => bindingInitializer(module, 'missing'), /Missing native lexical binding/);
});

test('lexical renaming preserves shadowing, properties, shorthand and destructuring defaults', () => {
  const source = `function calculate({value = 3}) {
    const inner = value => ({value, label:'value'});
    let result = inner(value + 2);
    return [result.value, result.label, {value}.value];
  }
  return calculate({});`;
  const wrap = `function run(){${source}};globalThis.result = run();`;
  const original = {};
  new Function('globalThis', wrap)(original);
  const renamed = renameBindings(wrap);
  const actual = {};
  new Function('globalThis', renamed)(actual);
  assert.deepEqual(actual, original);
  assert.match(renamed, /modexRenamed_/);
  assert.match(renamed, /label:'value'/);
});

test('lexical renaming preserves module contracts and direct exports', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-alpha-module-'));
  try {
    fs.writeFileSync(
      path.join(directory, 'dependency.mjs'),
      'export const value=4;export const add=(a,b)=>a+b;',
    );
    const source = `import {value,add as increment} from './dependency.mjs';
      const hidden = input => increment(value,input);
      export {hidden as run};
      const shared = value + 1; export {shared};
      export function direct(input){const local=input*2;return hidden(local);}
      export const visible=9;
      export default function named(input){return hidden(input);}`;
    fs.writeFileSync(path.join(directory, 'renamed.mjs'), renameBindings(source));
    const module = await import(pathToFileURL(path.join(directory, 'renamed.mjs')).href);
    assert.equal(module.run(3), 7);
    assert.equal(module.shared, 5);
    assert.equal(module.direct(3), 10);
    assert.equal(module.visible, 9);
    assert.equal(module.default(5), 9);
    assert.deepEqual(Object.keys(module).sort(), ['default', 'direct', 'run', 'shared', 'visible']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('lexical renaming preserves shared class declarations and class-local references', () => {
  const source =
    'class Container { value(){return Container;} } const Named = class Inner { value(){return Inner;} };globalThis.result=[new Container().value()===Container,new Named().value()===Named];';
  const target = {};
  new Function('globalThis', renameBindings(source))(target);
  assert.deepEqual(target.result, [true, true]);
});
