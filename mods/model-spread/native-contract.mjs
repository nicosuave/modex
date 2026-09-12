import fs from 'node:fs';
import { full } from 'acorn-walk';
import {
  parseModule,
  unique,
  literalValue,
  propertyName,
  lexicalBindings,
  bindingInitializer,
  lazyInitializerOwner as lazyOwner,
} from '../../lib/source-contract.mjs';

const indexes = new WeakMap();
function index(module) {
  if (indexes.has(module)) return indexes.get(module);
  const functions = module.ast.body.filter((n) => n.type === 'FunctionDeclaration');
  const exports = new Map(),
    imports = new Map(),
    assignments = new Map();
  for (const node of module.ast.body) {
    if (node.type === 'ExportNamedDeclaration')
      for (const item of node.specifiers) exports.set(item.local.name, propertyName(item.exported));
    if (node.type === 'ImportDeclaration')
      for (const item of node.specifiers)
        imports.set(item.local.name, {
          file: node.source.value,
          name: item.type === 'ImportDefaultSpecifier' ? 'default' : propertyName(item.imported),
        });
  }
  const bindings = lexicalBindings(module);
  for (const node of module.ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const declaration of node.declarations) {
      if (declaration.id.type !== 'Identifier') continue;
      assignments.set(declaration.id.name, bindings.writes(bindings.resolve(declaration.id)));
    }
  }
  const result = { functions, exports, imports, assignments };
  indexes.set(module, result);
  return result;
}
const within = (_module, node, predicate) => {
  const found = [];
  full(node, (n) => {
    if (predicate(n)) found.push(n);
  });
  return found;
};
const member = (node, name) =>
  node?.type === 'MemberExpression' && propertyName(node.property) === name;
const property = (object, name) =>
  object?.properties?.find((n) => n.type === 'Property' && propertyName(n.key) === name)?.value;
const callee = (node) => (node?.type === 'SequenceExpression' ? node.expressions.at(-1) : node);
const jsx = (node) =>
  node.type === 'CallExpression' &&
  ['jsx', 'jsxs'].some((name) => member(callee(node.callee), name));
const names = (object) =>
  new Set(object.properties.filter((n) => n.type === 'Property').map((n) => propertyName(n.key)));
