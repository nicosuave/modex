import {
  isFunction,
  bindingInitializer,
  literalValue,
  parseModule,
  propertyName,
  unique,
} from '../../lib/source-contract.mjs';
import { full } from 'acorn-walk';

// Follow the stock operation and its data flow instead of matching generated
// identifiers. Each role must have one semantic owner; unknown shapes fail
// before edits are applied. The returned names are only source-derived captures.
const member = (node, name) =>
  node?.type === 'MemberExpression' && propertyName(node.property) === name;
const callee = (node) => (node?.type === 'SequenceExpression' ? node.expressions.at(-1) : node);
const properties = (node) =>
  new Map(
    (node?.type === 'ObjectExpression' || node?.type === 'ObjectPattern' ? node.properties : [])
      .filter((p) => p.type === 'Property')
      .map((p) => [propertyName(p.key), p.value]),
  );
const has = (node, ...names) => names.every((name) => properties(node).has(name));
const inside = (outer, node) => node.start >= outer.start && node.end <= outer.end;
const jsx = (node) =>
  node.type === 'CallExpression' &&
  ['jsx', 'jsxs'].some((name) => member(callee(node.callee), name)) &&
  node.arguments[1]?.type === 'ObjectExpression';
const names = (values) => [...new Set(values)];

function tools(module) {
  const subtrees = new WeakMap();
  const within = (scope, predicate) => {
    let nodes = subtrees.get(scope);
    if (!nodes) {
      nodes = [];
      full(scope, (node) => nodes.push(node));
      subtrees.set(scope, nodes);
    }
    return nodes.filter(predicate);
  };
  const one = (scope, predicate, label) => unique(within(scope, predicate), label);
  const topFunction = (node) =>
    unique(
      module.ast.body.filter((item) => item.type === 'FunctionDeclaration' && inside(item, node)),
      'owning native function',
    );
  const functionWith = (value, label = value) =>
    unique(
      names(
        module
          .all(
            (node) =>
              literalValue(node) === value ||
              (node.type === 'Property' && propertyName(node.key) === value),
          )
          .flatMap((node) =>
            module.ast.body.filter(
              (item) => item.type === 'FunctionDeclaration' && inside(item, node),
            ),
          ),
      ),
      label,
    );
  const code = module.text;
  function valueOf(identifier, scope) {
    if (identifier?.type !== 'Identifier') return identifier;
    const values = within(
      scope,
      (node) =>
        ((node.type === 'VariableDeclarator' &&
          node.id.type === 'Identifier' &&
          node.id.name === identifier.name &&
          node.init != null) ||
          (node.type === 'AssignmentExpression' &&
            node.left.type === 'Identifier' &&
            node.left.name === identifier.name)) &&
        module.ancestor(node, isFunction) === scope,
    )
      .map((node) => node.init ?? node.right)
      .filter((node) => !(node.type === 'MemberExpression' && node.computed));
    return unique(values, `definition of ${identifier.name}`);
  }
  const initializationFor = (binding) => bindingInitializer(module, binding);
  function initializeFunction(fn) {
    const cache = one(
      fn,
      (node) => node.type === 'CallExpression' && member(callee(node.callee), 'c'),
      'native memo cache',
    );
    return initializationFor(callee(cache.callee).object);
  }
  return {
    within,
    one,
    topFunction,
    functionWith,
    code,
    valueOf,
    initializationFor,
    initializeFunction,
  };
}

export { tools as inspectNativeModule };

