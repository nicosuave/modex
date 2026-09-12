import {
  isFunction,
  literalValue,
  propertyName,
  unique,
  bindingInitializer,
  lazyInitializerOwner as initializerContaining,
} from '../../lib/source-contract.mjs';

const properties = (node) =>
  new Map(
    node?.properties
      ?.filter((property) => property.type === 'Property')
      .map((property) => [propertyName(property.key), property.value]) ?? [],
  );

function callable(node) {
  return node?.type === 'SequenceExpression' ? node.expressions.at(-1) : node;
}

function jsx(node) {
  const callee = callable(node?.callee);
  return (
    node?.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    ['jsx', 'jsxs'].includes(propertyName(callee.property)) &&
    node.arguments[1]?.type === 'ObjectExpression'
  );
}

function within(module, owner, predicate) {
  return module.all(
    (node) => node.start >= owner.start && node.end <= owner.end && predicate(node),
  );
}

function componentInitializer(module, component, role) {
  // The compiler's memo-cache namespace is initialized by the same lazy module
  // that initializes this component's React, JSX and native UI dependencies.
  const cache = unique(
    within(module, component, (node) => {
      const callee = callable(node?.callee);
      return (
        node.type === 'CallExpression' &&
        callee?.type === 'MemberExpression' &&
        propertyName(callee.property) === 'c' &&
        callee.object.type === 'Identifier' &&
        node.arguments.length === 1 &&
        typeof literalValue(node.arguments[0]) === 'number'
      );
    }),
    `${role} memo-cache call`,
  );
  return bindingInitializer(module, callable(cache.callee).object);
}

export function discoverInitializer(module, bindingName) {
  return bindingInitializer(module, bindingName);
}

function nativeRole(module, expression, stem, role) {
  if (expression?.type !== 'Identifier')
    throw Error(`Compatibility check failed: ${role} is not a module component`);
  const declaration = module.one(
    (node) =>
      ((node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') &&
        node.id?.name === expression.name &&
        !module.ancestor(node, isFunction)) ||
      (node.type === 'ImportSpecifier' && node.local.name === expression.name),
    `${role} native binding`,
  );
  // Native components can live in this bundle or in a split chunk. When split,
  // validate the owning module as well as the native call site's prop contract.
  if (declaration.type === 'ImportSpecifier') {
    const owner = module.parents.get(declaration);
    if (!new RegExp(`^\\./${stem}-[a-f0-9]+\\.js$`).test(literalValue(owner.source)))
      throw Error(`Compatibility check failed: ${role} has an unexpected native module`);
  }
  return expression.name;
}

export function discoverNativeUi(module) {
  const shell = module.one(
    (node) =>
      node.type === 'ObjectExpression' &&
      ['Root', 'MainContentLayout', 'HeaderToolbar', 'RightPanel', 'BottomPanel'].every((key) =>
        properties(node).has(key),
      ),
    'native app-shell components',
  );
  const shellAssignment = module.parents.get(shell);
  if (
    shellAssignment?.type !== 'AssignmentExpression' ||
    shellAssignment.left.type !== 'Identifier'
  )
    throw Error('Compatibility check failed: app shell is not assigned to a module binding');
  const toolbar = properties(shell).get('HeaderToolbar');
  const toolbarCallee = callable(toolbar?.callee);
  if (
    toolbarCallee?.type !== 'MemberExpression' ||
    toolbarCallee.object.name !== 'Object' ||
    propertyName(toolbarCallee.property) !== 'assign' ||
    !toolbar.arguments.some((argument) => properties(argument).has('Actions'))
  )
    throw Error('Compatibility check failed: native header toolbar has no Actions component');

  const tabClass = module.one(
    (node) =>
      typeof literalValue(node) === 'string' &&
      literalValue(node).split(' ').includes('group/tab') &&
      literalValue(node).split(' ').includes('max-w-39'),
    'compact native tab class',
  );
  const tab = module.ancestor(tabClass, isFunction);
  if (tab?.type !== 'FunctionDeclaration')
    throw Error('Compatibility check failed: compact tab is not a module component');
  unique(
    within(
      module,
      tab,
      (node) =>
        node.type === 'ObjectPattern' &&
        ['isActive', 'isClosable', 'onActivate', 'onClose', 'title', 'tabActivatorProps'].every(
          (key) => properties(node).has(key),
        ),
    ),
    'compact native tab props',
  );

  const restoreLabel = module.one(
    (node) => literalValue(node) === 'codex.rightPanel.restoreWidth',
    'native restore-width message',
  );
  const toggle = module.ancestor(restoreLabel, isFunction);
  const labelChoice = module.ancestor(
    restoreLabel,
    (node) => node.type === 'ConditionalExpression',
  );
  if (!toggle || !labelChoice)
    throw Error('Compatibility check failed: native width labels have no component choice');
  unique(
    within(
      module,
      labelChoice.alternate,
      (node) => literalValue(node) === 'codex.rightPanel.expandFullWidth',
    ),
    'native expand-width message',
  );
  const icons = unique(
    within(
      module,
      toggle,
      (node) =>
        node.type === 'ConditionalExpression' &&
        module.text(node.test) === module.text(labelChoice.test) &&
        jsx(node.consequent) &&
        jsx(node.alternate),
    ),
    'native maximize/restore icon choice',
  );
  const button = unique(
    within(
      module,
      toggle,
      (node) =>
        jsx(node) &&
        literalValue(
          properties(node.arguments[1]).get('data-app-shell-workspace-layout-toggle'),
        ) === 'right-panel',
    ),
    'native workspace toggle button',
  );
  const tooltip = unique(
    within(
      module,
      toggle,
      (node) =>
        jsx(node) &&
        ['tooltipContent', 'shortcut', 'delayOpen', 'children'].every((key) =>
          properties(node.arguments[1]).has(key),
        ),
    ),
    'native workspace toggle tooltip',
  );

  return {
    AppShell: shellAssignment.left.name,
    Tab: tab.id.name,
    Button: nativeRole(module, button.arguments[0], 'button', 'Button'),
    Tooltip: nativeRole(module, tooltip.arguments[0], 'tooltip', 'Tooltip'),
    RestoreIcon: nativeRole(module, icons.consequent.arguments[0], 'icons', 'RestoreIcon'),
    MaximizeIcon: nativeRole(module, icons.alternate.arguments[0], 'icons', 'MaximizeIcon'),
    initialize: [
      ...new Set([
        initializerContaining(module, shellAssignment, 'app shell'),
        componentInitializer(module, tab, 'compact tab'),
        componentInitializer(module, toggle, 'workspace toggle'),
      ]),
    ],
  };
}
