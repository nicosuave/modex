import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { analyze } from 'eslint-scope';
import {
  parseModule,
  literalValue,
  propertyName,
  editSource,
  unique,
} from '../../lib/source-contract.mjs';
import { renameBindings, fixtureSourceModules } from '../../lib/source-contract.test-support.mjs';
import { files, transform } from './build-mod.mjs';
import {
  discoverProviders,
  discoverRouting,
  discoverLocalPage,
  discoverPortalFactory,
  discoverTaskDragOwner,
  importedRole,
  patchLocalThread,
  patchTaskDrag,
} from './source-hooks.mjs';

test('imported native roles resolve across their verified bundle owners', () => {
  const consumer = parseModule("import {role as local} from './initial.js';local.HeaderButton;");
  const primary = parseModule('const other = 1; export {other as unrelated};');
  const initial = parseModule('const initializer = 1; export {initializer as role};');
  expect(
    importedRole(consumer, 'local.HeaderButton', [
      { module: primary, path: 'primary.js' },
      { module: initial, path: 'initial.js' },
    ]),
  ).toEqual({ binding: 'initializer', module: initial, path: 'initial.js' });
});

test('React portal discovery accepts sequence-wrapped namespace calls', () => {
  const module = parseModule(
    'let dom,other,initialize=lazy(()=>{dom=loadReactDOM();other=loadReactDOM();});function render(){return (0,dom.createPortal)(content,target);}function renderOther(){return (0,other.createPortal)(content,target);}export{initialize,render,renderOther};',
  );
  expect(discoverPortalFactory(module)).toBe('loadReactDOM');
});

test('task drag ownership follows the bundle containing the complete native contract', () => {
  const unrelated = parseModule('export const value = 1;');
  const owner = parseModule(`
    function lookup(x,y){ return document.elementsFromPoint(x,y); }
    function wrapper({threadKey,children}){ return children; }
    function provider(){ state.pointerCoordinates; return {onDragStart(){},onDragEnd(){},onDragCancel(){}}; }
  `);
  expect(discoverTaskDragOwner([unrelated, owner])).toBe(owner);
});

const root = process.env.TASK_PANES_BUNDLES;
const globals = (source) =>
  new Set(
    analyze(parseModule(source).ast, {
      ecmaVersion: 2024,
      sourceType: 'module',
      optimistic: true,
    }).globalScope.through.map((reference) => reference.identifier.name),
  );
const input = () =>
  Object.fromEntries(
    Object.values(files).map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]),
  );

test.skipIf(!root)('pane pull-request dispatch preserves the stock discriminator and scope', () => {
  const source = input()[files.localPage];
  const module = parseModule(source);
  const discriminator = module.one(
    (node) =>
      node.type === 'BinaryExpression' &&
      ((node.operator === 'in' && literalValue(node.left) === 'request') ||
        (node.operator === '===' &&
          node.left.type === 'MemberExpression' &&
          propertyName(node.left.property) === 'kind' &&
          literalValue(node.right) === 'canonical')),
    'pull-request discriminator',
  );
  const parameter = module.text(
    discriminator.operator === 'in' ? discriminator.right : discriminator.left.object,
  );
  for (const [predicate, first, second] of [
    [`'request' in ${parameter}`, { request: {} }, { url: 'existing' }],
    [
      `${parameter}.kind === 'canonical'`,
      { kind: 'canonical', request: {} },
      { kind: 'request', request: {} },
    ],
  ]) {
    const changed = editSource(source, [
      { start: discriminator.start, end: discriminator.end, text: predicate },
    ]);
    const roles = discoverLocalPage(parseModule(changed));
    const action = parseModule(`const action = ${roles.openPullRequestAction};`);
    const calls = action.all((node) => node.type === 'CallExpression');
    expect(calls).toHaveLength(2);
    const observed = [];
    const dispatch = new Function(
      ...calls.map((call) => action.text(call.callee)),
      `return ${roles.openPullRequestAction};`,
    )(
      (...args) => observed.push(['first', ...args]),
      (...args) => observed.push(['second', ...args]),
    );
    const scope = {};
    dispatch(scope, first);
    dispatch(scope, second);
    expect(observed).toEqual([
      ['first', scope, first],
      ['second', scope, second],
    ]);
  }
  expect(() =>
    discoverLocalPage(
      parseModule(
        editSource(source, [
          {
            start: discriminator.start,
            end: discriminator.end,
            text: `${parameter}.kind === 'unknown'`,
          },
        ]),
      ),
    ),
  ).toThrow('pull request action discriminator');
});