function ownerByProps(module, required, label) {
  const owners = new Set(
    module.nodes
      .filter((n) => n.type === 'ObjectPattern' && required.every((key) => names(n).has(key)))
      .map((n) => module.ancestor(n, (p) => p.type === 'FunctionDeclaration'))
      .filter(Boolean),
  );
  return unique([...owners], label);
}
function ownerByLabel(module, label) {
  const owners = new Set(
    module.nodes
      .filter((n) => literalValue(n) === label)
      .map((n) => module.ancestor(n, (p) => p.type === 'FunctionDeclaration'))
      .filter(Boolean),
  );
  return unique([...owners], label);
}
export function findInitializer(module, localName) {
  const fn = index(module).functions.find((n) => n.id.name === localName);
  if (fn) {
    const compiler = unique(
      within(
        module,
        fn,
        (n) =>
          n.type === 'CallExpression' &&
          member(callee(n.callee), 'c') &&
          callee(n.callee).object.type === 'Identifier',
      )
        .map((n) => callee(n.callee).object)
        .filter(
          (node, i, nodes) =>
            nodes.findIndex(
              (other) =>
                lexicalBindings(module).resolve(other) === lexicalBindings(module).resolve(node),
            ) === i,
        ),
      `${localName} compiler runtime`,
    );
    return bindingInitializer(module, compiler);
  }
  return bindingInitializer(module, localName);
}
function imported(module, file, local) {
  const external = index(module).imports.get(local);
  if (external) return external;
  const name = index(module).exports.get(local);
  if (!name) throw Error(`Native role ${local} is not exported`);
  return { file: `./${file}`, name };
}
function exportedWrapper(module, label) {
  const assignment = unique(
    module.nodes.filter(
      (n) =>
        n.type === 'AssignmentExpression' &&
        member(n.left, 'displayName') &&
        n.right.type === 'Identifier' &&
        (index(module).assignments.get(n.right.name) ?? []).some(
          (a) => literalValue(a.value) === label,
        ),
    ),
    `${label} display name`,
  );
  const aliases = new Set([assignment.left.object.name]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, list] of index(module).assignments)
      if (
        !aliases.has(name) &&
        list.some((a) => a.value.type === 'Identifier' && aliases.has(a.value.name))
      ) {
        aliases.add(name);
        changed = true;
      }
  }
  return unique(
    index(module).functions.filter(
      (fn) =>
        index(module).exports.has(fn.id.name) &&
        within(
          module,
          fn,
          (n) =>
            jsx(n) && n.arguments[0]?.type === 'Identifier' && aliases.has(n.arguments[0].name),
        ).length === 1,
    ),
    `${label} exported wrapper`,
  );
}
export function discoverPersistence(module) {
  const guard = ownerByLabel(module, 'Persisted atom store accessed before initialization');
  const reader = unique(
    index(module).functions.filter(
      (fn) =>
        fn.params.length === 2 &&
        within(
          module,
          fn,
          (n) =>
            n.type === 'CallExpression' &&
            n.callee.type === 'Identifier' &&
            n.callee.name === guard.id.name,
        ).length &&
        within(module, fn, (n) => n.type === 'CallExpression' && member(n.callee, 'has')).length ===
          1 &&
        within(module, fn, (n) => n.type === 'CallExpression' && member(n.callee, 'get')).length ===
          1 &&
        fn.body.body.length === 1,
    ),
    'persisted atom reader',
  );
  const cache = unique(
    within(module, reader, (n) => n.type === 'CallExpression' && member(n.callee, 'get')),
    'persisted cache read',
  ).callee.object.name;
  const publish = unique(
    index(module).functions.filter(
      (fn) =>
        within(
          module,
          fn,
          (n) =>
            n.type === 'CallExpression' &&
            member(n.callee, 'set') &&
            n.callee.object.name === cache,
        ).length === 1 &&
        within(
          module,
          fn,
          (n) =>
            n.type === 'CallExpression' &&
            member(n.callee, 'delete') &&
            n.callee.object.name === cache,
        ).length === 1,
    ),
    'persisted atom publisher',
  );
  const writer = unique(
    index(module).functions.filter(
      (fn) =>
        fn.params.length === 2 &&
        fn.body.body.length === 1 &&
        within(
          module,
          fn,
          (n) =>
            n.type === 'CallExpression' &&
            n.callee.name === publish.id.name &&
            n.arguments.length === 3 &&
            n.arguments[0].name === fn.params[0].name &&
            n.arguments[1].name === fn.params[1].name &&
            n.arguments[2].type === 'UnaryExpression' &&
            n.arguments[2].operator === '!' &&
            literalValue(n.arguments[2].argument) === 0,
        ).length === 1,
    ),
    'persisted atom writer',
  );
  const initialize = lazyOwner(
    module,
    unique(
      (index(module).assignments.get(cache) ?? []).filter(
        (a) => a.value.type === 'NewExpression' && a.value.callee.name === 'Map',
      ),
      'persisted cache initializer',
    ).node,
  );
  const bridges = new Set(
    module.nodes
      .filter(
        (n) =>
          n.type === 'CallExpression' &&
          member(n.callee, 'dispatchMessage') &&
          literalValue(n.arguments[0]) === 'persisted-atom-sync-request',
      )
      .map((n) => n.callee.object.name),
  );
  return {
    read: reader.id.name,
    write: writer.id.name,
    initialize,
    bridge: unique([...bridges], 'persisted atom message bus'),
  };
}

export function discoverRewind(sourceModules) {
  if (!sourceModules) throw Error('Native icon discovery requires the stock module inventory');
  const candidates = [];
  for (const name of sourceModules.names.filter((name) => /^rewind-.*\.js$/.test(name))) {
    const module = parseModule(sourceModules.read(name));
    for (const call of module.nodes.filter(
      (n) =>
        n.type === 'CallExpression' &&
        literalValue(n.arguments[0]) === 'Rewind' &&
        n.arguments[1]?.type === 'ArrayExpression',
    )) {
      const assignment = module.parents.get(call);
      if (assignment?.type !== 'AssignmentExpression' || assignment.left.type !== 'Identifier')
        throw Error('Native rewind icon ownership changed');
      candidates.push({
        icon: imported(module, name, assignment.left.name),
        initialize: imported(module, name, lazyOwner(module, assignment)),
      });
    }
  }
  return unique(candidates, 'native Rewind icon factory');
}