export function discoverProviders(module) {
  const { within, one, functionWith, code, valueOf, initializeFunction, initializationFor } =
    tools(module);
  const locationFunction = functionWith(
    'useLocation() may be used only in the context of a <Router> component.',
    'router location hook',
  );
  const locationContext = one(
    locationFunction,
    (node) => node.type === 'CallExpression' && member(node.callee, 'useContext'),
    'router location context',
  );
  const navigatePattern = module.one(
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.id.type === 'ObjectPattern' &&
      has(node.id, 'isDataRoute') &&
      node.init?.type === 'CallExpression' &&
      member(node.init.callee, 'useContext'),
    'router navigation context',
  );
  const navigateFunction = module.ancestor(
    navigatePattern,
    (node) => node.type === 'FunctionDeclaration',
  );
  const composerScope = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(
          node,
          (n) =>
            n.type === 'ObjectExpression' &&
            has(n, 'cloudThreadPrototype', 'focusComposerNonce', 'initialChatGptConversationId'),
        ).length > 0,
    ),
    'composer scope provider',
  );
  const scopeRead = unique(
    names(
      within(
        composerScope,
        (node) => member(node, 'value') && node.object.type === 'Identifier',
      ).map((node) => node.object.name),
    ),
    'composer route scope variable',
  );
  const routeRead = valueOf({ type: 'Identifier', name: scopeRead }, composerScope);
  const routeObject = module.one(
    (node) =>
      node.type === 'ObjectExpression' &&
      has(node, 'clientThreadId', 'routeConversationId') &&
      node.properties.length === 2,
    'route identity provider value',
  );
  const routeProvider = module.ancestor(routeObject, (node) => node.type === 'FunctionDeclaration');
  const localImport = module.one(
    (node) =>
      node.type === 'ImportExpression' &&
      /\/local-conversation-page-[^/]+\.js$/.test(literalValue(node.source)),
    'local task page import',
  );
  const localPage = module.ancestor(
    localImport,
    (node) => node.type === 'AssignmentExpression' && node.left.type === 'Identifier',
  );
  if (!localPage) throw Error('Unsupported local task lazy page');
  const localPageElement = module.one(
    (node) => jsx(node) && code(node.arguments[0]) === code(localPage.left),
    'local task page element',
  );
  const localRoute = module.ancestor(
    localPageElement,
    (node) => node.type === 'ObjectExpression' && has(node, 'path', 'element'),
  );
  if (!localRoute) throw Error('Unsupported local task route');
  const remoteRoute = module.one(
    (node) =>
      node.type === 'ObjectExpression' &&
      has(node, 'path', 'element') &&
      literalValue(properties(node).get('path')) === '/remote/:taskId',
    'cloud task route',
  );
  const localElement = properties(localRoute).get('element');
  const localChildren = properties(localElement.arguments[1]).get('children');
  if (!jsx(localElement) || !jsx(localChildren))
    throw Error('Unsupported local task route wrapper');
  const remoteElement = properties(remoteRoute).get('element');
  if (!jsx(remoteElement)) throw Error('Unsupported cloud task route element');
  return {
    React: code(locationContext.callee.object),
    location: code(locationFunction.id),
    LocationContext: code(locationContext.arguments[0]),
    RouteContext: code(navigatePattern.init.arguments[0]),
    navigate: code(navigateFunction.id),
    readScope: code(routeRead.callee),
    routeScope: code(routeRead.arguments[0]),
    ScopeProvider: code(routeProvider.id),
    ComposerProvider: code(composerScope.id),
    BrowserProvider: code(localElement.arguments[0]),
    initialize: names([
      initializationFor(locationContext.callee.object.name),
      initializeFunction(routeProvider),
      initializeFunction(composerScope),
    ]),
    routeEdits: [
      {
        start: localElement.start,
        end: localElement.end,
        text: `(${code(localElement.callee)})(ModexTaskPage,{Page:${code(localChildren.arguments[0])}})`,
      },
      {
        start: remoteElement.start,
        end: remoteElement.end,
        text: `(${code(remoteElement.callee)})(ModexTaskPage,{Page:${code(remoteElement.arguments[0])}})`,
      },
    ],
  };
}

export function patchComposerRegistry(module) {
  const { within, one, code } = tools(module);
  const candidates = names(
    module
      .all(
        (node) =>
          node.type === 'CallExpression' &&
          member(node.callee, 'querySelector') &&
          literalValue(node.arguments[0]) === '[data-codex-composer]',
      )
      .map((node) => module.ancestor(node, (n) => n.type === 'FunctionDeclaration')),
  );
  const choose = unique(candidates, 'native composer selector');
  const registry = one(
    choose,
    (node) => node.type === 'CallExpression' && member(node.callee, 'keys'),
    'composer registry',
  );
  const registryName = code(registry.callee.object);
  const primary = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => n.type === 'ObjectPattern' && has(n, 'isPrimaryComposer')).length > 0 &&
        within(node, (n) => n.type === 'ForOfStatement' && code(n.right) === registryName).length >
          0,
    ),
    'primary composer selector',
  );
  const primaryLoop = one(
    primary,
    (node) => node.type === 'ForOfStatement',
    'primary composer loop',
  );
  const primaryElement = code(primaryLoop.left.declarations[0].id.elements[0]);
  const primaryCondition = one(
    primaryLoop,
    (node) => node.type === 'IfStatement',
    'primary composer eligibility',
  );
  const conditions = within(
    choose,
    (node) =>
      node.type === 'IfStatement' && within(node.test, (n) => member(n, 'isConnected')).length > 0,
  );
  const edits = conditions.map((node) => {
    const connected = one(node.test, (n) => member(n, 'isConnected'), 'composer connection check');
    return {
      start: node.test.start,
      end: node.test.end,
      text: `(${code(node.test)})&&TaskPanesRuntime.composerAvailable(${code(connected.object)})`,
    };
  });
  edits.push({
    start: primaryCondition.test.start,
    end: primaryCondition.test.end,
    text: `(${code(primaryCondition.test)})&&TaskPanesRuntime.composerAvailable(${primaryElement})`,
  });
  const query = one(
    choose,
    (node) => node.type === 'CallExpression' && member(node.callee, 'querySelector'),
    'composer fallback',
  );
  edits.push({
    start: query.start,
    end: query.end,
    text: `Array.from(document.querySelectorAll('[data-codex-composer]')).find(element=>TaskPanesRuntime.composerAvailable(element))??null`,
  });
  return edits;
}

