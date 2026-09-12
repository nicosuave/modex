import fs from 'node:fs';
import path from 'node:path';
import { editSource } from '../../lib/source-contract.mjs';
import { providerAdapter, localAdapter, cloudAdapter } from './adapters.mjs';
import { discoverInitializer, discoverNativeUi } from './native-ui-contract.mjs';
import {
  discoverProviders,
  discoverLocalPage,
  discoverCloudPage,
  discoverRouting,
  discoverPortalFactory,
  importedRole,
  parseTaskBundles,
  patchComposerRegistry,
  patchLocalThread,
  patchTaskDrag,
} from './source-hooks.mjs';

export { providerAdapter, localAdapter, cloudAdapter } from './adapters.mjs';
export const files = {
  initial: 'webview/assets/app-initial-a9514281e192.js',
  primary: 'webview/assets/app-primary-defe25a79fce.js',
  localPage: 'webview/assets/local-conversation-page-4f23a630b0af.js',
  localThread: 'webview/assets/local-conversation-thread-9210b06f69b1.js',
  cloudPage: 'webview/assets/remote-conversation-page-f76463019395.js',
};

function nativeRoles(name, roles) {
  return `const ${name}={${Object.entries(roles)
    .map(([key, value]) => `get ${key}(){return ${value}}`)
    .join(',')}};`;
}

export function transform(bundles, { sourceModules } = {}) {
  if (Object.values(files).some((file) => typeof bundles[file] !== 'string'))
    throw Error('Missing Task Panes source contracts');
  const modules = parseTaskBundles(bundles, files);
  const providers = discoverProviders(modules.initial),
    ui = discoverNativeUi(modules.initial);
  const local = discoverLocalPage(modules.localPage),
    cloud = discoverCloudPage(modules.cloudPage);
  const routing = discoverRouting(modules.initial, sourceModules);
  const headerBinding = importedRole(modules.localPage, local.HeaderButton, modules.primary);
  const summaryInit = discoverInitializer(modules.primary, headerBinding);
  const { initialize: providerInit, routeEdits, ...providerRoles } = providers;
  const { initialize: uiInit, ...uiRoles } = ui;
  const { edits: cloudEdits, ...cloudRoles } = cloud;
  const initializers = [...new Set([...providerInit, ...uiInit])];
  const roleObject = nativeRoles('ModexPaneNative', {
    ...providerRoles,
    ...uiRoles,
    initialize: `()=>{${initializers.map((name) => `${name}();`).join('')}}`,
  });
  const runtimeImport = 'import * as TaskPanesRuntime from "./task-panes-runtime.mjs";';
  const output = { ...bundles };
  output[files.initial] =
    runtimeImport +
    'import * as TaskPanesRenderer from "./task-panes-renderer.mjs";' +
    editSource(bundles[files.initial], [...routeEdits, ...patchComposerRegistry(modules.initial)]) +
    '\n' +
    roleObject +
    providerAdapter +
    `export const ModexPaneRouting={${Object.entries(routing)
      .map(([key, value]) => `${key}:${value}`)
      .join(',')}};export {${discoverPortalFactory(modules.initial)} as ModexReactDOM};`;
  output[files.primary] =
    'import {drag as TaskPanesDrag} from "./task-panes-drag.mjs";import {ModexPaneRouting} from "./app-initial-a9514281e192.js";' +
    editSource(bundles[files.primary], patchTaskDrag(modules.primary)) +
    `\nexport {${summaryInit} as ModexInitializeSummary};`;
  output[files.localPage] =
    runtimeImport +
    'import {ModexPaneProviders,ModexReactDOM as modexReactDOM} from "./app-initial-a9514281e192.js";import {ModexInitializeSummary} from "./app-primary-defe25a79fce.js";' +
    bundles[files.localPage] +
    '\n' +
    nativeRoles('ModexLocalNative', local) +
    localAdapter;
  output[files.localThread] =
    runtimeImport + editSource(bundles[files.localThread], patchLocalThread(modules.localThread));
  output[files.cloudPage] =
    runtimeImport +
    'import {ModexPaneProviders} from "./app-initial-a9514281e192.js";' +
    editSource(bundles[files.cloudPage], cloudEdits) +
    '\n' +
    nativeRoles('ModexCloudNative', cloudRoles) +
    cloudAdapter;
  for (const file of ['runtime', 'layout', 'drag', 'renderer']) {
    let content = fs.readFileSync(path.join(import.meta.dirname, `${file}.mjs`), 'utf8');
    for (const dependency of ['runtime', 'layout', 'drag', 'renderer'])
      content = content.replaceAll(`'./${dependency}.mjs'`, `'./task-panes-${dependency}.mjs'`);
    output[`webview/assets/task-panes-${file}.mjs`] = content;
  }
  return output;
}