function nativeFunction(module, name, sourceModules) {
  const direct = module.ast.body.find(
    (node) => node.type === 'FunctionDeclaration' && node.id.name === name,
  );
  if (direct) return { module, fn: direct };
  const imported = module.one(
    (node) => node.type === 'ImportSpecifier' && node.local.name === name,
    'native function import',
  );
  const declaration = module.ancestor(imported, (node) => node.type === 'ImportDeclaration');
  const owner = parseModule(
    sourceModules.read(literalValue(declaration.source).replace(/^\.\//, '')),
  );
  const exported = unique(
    owner.ast.body
      .filter((node) => node.type === 'ExportNamedDeclaration')
      .flatMap((node) => node.specifiers)
      .filter((node) => propertyName(node.exported) === propertyName(imported.imported)),
    'native function export',
  );
  return nativeFunction(owner, exported.local.name, sourceModules);
}

function exerciseNativePaths(initial, routing, sourceModules) {
  const local = nativeFunction(initial, routing.localPath, sourceModules);
  const template = unique(
    local.module.nodes.filter(
      (node) =>
        node.start >= local.fn.start && node.end <= local.fn.end && node.type === 'TemplateLiteral',
    ),
    'native local path template',
  );
  const prefix = template.expressions[0].name;
  const value = local.module.one(
    (node) =>
      (node.type === 'AssignmentExpression' &&
        node.left.type === 'Identifier' &&
        node.left.name === prefix &&
        literalValue(node.right) === '/local') ||
      (node.type === 'VariableDeclarator' &&
        node.id.type === 'Identifier' &&
        node.id.name === prefix &&
        literalValue(node.init) === '/local'),
    'local path prefix',
  );
  const localPath = new Function(
    prefix,
    local.module.text(local.fn) + `;return ${local.fn.id.name};`,
  )(literalValue(value.right ?? value.init));
  const host = nativeFunction(initial, routing.hostPath, sourceModules);
  const hostPath = new Function(host.module.text(host.fn) + `;return ${host.fn.id.name};`)();
  expect(localPath('task-a')).toBe('/local/task-a');
  expect(hostPath(localPath('ssh-task'), 'nicbook-atm')).toBe('/local/ssh-task?hostId=nicbook-atm');
}

test.skipIf(!root)(
  'native route builders preserve local and SSH task destinations',
  () => {
    const initial = parseModule(input()[files.initial]),
      sourceModules = fixtureSourceModules(root);
    exerciseNativePaths(initial, discoverRouting(initial, sourceModules), sourceModules);
  },
  120000,
);

// Full lexical renaming exercises semantic capture, not a fixture alias list.
test.skipIf(!root)(
  'task pane contracts survive binding churn without introducing unbound native references',
  () => {
    const originals = input();
    const renamed = Object.fromEntries(
      Object.entries(originals).map(([file, source]) => [file, renameBindings(source)]),
    );
    const sourceModules = fixtureSourceModules(root);
    const output = transform(renamed, { sourceModules });
    for (const file of Object.values(files)) {
      const before = globals(renamed[file]);
      expect(
        [...globals(output[file])].filter((name) => name !== 'undefined' && !before.has(name)),
      ).toEqual([]);
    }
    const routing = discoverRouting(parseModule(renamed[files.initial]), sourceModules);
    expect(Object.keys(routing).sort()).toEqual([
      'hostPath',
      'localPath',
      'sidebarKey',
      'threadKey',
    ]);
    exerciseNativePaths(parseModule(renamed[files.initial]), routing, sourceModules);
  },
  180000,
);

test.skipIf(!root)(
  'structural contracts reject duplicated routes and missing native thread effects',
  () => {
    const bundles = input(),
      initial = parseModule(bundles[files.initial]);
    const route = initial.one(
      (node) =>
        node.type === 'Property' &&
        propertyName(node.key) === 'path' &&
        literalValue(node.value) === '/remote/:taskId',
      'cloud task route',
    );
    const object = initial.parents.get(route);
    expect(() =>
      discoverProviders(
        parseModule(
          bundles[files.initial] + `\nconst modexDuplicateRoute=${initial.text(object)};`,
        ),
      ),
    ).toThrow('cloud task route');
    const thread = parseModule(bundles[files.localThread]);
    const effects = patchLocalThread(thread).filter((edit) =>
      edit.text.startsWith('TaskPanesRuntime.useActiveEffect('),
    );
    expect(effects).toHaveLength(2);
    const missing = editSource(bundles[files.localThread], [
      { start: effects[0].start, end: effects[0].end, text: 'void 0' },
    ]);
    expect(() => patchLocalThread(parseModule(missing))).toThrow('local read subscription');
    const dragOwner = discoverTaskDragOwner(
      [files.primary, files.initial].map((file) => parseModule(bundles[file])),
    );
    const dragEdits = patchTaskDrag(dragOwner);
    const patched = editSource(dragOwner.source, dragEdits);
    expect(() => patchTaskDrag(parseModule(patched))).toThrow();
  },
  120000,
);