export function discoverLocalPage(module) {
  const { within, one, functionWith, code, valueOf } = tools(module);
  const guard = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => literalValue(n) === 'unavailable').length > 0 &&
        within(node, (n) => member(n, 'archivedConversationPreview')).length > 0,
    ),
    'local archive and availability guard',
  );
  const status = one(
    guard,
    (node) =>
      node.type === 'BinaryExpression' &&
      node.operator === '===' &&
      member(node.left, 'status') &&
      literalValue(node.right) === 'unavailable',
    'local connection guard',
  );
  const connection = valueOf(status.left.object, guard);
  const atomRead = code(connection.callee);
  const previewRead = one(
    guard,
    (node) => member(node, 'archivedConversationPreview'),
    'archive preview location',
  );
  const previewCondition = module.ancestor(
    previewRead,
    (node) => node.type === 'LogicalExpression' && node.operator === '&&',
  );
  const flags = one(
    previewCondition,
    (node) =>
      node.type === 'LogicalExpression' &&
      node.operator === '||' &&
      node.left.type === 'Identifier' &&
      node.right.type === 'Identifier',
    'archive flags',
  );
  const archived = valueOf(flags.left, guard),
    globalPreview = valueOf(flags.right, guard);
  const location = within(
    previewRead,
    (node) => node.type === 'CallExpression' && node.callee.type === 'Identifier',
  );
  const reactCall = one(
    guard,
    (node) => node.type === 'CallExpression' && member(callee(node.callee), 'useState'),
    'archive guard React',
  );
  const localThread = module.one(
    (node) =>
      jsx(node) &&
      has(
        node.arguments[1],
        'shouldResume',
        'allowMissingConversation',
        'isReadOnly',
        'showComposer',
        'onOpenSubagentsPanel',
      ),
    'native local thread invocation',
  );
  const page = module.ancestor(localThread, (node) => node.type === 'FunctionDeclaration');
  const threadProps = properties(localThread.arguments[1]);
  const footerConditional = valueOf(threadProps.get('footerContent'), page);
  const footer = one(
    footerConditional,
    (node) => jsx(node) && has(node.arguments[1], 'conversationId', 'hostId'),
    'archived local footer',
  );
  const hostExpression = properties(footer.arguments[1]).get('hostId');
  const hostValue = valueOf(hostExpression, page);
  const hostRead =
    hostValue.type === 'ConditionalExpression' ? valueOf(hostValue.alternate, page) : hostValue;
  const summaries = module
    .all((node) => member(node, 'displayTitle') && node.object.type === 'Identifier')
    .map((node) => ({
      node,
      scope: module.ancestor(node, (n) => n.type === 'FunctionDeclaration'),
    }))
    .filter(({ node, scope }) => {
      try {
        const value = valueOf(node.object, scope);
        return value.type === 'CallExpression' && code(value.callee) === atomRead;
      } catch {
        return false;
      }
    });
  unique(
    names(summaries.map(({ node, scope }) => code(valueOf(node.object, scope).arguments[0]))),
    'local display title selector',
  );
  const summaryMember = summaries[0];
  const summaryRead = valueOf(summaryMember.node.object, summaryMember.scope);
  const titleFallback = module.ancestor(
    summaryMember.node,
    (node) =>
      node.type === 'LogicalExpression' &&
      node.operator === '??' &&
      node.left.type === 'CallExpression',
  );
  const titleRead = titleFallback?.left;
  if (!titleRead || code(titleRead.callee) !== atomRead)
    throw Error('Unsupported local title fallback');
  const scopeRead = one(
    guard,
    (node) =>
      node.type === 'VariableDeclarator' &&
      node.init?.type === 'CallExpression' &&
      within(
        guard,
        (n) =>
          n.type === 'MemberExpression' &&
          member(n, 'value') &&
          n.object.type === 'Identifier' &&
          n.object.name === node.id.name,
      ).length > 0,
    'local route scope',
  );
  const unavailableBranch = module.ancestor(status, (node) => node.type === 'IfStatement');
  const unavailableComponent = one(
    unavailableBranch.consequent,
    (node) => jsx(node),
    'unavailable host component',
  );
  const archivedPage = functionWith('localConversation.archived.title', 'archived task screen');
  const spinner = module.one(
    (node) =>
      jsx(node) &&
      literalValue(properties(node.arguments[1]).get('debugName')) === 'LocalConversationPage.host',
    'host mismatch guard',
  );
  const background = one(
    page,
    (node) =>
      node.type === 'CallExpression' &&
      has(node.arguments[1], 'backgroundAgent', 'hostId', 'TabComponent'),
    'interactive subagent action',
  );
  const subagents = one(
    page,
    (node) =>
      node.type === 'CallExpression' &&
      has(node.arguments[1], 'selectedConversationId', 'selectedDisplayName'),
    'subagent list action',
  );
  const pullRequest = one(
    page,
    (node) =>
      node.type === 'BinaryExpression' &&
      node.operator === 'in' &&
      literalValue(node.left) === 'request',
    'pull request action discriminator',
  );
  const pullRequestBranch = module.ancestor(pullRequest, (node) => node.type === 'IfStatement');
  const pullRequestHandler = module.ancestor(pullRequestBranch, isFunction);
  const requestCall = one(
    pullRequestBranch.consequent,
    (node) => node.type === 'CallExpression',
    'pull request request action',
  );
  const otherCall = unique(
    within(
      pullRequestHandler,
      (node) => node.type === 'CallExpression' && !inside(pullRequestBranch, node),
    ),
    'existing pull request action',
  );
  const pinProvider = module.ancestor(
    localThread,
    (node) => jsx(node) && has(node.arguments[1], 'value', 'children'),
  );
  const summaryCall = module.one(
    (node) =>
      jsx(node) &&
      has(node.arguments[1], 'isOpen', 'onOpenChange', 'trigger') &&
      within(
        properties(node.arguments[1]).get('children'),
        (n) =>
          jsx(n) &&
          has(
            n.arguments[1],
            'onOpenBackgroundAgent',
            'onOpenPullRequestSidePanel',
            'onOpenSubagentsPanel',
          ),
      ).length > 0,
    'native Environment popover',
  );
  const summaryTrigger = properties(summaryCall.arguments[1]).get('trigger');
  if (!jsx(summaryTrigger) || !member(summaryTrigger.arguments[0], 'HeaderButton'))
    throw Error('Unsupported Environment trigger');
  const summaryContent = properties(summaryCall.arguments[1]).get('children');
  return {
    React: code(callee(reactCall.callee).object),
    read: atomRead,
    hostAtom: code(hostRead.arguments[0]),
    connectionAtom: code(connection.arguments[0]),
    archivedAtom: code(archived.arguments[0]),
    titleAtom: code(titleRead.arguments[0]),
    summaryAtom: code(summaryRead.arguments[0]),
    readScope: code(scopeRead.init.callee),
    scope: code(scopeRead.init.arguments[0]),
    readGlobal: code(globalPreview.callee),
    globalPreviewAtom: code(globalPreview.arguments[0]),
    location: code(unique(location, 'local location hook').callee),
    Unavailable: code(unavailableComponent.arguments[0]),
    Archived: code(archivedPage.id),
    Loading: code(spinner.arguments[0]),
    openSubagents: code(subagents.callee),
    openBackground: code(background.callee),
    SubagentTab: code(properties(background.arguments[1]).get('TabComponent')),
    openPullRequestRequest: code(requestCall.callee),
    openPullRequest: code(otherCall.callee),
    HeaderButton: code(summaryTrigger.arguments[0]),
    Popover: code(summaryCall.arguments[0]),
    Summary: code(summaryContent.arguments[0]),
    PinProvider: code(pinProvider.arguments[0]),
    pinValue: code(properties(pinProvider.arguments[1]).get('value')),
    Thread: code(localThread.arguments[0]),
    Footer: code(footer.arguments[0]),
  };
}

