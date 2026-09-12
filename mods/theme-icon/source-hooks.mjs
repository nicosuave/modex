import {
  parseModule,
  literalValue as literal,
  unique as one,
  editSource,
} from '../../lib/source-contract.mjs';

const id = String.raw`[$A-Z_a-z][$\w]*`;
const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const property = (node, name) =>
  node?.type === 'MemberExpression' && !node.computed && node.property.name === name;
function capture(source, pattern, label) {
  return one([...source.matchAll(new RegExp(pattern, 'g'))], label);
}
function inspect(source) {
  const module = parseModule(source);
  const owner = (position) => {
    const candidates = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']
      .flatMap((type) => module.ofType(type))
      .filter((node) => node.start <= position && node.end > position);
    return candidates.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  };
  return { ...module, owner };
}
function replaceRanges(source, edits) {
  return editSource(
    source,
    edits.map(({ start, end, value }) => ({ start, end, text: value })),
  );
}

export function patchThemeProvider(source) {
  if (source.includes('ThemeIconRuntime.useTheme'))
    throw Error('Theme Icon provider already patched');
  const ast = inspect(source);
  const selection = capture(
    source,
    String.raw`(?<![$\w])(?<theme>${id})=(?<appearance>${id})===\x60light\x60\?(?<light>${id}):(?<dark>${id}),(?<next>${id})=\k<theme>\.fonts\.codeFace`,
    'resolved root appearance selection',
  );
  const provider = ast.owner(selection.index);
  const body = ast.text(provider);
  const React = capture(
    body,
    String.raw`\(0,(?<React>${id})\.useState\)`,
    'provider React namespace',
  ).groups.React;
  const settings = capture(
    body,
    String.raw`(?<read>${id})\((?<settings>${id})\.lightChromeTheme\)`,
    'native chrome theme getter',
  ).groups;
  // The persistence subscription owns its fallback/callback record and cleanup.
  const listen = one(
    ast
      .ofType('FunctionDeclaration')
      .filter(
        (node) =>
          node.params.length === 3 &&
          ast
            .text(node)
            .includes(`callback:${node.params[2].name},fallback:${node.params[1].name}`) &&
          ast.text(node).includes('.delete(') &&
          ast.text(node).includes('new Set'),
      ),
    'persisted atom subscription',
  );
  const initialize = one(
    listen.body.body.filter(
      (node) => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression',
    ),
    'persistence initialization',
  ).expression.callee.name;
  const read = one(
    ast
      .ofType('FunctionDeclaration')
      .filter(
        (node) =>
          node.params.length === 2 &&
          new RegExp(
            String.raw`${escapePattern(initialize)}\(\),${id}\.has\(${escapePattern(node.params[0].name ?? '')}\)\?${id}\.get\(${escapePattern(node.params[0].name ?? '')}\):${escapePattern(node.params[1].name ?? '')}`,
          ).test(ast.text(node)),
      ),
    'persisted atom read',
  );
  const write = one(
    ast
      .ofType('FunctionDeclaration')
      .filter(
        (node) =>
          node.params.length === 2 &&
          node.body.body.length === 1 &&
          node.body.body[0].type === 'ExpressionStatement' &&
          node.body.body[0].expression.type === 'SequenceExpression' &&
          ast.text(node.body.body[0].expression.expressions[0]) === `${initialize}()` &&
          ast.text(node).endsWith(`(${node.params[0].name},${node.params[1].name},!0)}`),
      ),
    'persisted atom write',
  );
  const bridge = [
    ...new Set(
      [
        ...source.matchAll(
          new RegExp(
            String.raw`(?<![$\w])(${id})\.dispatchMessage\(\x60persisted-atom-update\x60`,
            'g',
          ),
        ),
      ].map((match) => match[1]),
    ),
  ];
  const { theme, appearance, next } = selection.groups;
  const original = selection[0];
  const value =
    original.slice(0, original.lastIndexOf(`,${next}=`)) +
    `;ThemeIconRuntime.useTheme(${React},{theme:${theme},appearance:${appearance},id:${settings.read}(${appearance}===\`light\`?${settings.settings}.lightCodeThemeId:${settings.settings}.darkCodeThemeId),read:${read.id.name},write:${write.id.name},listen:${listen.id.name},bridge:${one(bridge, 'persisted atom bridge')}});let ${next}=${theme}.fonts.codeFace`;
  return (
    'import * as ThemeIconRuntime from "./theme-icon-runtime.mjs";' +
    replaceRanges(source, [
      { start: selection.index, end: selection.index + original.length, value },
    ])
  );
}

