const renderers = new WeakMap();
const defaultLoaders = {
  local: () => import('./local-conversation-page-fc339fa9c34d.js').then(module => ({default: module.ModexLocalPaneTask})),
  cloud: () => import('./remote-conversation-page-4a5925193bd5.js').then(module => ({default: module.ModexCloudPaneTask})),
};
export function getRenderer(React, loaders = defaultLoaders) {
  let byLoader = renderers.get(React.createContext);
  if (!byLoader) renderers.set(React.createContext, byLoader = new WeakMap());
  if (byLoader.has(loaders)) return byLoader.get(loaders);
  const components = Object.fromEntries(Object.entries(loaders).map(([kind, load]) => [kind, React.lazy(load)]));
  function Task({task}) {
    const Component = components[task.kind ?? 'local'];
    return React.createElement(React.Suspense, {fallback: React.createElement('div', {role:'status', style:{padding:16}}, 'Loading task…')},
      Component ? React.createElement(Component, {task}) : React.createElement('div', {role:'alert'}, 'This task type cannot be opened in a pane.'));
  }
  byLoader.set(loaders, Task);
  return Task;
}