export function discoverCloudPage(module) {
  const { one, within, functionWith, valueOf, code } = tools(module);
  const page = functionWith('hotkeyWindow.defaultTitle', 'cloud task page');
  const titles = within(page, (node) => member(node, 'title') && member(node.object, 'task'));
  unique(names(titles.map((node) => code(node.object.object))), 'cloud task title');
  const title = titles[0];
  const taskRead = valueOf(title.object.object, page);
  const thread = one(
    page,
    (node) => jsx(node) && has(node.arguments[1], 'hostId'),
    'cloud task transcript',
  );
  const hostRead = valueOf(properties(thread.arguments[1]).get('hostId'), page);
  const threadFunction = unique(
    module.ast.body.filter(
      (node) => node.type === 'FunctionDeclaration' && node.id.name === code(thread.arguments[0]),
    ),
    'cloud transcript function',
  );
  const reactCall = one(
    threadFunction,
    (node) => node.type === 'CallExpression' && member(callee(node.callee), 'useState'),
    'cloud React',
  );
  const archivedPage = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => member(n, 'archivedConversationPreview')).length > 0 &&
        within(
          node,
          (n) => jsx(n) && literalValue(properties(n.arguments[1]).get('kind')) === 'cloud',
        ).length > 0,
    ),
    'cloud archive preview',
  );
  const footer = one(
    archivedPage,
    (node) => jsx(node) && literalValue(properties(node.arguments[1]).get('kind')) === 'cloud',
    'cloud archive footer',
  );
  const preview = one(
    archivedPage,
    (node) => member(node, 'archivedConversationPreview'),
    'cloud archive location',
  );
  const location = one(preview, (node) => node.type === 'CallExpression', 'cloud location hook');
  const readEffect = one(
    threadFunction,
    (node) =>
      node.type === 'CallExpression' &&
      member(callee(node.callee), 'useEffect') &&
      (() => {
        try {
          return (
            within(
              valueOf(node.arguments[0], threadFunction),
              (n) =>
                n.type === 'CallExpression' &&
                n.callee.type === 'Identifier' &&
                n.arguments.length === 1,
            ).length > 0 &&
            within(valueOf(node.arguments[0], threadFunction), (n) => member(n, 'trunc')).length > 0
          );
        } catch {
          return false;
        }
      })(),
    'cloud read tracking effect',
  );
  return {
    React: code(callee(reactCall.callee).object),
    read: code(hostRead.callee),
    hostAtom: code(hostRead.arguments[0]),
    dataAtom: code(taskRead.object.arguments[0]),
    location: code(location.callee),
    Thread: code(thread.arguments[0]),
    Footer: code(footer.arguments[0]),
    edits: [
      {
        start: readEffect.start,
        end: readEffect.end,
        text: `TaskPanesRuntime.useActiveEffect(${code(callee(reactCall.callee).object)},${readEffect.arguments.map(code).join(',')})`,
      },
    ],
  };
}

