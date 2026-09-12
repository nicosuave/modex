import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform, files, providerAdapter } from './build-mod.mjs';
import { composerAvailable, getPaneContext } from './runtime.mjs';
import { createDragCoordinator } from './drag.mjs';
import { selectMods, defaultMods, compatibilityFor } from '../combined/compatibility.mjs';
import { analyze } from 'eslint-scope';
import {
  editSource,
  literalValue,
  parseModule,
  propertyName,
  unique,
} from '../../lib/source-contract.mjs';
import { fixtureSourceModules, renameBindings } from '../../lib/source-contract.test-support.mjs';
import { inspectNativeModule, patchTaskDrag } from './source-hooks.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test('panes are opt-in and canonical selection preserves existing defaults', () => {
  expect(defaultMods).toEqual(['model-spread', 'theme-icon']);
  expect(selectMods(['task-panes', 'theme-icon', 'model-spread'])).toEqual([
    'model-spread',
    'theme-icon',
    'task-panes',
  ]);
  expect(Object.keys(compatibilityFor(['task-panes']).files)).toContain(files.localThread);
  expect(() => transform({})).toThrow('Task Panes');
});

for (const kind of ['local', 'cloud'])
  test(`stock provider adapter isolates ${kind} task location, params, and scopes`, async () => {
    const Location = React.createContext(null),
      Route = React.createContext({ matches: [] });
    const location = {
      pathname: '/local/other',
      search: '',
      state: { prefillPrompt: 'private draft' },
    };
    const task =
      kind === 'local'
        ? {
            kind,
            conversationId: 'task-a',
            hostId: 'nicbook-atm',
            key: 'local:nicbook-atm:task-a',
            path: '/local/task-a?hostId=nicbook-atm',
          }
        : { kind, taskId: 'cloud-a', key: 'cloud:cloud-a', path: '/remote/cloud-a' };
    let observed;
    function Scope({ route, children }) {
      observed = { ...observed, route };
      return children;
    }
    function Composer({ children }) {
      observed = { ...observed, composer: true };
      return children;
    }
    function Content() {
      observed = {
        ...observed,
        location: React.useContext(Location).location,
        params: React.useContext(Route).matches.at(-1).params,
      };
      return null;
    }
    const body = providerAdapter
      .slice(0, providerAdapter.indexOf('function ModexPaneShell'))
      .replace('export function', 'function');
    const Adapter = new Function(
      'ModexPaneNative',
      'TaskPanesRuntime',
      body + ';return ModexPaneProviders;',
    )(
      {
        initialize() {},
        React,
        location: () => location,
        RouteContext: Route,
        LocationContext: Location,
        ScopeProvider: Scope,
        ComposerProvider: Composer,
      },
      { usePane: () => React.useContext(getPaneContext(React)) },
    );
    let tree;
    await act(async () => {
      tree = create(
        React.createElement(
          Route.Provider,
          { value: { matches: [{ params: { conversationId: 'other', taskId: 'wrong' } }] } },
          React.createElement(
            getPaneContext(React).Provider,
            { value: { active: false } },
            React.createElement(Adapter, { task }, React.createElement(Content)),
          ),
        ),
      );
    });
    expect(observed.location.state).toBe(null);
    expect(observed.location.pathname).toBe(kind === 'local' ? '/local/task-a' : '/remote/cloud-a');
    expect(observed.params).toEqual(
      kind === 'local' ? { conversationId: 'task-a' } : { taskId: 'cloud-a' },
    );
    expect(observed.route.routeKind).toBe(kind === 'local' ? 'local-thread' : 'remote-thread');
    expect(observed.composer).toBe(true);
    if (kind === 'local') expect(observed.route.hostId).toBe('nicbook-atm');
    await act(async () => tree.unmount());
  });

