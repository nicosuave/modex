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
  patchLocalThread,
  patchTaskDrag,
} from './source-hooks.mjs';

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
    const primary = parseModule(bundles[files.primary]);
    const dragEdits = patchTaskDrag(primary);
    const patched = editSource(bundles[files.primary], dragEdits);
    expect(() => patchTaskDrag(parseModule(patched))).toThrow();
  },
  120000,
);