export function parseTaskBundles(bundles, files) {
  return Object.fromEntries(
    Object.entries(files).map(([role, file]) => [role, parseModule(bundles[file])]),
  );
}

export function patchLocalThread(module) {
  const { within, one, functionWith, valueOf, code } = tools(module);
  const renderer = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(
          node,
          (n) =>
            n.type === 'ObjectPattern' &&
            has(
              n,
              'composerSubmitDisabled',
              'onVisibleThreadContentReady',
              'showSideChatEmptyState',
            ),
        ).length > 0,
    ),
    'local transcript renderer',
  );
  const readEffect = one(
    renderer,
    (node) =>
      node.type === 'CallExpression' &&
      member(callee(node.callee), 'useEffect') &&
      (() => {
        try {
          return (
            within(
              valueOf(node.arguments[0], renderer),
              (n) =>
                n.type === 'ReturnStatement' &&
                n.argument?.type === 'CallExpression' &&
                n.argument.callee.type === 'Identifier' &&
                n.argument.arguments.length === 2,
            ).length === 1
          );
        } catch {
          return false;
        }
      })(),
    'local read subscription',
  );
  const react = code(callee(readEffect.callee).object);
  const missing = functionWith('localConversationPage.error.toast', 'missing task navigation');
  const missingEffect = one(
    missing,
    (node) =>
      node.type === 'CallExpression' &&
      member(callee(node.callee), 'useEffect') &&
      (() => {
        try {
          return (
            within(
              valueOf(node.arguments[0], missing),
              (n) => literalValue(n) === 'localConversationPage.error.toast',
            ).length === 1
          );
        } catch {
          return false;
        }
      })(),
    'missing task effect',
  );
  const edits = [readEffect, missingEffect].map((effect) => ({
    start: effect.start,
    end: effect.end,
    text: `TaskPanesRuntime.useActiveEffect(${react},${effect.arguments.map(code).join(',')})`,
  }));
  function paneDependent(fn, expression) {
    // The stock React compiler caches these elements. Changing the condition
    // alone would leave the cached header/overflow unchanged on pane switches.
    const cache = one(
      fn,
      (node) => node.type === 'CallExpression' && member(callee(node.callee), 'c'),
      'native transcript memo cache',
    );
    const size = literalValue(cache.arguments[0]);
    if (!Number.isInteger(size)) throw Error('Unsupported native transcript memo cache size');
    const declaration = module.ancestor(cache, (node) => node.type === 'VariableDeclarator');
    const cacheName = code(declaration.id);
    const conditional = module.ancestor(
      expression,
      (node) =>
        node.type === 'ConditionalExpression' &&
        node.consequent.type === 'SequenceExpression' &&
        inside(node.consequent, expression),
    );
    if (!conditional) throw Error('Unsupported native transcript memoization');
    edits.push(
      {
        start: fn.body.start + 1,
        end: fn.body.start + 1,
        text: `const modexPane=TaskPanesRuntime.usePane(${react});`,
      },
      { start: cache.arguments[0].start, end: cache.arguments[0].end, text: String(size + 1) },
      {
        start: conditional.test.start,
        end: conditional.test.end,
        text: `(${code(conditional.test)})||${cacheName}[${size}]!==!!modexPane`,
      },
      {
        start: conditional.consequent.start,
        end: conditional.consequent.start,
        text: `(${cacheName}[${size}]=!!modexPane,`,
      },
      { start: conditional.consequent.end, end: conditional.consequent.end, text: ')' },
    );
  }
  const header = one(
    renderer,
    (node) => jsx(node) && has(node.arguments[1], 'canPin'),
    'window task header registration',
  );
  const headerCondition = module.ancestor(header, (node) => node.type === 'ConditionalExpression');
  paneDependent(renderer, headerCondition);
  edits.push({
    start: headerCondition.test.start,
    end: headerCondition.test.end,
    text: `(${code(headerCondition.test)})&&!modexPane`,
  });
  const wrapper = module.one(
    (node) =>
      jsx(node) &&
      String(literalValue(properties(node.arguments[1]).get('className')))
        .split(' ')
        .includes('group/realtime-voice-thread'),
    'native transcript voice wrapper',
  );
  const className = literalValue(properties(wrapper.arguments[1]).get('className'));
  if (!className.split(' ').includes('overflow-clip')) {
    if (
      !className.split(' ').includes('overflow-hidden') ||
      properties(wrapper.arguments[1]).has('style')
    )
      throw Error('Unsupported native transcript overflow contract');
    const fn = module.ancestor(wrapper, (node) => node.type === 'FunctionDeclaration');
    paneDependent(fn, wrapper);
    edits.push({
      start: wrapper.arguments[1].start + 1,
      end: wrapper.arguments[1].start + 1,
      text: 'style:modexPane?{overflow:"clip"}:undefined,',
    });
  }
  return edits;
}