const root = process.env.TASK_PANES_BUNDLES;
let outputs;
function fixtures() {
  if (!outputs) {
    const originals = Object.fromEntries(
      Object.values(files).map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
    );
    const context = { sourceModules: fixtureSourceModules(root) };
    const patched = transform(originals, context);
    outputs = [{ name: 'stock', originals, patched, context }];
  }
  return outputs;
}
const member = (node, name) =>
  node?.type === 'MemberExpression' && propertyName(node.property) === name;
const unwrapCall = (node) => (node?.type === 'SequenceExpression' ? node.expressions.at(-1) : node);
const prop = (node, name) =>
  node?.properties?.find((item) => item.type === 'Property' && propertyName(item.key) === name)
    ?.value;
const has = (node, ...names) => names.every((name) => prop(node, name));
const isJsx = (node) =>
  node?.type === 'CallExpression' &&
  ['jsx', 'jsxs'].some((name) => member(unwrapCall(node.callee), name));
const id = (node) => {
  if (node?.type !== 'Identifier') throw Error('Expected a captured native identifier');
  return node.name;
};
function evaluate(source, bindings) {
  // Execute the captured native code after lexical renaming of its complete
  // dependency scope, preserving property keys and binding identity.
  const expression = `(function(${Object.keys(bindings).join(',')}){${source}})`;
  const renamed = renameBindings(expression);
  return new Function(`return ${renamed};`)()(...Object.values(bindings));
}
function externalBindings(source) {
  const scope = analyze(parseModule(source).ast, { ecmaVersion: 2024, sourceType: 'module' });
  return Object.fromEntries(
    [...new Set(scope.globalScope.through.map((ref) => ref.identifier.name))]
      .filter((name) => !(name in globalThis))
      .map((name) => [name, () => null]),
  );
}
function nativeFunction(module, predicate, label) {
  const { within } = inspectNativeModule(module);
  return unique(
    module.ast.body.filter(
      (node) => node.type === 'FunctionDeclaration' && predicate(node, within),
    ),
    label,
  );
}
function rendererBindings(module, functions) {
  const source = functions.map(module.text).join(';');
  const bindings = externalBindings(source);
  const { within } = inspectNativeModule(module);
  for (const fn of functions)
    for (const call of within(fn, (node) => node.type === 'CallExpression')) {
      const target = unwrapCall(call.callee);
      if (member(target, 'c'))
        bindings[id(target.object)] = {
          c: (length) => Array(length).fill(Symbol.for('react.memo_cache_sentinel')),
        };
      if (isJsx(call))
        bindings[id(target.object)] = {
          jsx: (type, props, key) => ({ type, props, key }),
          jsxs: (type, props, key) => ({ type, props, key }),
        };
    }
  return { source, bindings };
}
function referenceFunction(module) {
  return nativeFunction(
    module,
    (fn, within) =>
      within(
        fn,
        (node) => node.type === 'CallExpression' && member(node.callee, 'elementsFromPoint'),
      ).length === 1 &&
      within(fn, (node) => node.type === 'CallExpression' && member(node.callee, 'closest'))
        .length === 1,
    'native task-reference lookup',
  );
}
function dragEnd(module) {
  const lookup = referenceFunction(module);
  const { within, one, valueOf } = inspectNativeModule(module);
  const provider = nativeFunction(
    module,
    (fn) =>
      within(
        fn,
        (node) =>
          node.type === 'ObjectExpression' && has(node, 'onDragStart', 'onDragEnd', 'onDragCancel'),
      ).length === 1 &&
      within(fn, (node) => node.type === 'CallExpression' && node.callee.name === lookup.id.name)
        .length > 0,
    'native drag provider',
  );
  const callbacks = one(
    provider,
    (node) =>
      node.type === 'ObjectExpression' && has(node, 'onDragStart', 'onDragEnd', 'onDragCancel'),
    'native drag callbacks',
  );
  let end = prop(callbacks, 'onDragEnd');
  while (end.type === 'Identifier') end = valueOf(end, provider);
  return { lookup, end, provider, callbacks };
}