export function settingsBindings(source) {
  const ast = inspect(source);
  const label = one(
    ast.nodes.filter(
      (node) => literal(node) === 'settings.general.appearance.dockIcon.row.description',
    ),
    'Dock row description',
  );
  const row = ast.owner(label.start);
  const rowNodes = ast.nodes.filter((node) => node.start >= row.start && node.end <= row.end);
  const calls = rowNodes.filter((node) => node.type === 'CallExpression');
  const preferenceRead = one(
    calls.filter(
      (node) => node.arguments.length === 1 && property(node.arguments[0], 'dockIconPreference'),
    ),
    'Dock preference read',
  );
  const preferenceWrite = one(
    calls.filter(
      (node) => node.arguments.length === 3 && property(node.arguments[1], 'dockIconPreference'),
    ),
    'Dock preference write',
  );
  const preferenceVariable = one(
    rowNodes.filter((node) => node.type === 'VariableDeclarator' && node.init === preferenceRead),
    'Dock preference value',
  ).id.name;
  const previewsCall = one(
    calls.filter(
      (node) =>
        node.arguments[0]?.type === 'ObjectExpression' &&
        node.arguments[0].properties.some((p) => p.key.name === 'dockIconPreviews'),
    ),
    'native Dock preview validation',
  );
  const previewsVariable = one(
    rowNodes.filter(
      (node) =>
        node.type === 'VariableDeclarator' &&
        node.init?.type === 'Identifier' &&
        rowNodes.some(
          (candidate) =>
            candidate.type === 'AssignmentExpression' &&
            candidate.left.name === node.init.name &&
            candidate.right === previewsCall,
        ),
    ),
    'resolved Dock previews',
  ).id.name;
  const jsxRow = one(
    calls.filter(
      (node) =>
        node.arguments[1]?.type === 'ObjectExpression' &&
        ['label', 'description', 'control'].every((name) =>
          node.arguments[1].properties.some((p) => p.key.name === name),
        ),
    ),
    'native Dock settings row',
  );
  const jsx = jsxRow.callee.expressions.at(-1).object.name;
  const returned = one(
    rowNodes.filter(
      (node) => node.type === 'ReturnStatement' && node.argument?.type === 'SequenceExpression',
    ),
    'Dock row return',
  );
  const result = returned.argument.expressions.at(-1);
  const accent = capture(
    source,
    String.raw`(?<![$\w])${id}\.accentSource===\x60chatgpt\x60`,
    'native accent menu',
  );
  const accentOwner = ast.owner(accent.index);
  const accentBody = ast.text(accentOwner);
  const DropdownButton = capture(
    accentBody,
    String.raw`\.jsx\)\((?<component>${id}),\{"aria-label":`,
    'native accent dropdown button',
  ).groups.component;
  const Dropdown = capture(
    accentBody,
    String.raw`\.jsx\)\((?<component>${id}),\{align:\x60end\x60,contentWidth:\x60menu\x60,triggerButton:`,
    'native accent dropdown',
  ).groups.component;
  const menu = capture(
    accentBody,
    String.raw`\.jsx\)\((?<menu>${id})\.Item,\{disabled:[^,]+,RightIcon:${id}===${id}\?(?<check>${id}):void 0`,
    'native accent menu check',
  ).groups;
  const reactNamespaces = new Set(
    ast.nodes.filter((node) => property(node, 'useState')).map((node) => node.object.name),
  );
  const reactLoaders = new Set(
    ast
      .ofType('AssignmentExpression')
      .filter(
        (node) =>
          reactNamespaces.has(node.left.name) &&
          node.right.type === 'CallExpression' &&
          node.right.arguments.length === 2 &&
          literal(node.right.arguments[1]) === 1 &&
          node.right.arguments[0].type === 'CallExpression' &&
          node.right.arguments[0].arguments.length === 0,
      )
      .map((node) => node.right.arguments[0].callee.name),
  );
  const loaderName = one([...reactLoaders], 'native React namespace initialization');
  const reactImport = one(
    ast
      .ofType('ImportDeclaration')
      .filter((node) => node.specifiers.some((specifier) => specifier.local.name === loaderName)),
    'native React module',
  );
  const reactLoader = one(
    reactImport.specifiers.filter((node) => node.local.name === loaderName),
    'native React loader',
  );
  return {
    ast,
    row,
    rowNodes,
    calls,
    result,
    jsx,
    Row: ast.text(jsxRow.arguments[0]),
    ReactExport: reactLoader.imported.name,
    ReactSource: reactImport.source.value,
    DropdownButton,
    Dropdown,
    Menu: menu.menu,
    CheckIcon: menu.check,
    previews: previewsVariable,
    preferenceRead,
    preferenceWrite,
    preferenceVariable,
  };
}