export function discoverRouting(module, sourceModules) {
  const { within, one, code } = tools(module);
  const sidebarKey = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => n.type === 'SwitchCase' && literalValue(n.test) === 'local').length ===
          1 &&
        within(node, (n) => n.type === 'SwitchCase' && literalValue(n.test) === 'remote').length ===
          1 &&
        within(node, (n) => n.type === 'ReturnStatement' && member(n.argument, 'key')).length ===
          1 &&
        within(node, (n) => n.type === 'CallExpression' && member(n.callee, 'startsWith'))
          .length === 1,
    ),
    'sidebar task key decoder',
  );
  const decoderCall = one(
    sidebarKey,
    (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name !== 'String',
    'task key decoder',
  );
  const pathRole = (owner) => {
    const { within, code } = tools(owner);
    const prefixValue = unique(
      owner
        .all((node) => literalValue(node) === '/local')
        .filter((node) => {
          const parent = owner.parents.get(node);
          return (
            (parent.type === 'AssignmentExpression' && parent.left.type === 'Identifier') ||
            (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
          );
        }),
      'local task path prefix',
    );
    const prefixOwner = owner.parents.get(prefixValue),
      prefix = code(prefixOwner.id ?? prefixOwner.left);
    return unique(
      owner.ast.body.filter(
        (node) =>
          node.type === 'FunctionDeclaration' &&
          node.params.length === 1 &&
          node.body.body.length === 1 &&
          node.body.body[0].type === 'ReturnStatement' &&
          within(
            node,
            (n) =>
              n.type === 'TemplateLiteral' &&
              n.expressions.length === 2 &&
              code(n.expressions[0]) === prefix &&
              code(n.expressions[1]) === code(node.params[0]) &&
              n.quasis[1].value.cooked === '/',
          ).length === 1,
      ),
      'local task path builder',
    ).id.name;
  };
  let localPath;
  if (
    module
      .all((node) => literalValue(node) === '/local')
      .some((node) =>
        ['AssignmentExpression', 'VariableDeclarator'].includes(module.parents.get(node)?.type),
      )
  )
    localPath = pathRole(module);
  else {
    const lazyPage = module.one(
      (node) =>
        node.type === 'ImportExpression' &&
        /\/local-conversation-page-[^/]+\.js$/.test(literalValue(node.source)),
      'local task page import',
    );
    const pageBinding = module.ancestor(
      lazyPage,
      (node) => node.type === 'AssignmentExpression' && node.left.type === 'Identifier',
    ).left;
    const pageElement = module.one(
      (node) => jsx(node) && code(node.arguments[0]) === code(pageBinding),
      'local task page element',
    );
    const route = module.ancestor(
      pageElement,
      (node) => node.type === 'ObjectExpression' && has(node, 'path', 'element'),
    );
    const pathName = code(properties(route).get('path'));
    const imported = module.one(
      (node) => node.type === 'ImportSpecifier' && node.local.name === pathName,
      'local route path import',
    );
    const declaration = module.ancestor(imported, (node) => node.type === 'ImportDeclaration');
    const source = literalValue(declaration.source).replace(/^\.\//, '');
    if (!sourceModules)
      throw Error('Task Panes needs sourceModules to inspect the native route dependency');
    const dependency = parseModule(sourceModules.read(source));
    const nativeName = pathRole(dependency);
    const exported = unique(
      dependency.ast.body
        .filter((node) => node.type === 'ExportNamedDeclaration')
        .flatMap((node) => node.specifiers)
        .filter((node) => node.local.name === nativeName),
      'native local path export',
    );
    const pathImport = unique(
      declaration.specifiers.filter(
        (node) => propertyName(node.imported) === propertyName(exported.exported),
      ),
      'native local path import',
    );
    localPath = pathImport.local.name;
  }
  const hostPath = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(
          node,
          (n) =>
            n.type === 'NewExpression' &&
            n.callee.type === 'Identifier' &&
            n.callee.name === 'URLSearchParams' &&
            has(n.arguments[0], 'hostId'),
        ).length === 1 &&
        within(
          node,
          (n) =>
            n.type === 'TemplateLiteral' &&
            n.expressions.length === 2 &&
            n.quasis[1].value.cooked === '?',
        ).length === 1,
    ),
    'host task path builder',
  );
  return {
    sidebarKey: code(sidebarKey.id),
    threadKey: code(decoderCall.callee),
    localPath,
    hostPath: code(hostPath.id),
  };
}