function fixtureTest(name, fn) {
  test.skipIf(!root)(
    name,
    () => {
      for (const fixture of fixtures()) fn(fixture);
    },
    120000,
  );
}

fixtureTest(
  'tall Priority and dated rows use native task drags without changing other rows',
  (fixture) => {
    const module = parseModule(fixture.patched[files.primary]);
    const { within, one } = inspectNativeModule(module);
    const owner = nativeFunction(
      module,
      (fn) =>
        within(fn, (node) => node.type === 'ObjectPattern' && has(node, 'key', 'row')).length ===
          1 &&
        within(fn, (node) => node.type === 'CallExpression' && member(node.callee, 'sidebarKey'))
          .length > 0,
      'native tall-row renderer',
    );
    // The same decoder occurs in the guard and payload; both must use the same native router object.
    const routingNames = [
      ...new Set(
        within(
          owner,
          (node) => node.type === 'CallExpression' && member(node.callee, 'sidebarKey'),
        ).map((node) => id(node.callee.object)),
      ),
    ];
    expect(routingNames).toHaveLength(1);
    const drag = one(
      owner,
      (node) => isJsx(node) && has(node.arguments[1], 'threadKey', 'children'),
      'native draggable row',
    );
    const { source, bindings } = rendererBindings(module, [owner]);
    const nativeDragRow = () => {};
    bindings[routingNames[0]] = {
      sidebarKey: (key) => {
        const value = key.replace(/^codex:thread:/, '');
        return /^(local|remote):/.test(value) ? value : null;
      },
    };
    bindings[id(drag.arguments[0])] = nativeDragRow;
    const render = evaluate(`${source};return ${owner.id.name};`, bindings);
    for (const key of ['local:task-a', 'local:ssh-task', 'remote:cloud-a']) {
      const row = { title: key, secondaryContent: 'project and host' };
      const result = render({ key: `codex:thread:${key}`, row });
      expect(result.type).toBe(nativeDragRow);
      expect(result.props).toEqual({ threadKey: key, children: row });
      expect(result.key).toBe(`codex:thread:${key}`);
    }
    for (const key of ['chatgpt:conversation:a', 'codex:project:a', 'content-tab:a']) {
      const row = { title: key };
      expect(render({ key, row })).toEqual({
        type: 'div',
        props: { role: 'listitem', children: row },
        key,
      });
    }
  },
);