export function renderNativeAdapters(bundles, { initial, primary, modules = {}, sourceModules }) {
  const module = modules.initial ?? parseModule(bundles[initial]);
  const primaryModule = modules.primary ?? parseModule(bundles[primary]);
  const roles = {
    Dialog: ownerByProps(
      module,
      ['triggerContent', 'triggerAsChild', 'dialogCloseLabel', 'contentProps'],
      'native Dialog',
    ),
    Body: ownerByLabel(module, 'DialogBody'),
    Section: ownerByLabel(module, 'DialogSection'),
    Heading: ownerByLabel(module, 'DialogHeader'),
    Footer: ownerByLabel(module, 'DialogFooter'),
    Title: exportedWrapper(module, 'DialogTitle'),
    Description: exportedWrapper(module, 'DialogDescription'),
    SettingsTrigger: ownerByProps(
      module,
      ['contentClassName', 'chevronClassName', 'color'],
      'settings trigger',
    ),
    Menu: ownerByProps(
      module,
      ['triggerButton', 'contentVariant', 'contentMaxHeight', 'onContentPointerEnter'],
      'settings menu',
    ),
  };
  const items = unique(
    within(module, roles.Menu, (n) => jsx(n) && member(n.arguments[0], 'Trigger')),
    'menu Trigger',
  ).arguments[0].object.name;
  const button = unique(
    within(
      module,
      roles.SettingsTrigger,
      (n) =>
        jsx(n) &&
        literalValue(property(n.arguments[1], 'size')) === 'toolbar' &&
        property(n.arguments[1], 'color'),
    ),
    'settings Button',
  ).arguments[0].name;
  const imports = [],
    initCalls = [],
    seen = new Set();
  function addImport(reference, role) {
    imports.push(`import {${reference.name} as ${role}} from ${JSON.stringify(reference.file)};`);
  }
  function addInitializer(reference) {
    const key = `${reference.file}:${reference.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const role = `initializeNative${seen.size}`;
    addImport(reference, role);
    initCalls.push(`${role}();`);
  }
  function addInit(local) {
    addInitializer(imported(module, initial, local));
  }
  for (const [role, fn] of Object.entries(roles)) {
    addImport(imported(module, initial, fn.id.name), role);
    addInit(findInitializer(module, fn.id.name));
  }
  addImport(imported(module, initial, items), 'Items');
  addInit(findInitializer(module, items));
  const buttonReference = imported(module, initial, button);
  addImport(buttonReference, 'Button');
  if (index(module).imports.has(button)) {
    if (!sourceModules) throw Error('Native Button discovery requires stock dependencies');
    const file = buttonReference.file.replace(/^\.\//, '');
    const dependency = parseModule(sourceModules.read(file));
    const local = unique(
      [...index(dependency).exports].filter(([, name]) => name === buttonReference.name),
      'native Button export',
    )[0];
    addInitializer(imported(dependency, file, findInitializer(dependency, local)));
  } else {
    addInit(findInitializer(module, button));
  }
  const selectable = ownerByProps(
    primaryModule,
    [
      'ariaCurrent',
      'compactSecondLine',
      'hasInteractiveContent',
      'secondLineRightText',
      'titleAdornment',
      'onSelect',
    ],
    'native selectable row',
  );
  const rowInitialize = findInitializer(primaryModule, selectable.id.name);
  const rewind = discoverRewind(sourceModules);
  addImport(rewind.icon, 'Rewind');
  addImport(rewind.initialize, 'initializeRewind');
  initCalls.push('initializeRewind();');
  const persistence = discoverPersistence(module);
  const storageImports = Object.entries(persistence)
    .map(([role, local]) => {
      const r = imported(module, initial, local);
      return `import {${r.name} as ${role}} from ${JSON.stringify(r.file)};`;
    })
    .join('\n');
  const nativeTemplate = fs.readFileSync(
    new URL('./native-ui.template.mjs', import.meta.url),
    'utf8',
  );
  const storageTemplate = fs.readFileSync(
    new URL('./native-storage.template.mjs', import.meta.url),
    'utf8',
  );
  return {
    files: {
      'model-spread-native.mjs': nativeTemplate
        .replace('/*__NATIVE_IMPORTS__*/', imports.join('\n'))
        .replace('__PRIMARY__', primary)
        .replace('/*__NATIVE_INITIALIZERS__*/', initCalls.join('\n  ')),
      'model-spread-storage.mjs': storageTemplate.replace(
        '/*__STORAGE_IMPORTS__*/',
        storageImports,
      ),
    },
    primaryExports: `export {${selectable.id.name} as ModelSpreadSelectableRow,${rowInitialize} as initializeModelSpreadSelectableRow};`,
    readPersisted: persistence.read,
  };
}