export function patchThemeSettings(source) {
  if (source.includes('ThemeIconSettings')) throw Error('Theme Icon settings already patched');
  const b = settingsBindings(source);
  const [store, preference] = b.preferenceWrite.arguments.map(b.ast.text);
  const options = `React:ThemeIconReact(),Row:${b.Row},Dropdown:${b.Dropdown},DropdownButton:${b.DropdownButton},Menu:${b.Menu},CheckIcon:${b.CheckIcon},previews:${b.previews},enabled:${b.preferenceVariable}===\`codex-system\`,onEnable:()=>${b.ast.text(b.preferenceWrite.callee)}(${store},${preference},\`codex-system\`)`;
  // A dedicated import avoids a native module alias being shadowed by row locals.
  return (
    `import {${b.ReactExport} as ThemeIconReact} from ${JSON.stringify(b.ReactSource)};import {Settings as ThemeIconSettings} from "./theme-icon-runtime.mjs";` +
    replaceRanges(source, [
      {
        start: b.result.start,
        end: b.result.end,
        value: `(0,${b.jsx}.jsxs)(${b.jsx}.Fragment,{children:[${b.ast.text(b.result)},(0,${b.jsx}.jsx)(ThemeIconSettings,{${options}})]})`,
      },
    ])
  );
}

export function mainBindings(source) {
  const ast = inspect(source);
  const setters = ast
    .ofType('CallExpression')
    .filter((node) => property(node.callee, 'setIcon') && property(node.callee.object, 'dock'));
  const dock = one(
    [...new Set(setters.map((node) => ast.owner(node.start)))],
    'native Dock icon setter',
  );
  const electron = one(
    [...new Set(setters.map((node) => ast.text(node.callee.object.object.object)))],
    'Dock Electron namespace',
  );
  const dockVariable = one(
    ast.ofType('VariableDeclarator').filter((node) => node.init === dock),
    'Dock setter binding',
  ).id.name;
  const refreshMatch = capture(
    source,
    String.raw`(?<declaration>let (?<value>${id})=(?<read>${id})\(\);)\k<value>===\x60codex-system\x60&&${escapePattern(dockVariable)}\(\k<value>\)`,
    'system appearance Dock refresh',
  );
  const refresh = refreshMatch.groups;
  const refreshPosition = refreshMatch.index;
  const guard = one(
    ast
      .ofType('IfStatement')
      .filter(
        (node) =>
          node.start > dock.end && node.start < refreshPosition && node.end > refreshPosition,
      ),
    'Dock lifecycle initialization',
  );
  const sync = one(
    ast.ofType('SwitchCase').filter((node) => literal(node.test) === 'persisted-atom-sync-request'),
    'primary persisted atom handler',
  );
  const syncCall = sync.consequent[0].expression;
  if (
    !property(syncCall?.callee, 'sendPersistedAtomState') ||
    !property(syncCall.arguments[1], 'responsePriority')
  )
    throw Error('Theme Icon: unknown persistence handler');
  return {
    ast,
    dock,
    electron,
    dockVariable,
    preferenceRead: refresh.read,
    guard,
    sync,
    origin: ast.text(syncCall.arguments[0]),
    message: ast.text(syncCall.arguments[1].object),
  };
}

export function patchThemeMain(source) {
  if (source.includes('ThemeIconMain')) throw Error('Theme Icon main already patched');
  const b = mainBindings(source);
  const origin = b.origin,
    electron = b.electron;
  return (
    'const ThemeIconMain=require("./theme-icon-main.cjs");' +
    replaceRanges(source, [
      {
        start: b.dock.body.start + 1,
        end: b.dock.body.start + 1,
        value: `if(ThemeIconMain.apply(${b.dock.params[0].name}))return;`,
      },
      {
        start: b.guard.start,
        end: b.guard.start,
        value: `ThemeIconMain.configure(${electron},process.resourcesPath,()=>${b.dockVariable}(${b.preferenceRead}()));`,
      },
      {
        start: b.sync.start,
        end: b.sync.start,
        value: `case\`modex-theme-icon\`:if(this.getBrowserOwnerWebContentsForOrigin(${origin})===${origin}&&(${electron}.BrowserWindow.getFocusedWindow()==null||${electron}.BrowserWindow.getFocusedWindow()?.webContents===${origin}))ThemeIconMain.update(${b.message});break;`,
      },
    ])
  );
}