fixtureTest(
  'native tall-row drag payload retains local, SSH, and cloud task identity',
  (fixture) => {
    const module = parseModule(fixture.patched[files.primary]);
    const { within, one, valueOf } = inspectNativeModule(module);
    const wrapper = nativeFunction(
      module,
      (fn) =>
        within(
          fn,
          (node) =>
            isJsx(node) &&
            has(
              node.arguments[1],
              'threadKey',
              'containerId',
              'sourceProjectKind',
              'threadDragState',
              'children',
            ),
        ).length === 1 &&
        within(fn, (node) => node.type === 'ObjectPattern' && has(node, 'threadKey', 'children'))
          .length === 1,
      'native nonsortable wrapper',
    );
    const payloadCall = one(
      wrapper,
      (node) =>
        isJsx(node) &&
        has(
          node.arguments[1],
          'threadKey',
          'containerId',
          'sourceProjectKind',
          'threadDragState',
          'children',
        ),
      'native drag payload component',
    );
    const owner = unique(
      module.ast.body.filter(
        (node) =>
          node.type === 'FunctionDeclaration' && node.id.name === id(payloadCall.arguments[0]),
      ),
      'native drag payload renderer',
    );
    const drag = one(
      owner,
      (node) =>
        node.type === 'CallExpression' &&
        has(node.arguments[0], 'id', 'disabled', 'data') &&
        has(prop(node.arguments[0], 'data'), 'kind', 'thread'),
      'native draggable hook',
    );
    const thread = prop(prop(drag.arguments[0], 'data'), 'thread');
    const reference = valueOf(prop(thread, 'threadReference'), owner);
    const referenceOwner = unique(
      module.ast.body.filter(
        (node) => node.type === 'FunctionDeclaration' && node.id.name === id(reference.callee),
      ),
      'native task-reference builder',
    );
    const entryRead = valueOf(prop(reference.arguments[0], 'entry'), owner);
    const threadId = valueOf(prop(thread, 'threadId'), owner);
    expect(threadId.type).toBe('LogicalExpression');
    const primaryId = threadId.left,
      fallbackId = threadId.right;
    const contexts = within(
      owner,
      (node) => node.type === 'CallExpression' && member(unwrapCall(node.callee), 'useContext'),
    );
    const titleRead = one(
      referenceOwner,
      (node) => node.type === 'CallExpression' && node.callee.name === id(entryRead.callee),
      'native catalog title lookup',
    );
    const translate = one(
      owner,
      (node) =>
        node.type === 'CallExpression' &&
        member(node.callee, 'toString') &&
        member(node.callee.object, 'Translate'),
      'native transform formatting',
    );
    const selected = one(
      owner,
      (node) => node.type === 'CallExpression' && member(node.callee, 'some'),
      'selected drag rows',
    );
    const selectedContext = valueOf(selected.callee.object, owner);
    for (const entry of [
      { kind: 'local', conversationId: 'task-a', hostId: 'local', catalogTitle: 'Local task' },
      {
        kind: 'local',
        conversationId: 'ssh-task',
        hostId: 'nicbook-atm',
        catalogTitle: 'SSH task',
      },
      { kind: 'remote', task: { id: 'cloud-a' } },
    ]) {
      const { source, bindings } = rendererBindings(module, [owner, referenceOwner]);
      for (const call of contexts) {
        bindings[id(unwrapCall(call.callee).object)] = { useContext: (context) => context };
        bindings[id(call.arguments[0])] = false;
      }
      bindings[id(selectedContext.arguments[0])] = [];
      bindings[id(entryRead.arguments[0])] = 'entry';
      bindings[id(titleRead.arguments[0])] = 'title';
      bindings[id(entryRead.callee)] = (atom) => (atom === 'entry' ? entry : null);
      bindings[id(primaryId.callee)] = (value) =>
        value.kind === 'local' ? value.conversationId : value.task.id;
      bindings[id(fallbackId.callee)] = () => null;
      bindings[id(translate.callee.object.object)] = { Translate: { toString: () => undefined } };
      let payload;
      bindings[id(drag.callee)] = (options) => {
        payload = options.data.thread;
        return { attributes: {}, listeners: { onPointerDown: () => {} }, isDragging: false };
      };
      const render = evaluate(`${source};return ${owner.id.name};`, bindings);
      const key =
        entry.kind === 'local' ? `local:${entry.conversationId}` : `remote:${entry.task.id}`;
      const row = render({ threadKey: key, containerId: null, children: 'Tall row' });
      expect(row.props.children.props.onPointerDown).toBeFunction();
      expect(payload.threadKey).toBe(key);
      expect(payload.threadId).toBe(entry.conversationId ?? entry.task.id);
      expect(payload.containerId).toBeNull();
      if (entry.kind === 'local') {
        expect(payload.threadReference.hostId).toBe(entry.hostId);
        expect(payload.threadReference.getTitle()).toBe(entry.catalogTitle);
      } else expect(payload.threadReference).toBeNull();
    }
  },
);