export function patchTaskDrag(module) {
  const { within, one, code, valueOf } = tools(module);
  const tall = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => n.type === 'ObjectPattern' && has(n, 'key', 'row')).length === 1 &&
        within(
          node,
          (n) => jsx(n) && literalValue(properties(n.arguments[1]).get('role')) === 'listitem',
        ).length === 1 &&
        within(node, (n) => n.type === 'CallExpression').length === 1,
    ),
    'tall sidebar task row',
  );
  const rowPattern = one(
    tall,
    (node) => node.type === 'ObjectPattern' && has(node, 'key', 'row'),
    'tall row fields',
  );
  const rowKey = code(properties(rowPattern).get('key')),
    row = code(properties(rowPattern).get('row'));
  const rowJsx = one(tall, (node) => jsx(node), 'tall row element');
  const draggable = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(
          node,
          (n) =>
            jsx(n) &&
            has(
              n.arguments[1],
              'threadKey',
              'containerId',
              'sourceProjectKind',
              'threadDragState',
              'children',
            ),
        ).length === 1 &&
        within(node, (n) => n.type === 'ObjectPattern' && has(n, 'threadKey', 'children'))
          .length === 1,
    ),
    'native nonsortable task wrapper',
  );
  const referenceLookup = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(
          node,
          (n) =>
            n.type === 'CallExpression' &&
            member(n.callee, 'elementsFromPoint') &&
            n.callee.object.type === 'Identifier' &&
            n.callee.object.name === 'document',
        ).length === 1 &&
        within(node, (n) => n.type === 'CallExpression' && member(n.callee, 'closest')).length ===
          1,
    ),
    'task reference drop lookup',
  );
  const provider = unique(
    module.ast.body.filter(
      (node) =>
        node.type === 'FunctionDeclaration' &&
        within(node, (n) => member(n, 'pointerCoordinates')).length > 0 &&
        within(
          node,
          (n) =>
            n.type === 'CallExpression' &&
            n.callee.type === 'Identifier' &&
            n.callee.name === referenceLookup.id.name,
        ).length > 0 &&
        within(
          node,
          (n) =>
            n.type === 'ObjectExpression' && has(n, 'onDragStart', 'onDragEnd', 'onDragCancel'),
        ).length === 1,
    ),
    'sidebar drag provider',
  );
  const providerProps = properties(
    one(
      provider,
      (node) =>
        node.type === 'ObjectExpression' && has(node, 'onDragStart', 'onDragEnd', 'onDragCancel'),
      'native drag callbacks',
    ),
  );
  const callback = (prop) => {
    let node = providerProps.get(prop);
    const seen = new Set();
    while (node?.type === 'Identifier') {
      if (seen.has(node.name)) throw Error('Cyclic drag callback');
      seen.add(node.name);
      node = valueOf(node, provider);
    }
    if (!isFunction(node) || node.body.type !== 'BlockStatement')
      throw Error(`Unsupported ${prop} callback`);
    return node;
  };
  const start = callback('onDragStart'),
    end = callback('onDragEnd'),
    cancel = callback('onDragCancel');
  const selected = one(
    start,
    (node) =>
      node.type === 'AssignmentExpression' &&
      member(node.left, 'current') &&
      node.right.type === 'LogicalExpression' &&
      node.right.operator === '??' &&
      node.right.right.type === 'ArrayExpression' &&
      node.right.right.elements.length === 1,
    'selected native task payloads',
  );
  const payloads = code(selected.left);
  const pointAssignments = within(
    provider,
    (node) =>
      node.type === 'AssignmentExpression' &&
      member(node.left, 'current') &&
      within(node.right, (n) => member(n, 'pointerCoordinates')).length === 1,
  );
  const pointAxis = (axis) =>
    unique(
      names(
        pointAssignments
          .filter((node) => within(node.right, (n) => member(n, axis)).length === 1)
          .map((node) => code(node.left)),
      ),
      `native drag ${axis} position`,
    );
  const x = pointAxis('x'),
    y = pointAxis('y');
  const collision = unique(
    within(
      provider,
      (node) =>
        isFunction(node) &&
        node.body.type === 'BlockStatement' &&
        within(
          node,
          (node) =>
            node.type === 'AssignmentExpression' &&
            code(node.left) === x &&
            within(node.right, (n) => member(n, 'pointerCoordinates')).length === 1,
        ).length === 1,
    ).filter((node) => node !== provider),
    'native pointer collision callback',
  );
  const event = code(collision.params[0]);
  const lastPoint = unique(
    pointAssignments.filter((node) => inside(collision, node) && code(node.left) === y),
    'native pointer update',
  );
  const cancelExpression = code(providerProps.get('onDragCancel'));
  const entries = `${payloads}.flatMap(state=>{const decoded=ModexPaneRouting.threadKey(state.threadKey),ref=state.threadReference;if(decoded?.kind==='remote'){const id=decoded.taskId;return[{kind:'cloud',routeKind:'remote-thread',taskId:id,key:'cloud:'+id,path:'/remote/'+id,title:id}]}if(decoded?.kind!=='local'||state.threadId==null||ref==null)return[];const id=state.threadId,hostId=ref.hostId??'local',path=ModexPaneRouting.localPath(id);return[{kind:'local',routeKind:'local-thread',conversationId:id,hostId,key:'local:'+hostId+':'+id,path:hostId==='local'?path:ModexPaneRouting.hostPath(path,hostId),title:ref.getTitle()}]})`;
  return [
    {
      start: rowJsx.start,
      end: rowJsx.end,
      text: `(ModexPaneRouting.sidebarKey(${rowKey})==null?${code(rowJsx)}:(${code(rowJsx.callee)})(${code(draggable.id)},{threadKey:ModexPaneRouting.sidebarKey(${rowKey}),children:${row}},${rowKey}))`,
    },
    {
      start: referenceLookup.body.start + 1,
      end: referenceLookup.body.start + 1,
      text: `if(TaskPanesDrag.claims({x:${code(referenceLookup.params[0])},y:${code(referenceLookup.params[1])}}))return null;`,
    },
    {
      start: selected.start,
      end: selected.end,
      text: `(${code(selected)},TaskPanesDrag.start(${entries}))`,
    },
    {
      start: lastPoint.start,
      end: lastPoint.end,
      text: `(${code(lastPoint)},TaskPanesDrag.move(${event}.pointerCoordinates))`,
    },
    {
      start: end.body.start + 1,
      end: end.body.start + 1,
      text: `if(${code(referenceLookup.id)}(${x},${y})==null&&TaskPanesDrag.drop()){${cancelExpression}(${code(end.params[0])});return}TaskPanesDrag.cancel();`,
    },
    { start: cancel.body.start + 1, end: cancel.body.start + 1, text: 'TaskPanesDrag.cancel();' },
  ];
}

export function discoverPortalFactory(module) {
  const { one, code } = tools(module);
  const portal = module.one(
    (node) => node.type === 'CallExpression' && member(node.callee, 'createPortal'),
    'native React portal',
  );
  const namespace = code(portal.callee.object);
  const assignment = module.one(
    (node) =>
      node.type === 'AssignmentExpression' &&
      node.left.type === 'Identifier' &&
      node.left.name === namespace,
    'ReactDOM namespace initialization',
  );
  const factory = one(
    assignment.right,
    (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.arguments.length === 0,
    'ReactDOM factory',
  );
  return code(factory.callee);
}

export function importedRole(module, expression, owner) {
  const name = expression.split('.')[0];
  const specifier = module.one(
    (node) => node.type === 'ImportSpecifier' && node.local.name === name,
    'imported native role',
  );
  const exported = unique(
    owner.ast.body
      .filter((node) => node.type === 'ExportNamedDeclaration')
      .flatMap((node) => node.specifiers)
      .filter((node) => propertyName(node.exported) === propertyName(specifier.imported)),
    'native role export',
  );
  return exported.local.name;
}