fixtureTest(
  'transformed native composer registry never selects a hidden or unfocused pane',
  (fixture) => {
    const module = parseModule(fixture.patched[files.initial]);
    const { within, one } = inspectNativeModule(module);
    const choose = nativeFunction(
      module,
      (fn) =>
        within(
          fn,
          (node) =>
            node.type === 'CallExpression' &&
            member(node.callee, 'querySelectorAll') &&
            literalValue(node.arguments[0]) === '[data-codex-composer]',
        ).length === 1,
      'native composer selector',
    );
    const primary = nativeFunction(
      module,
      (fn) =>
        within(fn, (node) => node.type === 'ObjectPattern' && has(node, 'isPrimaryComposer'))
          .length > 0 && within(fn, (node) => node.type === 'ForOfStatement').length === 1,
      'primary composer selector',
    );
    const registry = one(
      choose,
      (node) => node.type === 'CallExpression' && member(node.callee, 'keys'),
      'composer registry',
    );
    const connected = within(
      choose,
      (node) => member(node, 'isConnected') && node.object.type === 'Identifier',
    );
    const source = [choose, primary].map(module.text).join(';');
    const element = (active, visible = true) => ({
      isConnected: true,
      closest: () => ({
        getAttribute: (name) => String(name === 'data-modex-pane-active' ? active : visible),
        hidden: !visible,
        inert: !visible,
      }),
    });
    const hidden = element(true, false),
      inactive = element(false),
      active = element(true);
    function run(entries) {
      const bindings = externalBindings(source);
      bindings[id(registry.callee.object)] = new Map(
        entries.map((element) => [element, { isPrimaryComposer: true }]),
      );
      for (const item of connected)
        if (Object.hasOwn(bindings, item.object.name)) bindings[item.object.name] = hidden;
      for (const fn of [choose, primary])
        for (const call of within(
          fn,
          (node) => node.type === 'CallExpression' && member(node.callee, 'composerAvailable'),
        ))
          bindings[id(call.callee.object)] = { composerAvailable };
      for (const fn of [choose, primary])
        for (const call of within(
          fn,
          (node) => node.type === 'CallExpression' && member(node.callee, 'at'),
        ))
          if (
            call.callee.object.type === 'Identifier' &&
            Object.hasOwn(bindings, call.callee.object.name)
          )
            bindings[call.callee.object.name] = [];
      bindings.document = { querySelectorAll: () => entries };
      return evaluate(`${source};return ${choose.id.name}();`, bindings);
    }
    expect(run([hidden, inactive, active])).toBe(active);
    expect(run([hidden])).toBe(null);
  },
);

fixtureTest(
  'actual stock drag end still inserts references, while accepted pane drops cancel reordering',
  (fixture) => {
    const module = parseModule(fixture.patched[files.primary]);
    const { within, one, valueOf } = inspectNativeModule(module);
    const { lookup, end, callbacks } = dragEnd(module);
    const endSource = module.text(end);
    for (const reference of [true, false]) {
      const drag = createDragCoordinator();
      let paneDrops = 0,
        references = 0,
        cancels = 0;
      drag.attach({
        preview: () => {},
        drop: () => {
          paneDrops++;
          return true;
        },
      });
      drag.start([{ key: 'local:a', path: '/local/a' }]);
      drag.move({ x: 100, y: 100 });
      const target = {},
        payload = [{ threadId: 'a', hostId: 'local', title: 'A' }],
        thread = { threadId: 'a', threadKey: 'local:a' };
      const bindings = externalBindings(`const handler=${endSource};`);
      for (const node of within(
        end,
        (node) => member(node, 'current') && node.object.type === 'Identifier',
      ))
        if (Object.hasOwn(bindings, node.object.name))
          bindings[node.object.name] = { current: null };
      const drop = one(
        end,
        (node) => node.type === 'CallExpression' && member(node.callee, 'drop'),
        'pane drop',
      );
      bindings[id(drop.callee.object)] = drag;
      bindings[id(lookup.id)] = () => (reference ? target : null);
      bindings[id(prop(callbacks, 'onDragCancel'))] = () => cancels++;
      const nativeThread = one(
        end,
        (node) =>
          node.type === 'CallExpression' &&
          member(node.arguments[0], 'current') &&
          member(node.arguments[0].object, 'data'),
        'native drag event decoder',
      );
      bindings[id(nativeThread.callee)] = (value) => value;
      const insertion = one(
        end,
        (node) =>
          node.type === 'CallExpression' &&
          node.arguments.length === 2 &&
          node.arguments.every((arg) => arg.type === 'Identifier') &&
          node.callee.type === 'Identifier' &&
          within(
            end,
            (n) => n.type === 'IfStatement' && within(n.test, (c) => c === node).length > 0,
          ).length > 0,
        'native reference insertion',
      );
      const payloadValue = valueOf(insertion.arguments[1], end);
      const selectedPayload = one(
        payloadValue,
        (node) => node.type === 'CallExpression',
        'reference payload builder',
      );
      bindings[id(selectedPayload.callee)] = () => payload;
      const selection = valueOf(selectedPayload.arguments[0], end);
      expect(member(selection, 'current')).toBe(true);
      bindings[id(selection.object)] = { current: [thread] };
      bindings[id(insertion.callee)] = (element, items) => {
        expect(element).toBe(target);
        expect(items).toEqual(payload);
        references++;
        return true;
      };
      const handler = evaluate(`return ${endSource};`, bindings);
      handler({ active: { data: { current: { kind: 'sidebar-item', thread } } } });
      expect(references).toBe(reference ? 1 : 0);
      expect(paneDrops).toBe(reference ? 0 : 1);
      expect(cancels).toBe(reference ? 0 : 1);
    }
  },
);

fixtureTest(
  'exact transforms reject repeated application and changed native call sites',
  (fixture) => {
    expect(() => transform(fixture.patched, fixture.context)).toThrow();
    const module = parseModule(fixture.originals[files.primary]);
    const { one, within } = inspectNativeModule(module);
    const row = nativeFunction(
      module,
      (fn) =>
        within(fn, (node) => node.type === 'ObjectPattern' && has(node, 'key', 'row')).length ===
          1 &&
        within(
          fn,
          (node) => isJsx(node) && literalValue(prop(node.arguments[1], 'role')) === 'listitem',
        ).length === 1,
      'tall row native contract',
    );
    const role = one(
      row,
      (node) => isJsx(node) && literalValue(prop(node.arguments[1], 'role')) === 'listitem',
      'native row role',
    );
    const target = prop(role.arguments[1], 'role');
    const changed = editSource(fixture.originals[files.primary], [
      { start: target.start, end: target.end, text: '"unsupported-row-role"' },
    ]);
    expect(() => patchTaskDrag(parseModule(changed))).toThrow();
  },
);

fixtureTest(
  'stock reference lookup yields whole-panel hits only while the workspace accepts the task drag',
  (fixture) => {
    const module = parseModule(fixture.patched[files.primary]);
    const { one } = inspectNativeModule(module);
    const owner = referenceFunction(module);
    const source = module.text(owner);
    class Element {
      closest() {
        return this;
      }
    }
    const target = new Element();
    let accepts = false;
    const bindings = externalBindings(source);
    const claim = one(
      owner,
      (node) => node.type === 'CallExpression' && member(node.callee, 'claims'),
      'pane drag claim',
    );
    bindings[id(claim.callee.object)] = { claims: () => accepts };
    bindings.document = { elementsFromPoint: () => [target] };
    bindings.HTMLElement = Element;
    const lookup = one(
      owner,
      (node) => node.type === 'CallExpression' && member(node.callee, 'get'),
      'native reference target registry',
    );
    bindings[id(lookup.callee.object)] = new WeakMap([[target, { hostId: 'local' }]]);
    const closest = one(
      owner,
      (node) => node.type === 'CallExpression' && member(node.callee, 'closest'),
      'native reference target attribute',
    );
    for (const value of closest.arguments[0].expressions ?? [])
      if (value.type === 'Identifier')
        bindings[value.name] = 'data-codex-thread-reference-drop-target';
    const find = evaluate(`${source};return ${owner.id.name};`, bindings);
    expect(find(100, 100)).toBe(target);
    accepts = true;
    expect(find(100, 100)).toBeNull();
    accepts = false;
    expect(find(100, 100)).toBe(target);
    expect(find(100, 100, 'other-host')).toBeNull();
  },
);
