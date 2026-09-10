import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { providerAdapter, localAdapter, cloudAdapter, transform, files } from './build-mod.mjs';
import { getPaneContext, usePane } from './runtime.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const passthrough = ({ children }) => children;

test.skipIf(!process.env.CHROMIUM_PATH)(
  'browser clipping blocks hidden-summary focus shifts while the transcript still scrolls',
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-pane-clip-'));
    try {
      const fixture = path.join(directory, 'fixture.html');
      fs.writeFileSync(
        fixture,
        `<!doctype html><body><script>
      function measure(overflow){
        const outer=document.createElement('div');
        outer.style.cssText='position:relative;width:600px;height:200px;overflow:'+overflow;
        const transcript=document.createElement('div');
        transcript.style.cssText='height:200px;overflow:auto';
        transcript.innerHTML='<div style="height:800px">Transcript</div>';
        const summary=document.createElement('div');
        summary.style.cssText='position:absolute;left:100%;top:0;width:300px;opacity:0;transform:translateX(100%) scale(.8)';
        const button=document.createElement('button');button.textContent='Sources';summary.append(button);
        outer.append(transcript,summary);document.body.append(outer);
        button.focus();button.scrollIntoView({block:'nearest',inline:'nearest'});
        transcript.scrollTop=150;
        const result={outer:outer.scrollLeft,inner:transcript.scrollTop};outer.remove();return result;
      }
      const result={hidden:measure('hidden'),clip:measure('clip')};
      document.body.textContent=JSON.stringify(result);
    </script>`,
      );
      const result = spawnSync(
        process.env.CHROMIUM_PATH,
        [
          '--headless=new',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-gpu',
          '--disable-background-networking',
          `--user-data-dir=${path.join(directory, 'profile')}`,
          '--timeout=10000',
          '--dump-dom',
          `file://${fixture}`,
        ],
        { encoding: 'utf8', timeout: 30000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const observed = JSON.parse(result.stdout.match(/<body>(.*?)<\/body>/s)[1]);
      expect(observed.hidden.outer).toBeGreaterThan(0);
      expect(observed.clip.outer).toBe(0);
      expect(observed.clip.inner).toBe(150);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  35000,
);

test.skipIf(!process.env.TASK_PANES_BUNDLES)(
  'native outer clipping changes only in panes and preserves mounted transcript across context changes',
  async () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('./compatibility.json', import.meta.url)));
    const output = transform(
      Object.fromEntries(
        Object.keys(manifest.files).map((name) => [
          name,
          fs.readFileSync(path.join(process.env.TASK_PANES_BUNDLES, name), 'utf8'),
        ]),
      ),
    );
    const source = output[files.localThread],
      start = source.indexOf('function X_('),
      end = source.indexOf('var Z_,Q_,$_', start);
    const bindings = {
      YO: React,
      TaskPanesRuntime: { usePane },
      Z_: {
        c: (size) =>
          React.useRef(Array(size).fill(Symbol.for('react.memo_cache_sentinel'))).current,
      },
      Q_: { jsx: (type, props) => h(type, props), jsxs: (type, props) => h(type, props) },
      F_: passthrough,
      U_: () => null,
      ol: passthrough,
    };
    const Adapter = new Function(
      ...Object.keys(bindings),
      source.slice(start, end) + ';return X_;',
    )(...Object.values(bindings));
    let mounts = 0;
    function Transcript() {
      React.useEffect(() => {
        mounts++;
      }, []);
      return h('article', null, 'Transcript');
    }
    const content = h(Transcript),
      props = {
        codexPerspective: content,
        conversationId: 'a',
        hostId: 'local',
        snapshot: { phase: 'inactive' },
      };
    const render = (pane) => h(getPaneContext(React).Provider, { value: pane }, h(Adapter, props));
    let tree;
    await act(async () => {
      tree = create(render(null));
    });
    expect(tree.root.findByType('div').props.style).toBeUndefined();
    await act(async () => tree.update(render({ active: true })));
    expect(tree.root.findByType('div').props.style).toEqual({ overflow: 'clip' });
    expect(tree.root.findByType('article').children).toEqual(['Transcript']);
    await act(async () => tree.update(render(null)));
    expect(tree.root.findByType('div').props.style).toBeUndefined();
    expect(mounts).toBe(1);
    await act(async () => tree.unmount());
  },
);

function providerHarness() {
  const Location = React.createContext(null),
    Route = React.createContext({ matches: [] });
  let outer, observed;
  const body = providerAdapter
    .slice(0, providerAdapter.indexOf('function ModexPaneShell'))
    .replace('export function', 'function');
  const Adapter = new Function(
    'mT',
    '$Ds',
    'IDs',
    'iT',
    'TaskPanesRuntime',
    'Zw',
    'pT',
    'fT',
    'JDs',
    'NDs',
    body + ';return ModexPaneProviders;',
  )(
    () => {},
    () => {},
    () => {},
    React,
    { usePane },
    () => outer,
    Route,
    Location,
    passthrough,
    passthrough,
  );
  function Content() {
    observed = React.useContext(Location).location;
    return null;
  }
  return {
    get location() {
      return observed;
    },
    render(task, location, active) {
      outer = location;
      return h(
        Route.Provider,
        { value: { matches: [{ params: {} }] } },
        h(getPaneContext(React).Provider, { value: { active } }, h(Adapter, { task }, h(Content))),
      );
    },
  };
}

test('same task receives new native navigation keys and prefills without leaking another task state', async () => {
  const harness = providerHarness(),
    task = {
      kind: 'local',
      conversationId: 'a',
      hostId: 'local',
      path: '/local/a',
      key: 'local:local:a',
    };
  let tree;
  await act(async () => {
    tree = create(
      harness.render(
        task,
        {
          pathname: '/local/a',
          search: '',
          key: 'first',
          state: { prefillPrompt: 'first prompt' },
        },
        true,
      ),
    );
  });
  expect(harness.location.key).toBe('first');
  expect(harness.location.state.prefillPrompt).toBe('first prompt');
  await act(async () =>
    tree.update(
      harness.render(
        task,
        {
          pathname: '/local/a',
          search: '',
          key: 'second',
          state: { prefillPrompt: 'second prompt', prefillAddedFiles: ['new-file'] },
        },
        true,
      ),
    ),
  );
  expect(harness.location.key).toBe('second');
  expect(harness.location.state).toEqual({
    prefillPrompt: 'second prompt',
    prefillAddedFiles: ['new-file'],
  });
  await act(async () =>
    tree.update(
      harness.render(
        task,
        {
          pathname: '/local/b',
          search: '',
          key: 'other',
          state: { prefillPrompt: 'belongs to b' },
        },
        false,
      ),
    ),
  );
  expect(harness.location.pathname).toBe('/local/a');
  expect(harness.location.state).toBe(null);
  expect(harness.location.key).not.toBe('other');
  await act(async () => tree.unmount());
});

test('inactive archived tab retains only its preview flag and active normal navigation clears it', async () => {
  const harness = providerHarness(),
    task = {
      kind: 'local',
      conversationId: 'a',
      hostId: 'local',
      path: '/local/a',
      key: 'local:local:a',
    };
  let tree;
  await act(async () => {
    tree = create(
      harness.render(
        task,
        {
          pathname: '/local/a',
          search: '',
          key: 'preview',
          state: { archivedConversationPreview: true, prefillPrompt: 'do not retain' },
        },
        true,
      ),
    );
  });
  await act(async () =>
    tree.update(
      harness.render(
        task,
        { pathname: '/local/b', search: '', key: 'other', state: { prefillPrompt: 'other' } },
        false,
      ),
    ),
  );
  expect(harness.location.state).toEqual({ archivedConversationPreview: true });
  await act(async () =>
    tree.update(
      harness.render(task, { pathname: '/local/a', search: '', key: 'normal', state: null }, true),
    ),
  );
  expect(harness.location.state).toBe(null);
  await act(async () =>
    tree.update(
      harness.render(
        task,
        { pathname: '/local/b', search: '', key: 'other-again', state: null },
        false,
      ),
    ),
  );
  expect(harness.location.state).toBe(null);
  await act(async () => tree.unmount());
});

test('local archive guard preserves read-only native transcript/footer and re-enables composer after restore', async () => {
  const GlobalPreview = React.createContext(false),
    Pane = getPaneContext(React);
  let archived = true,
    preview = false,
    unavailable = false,
    threadProps,
    resumes = 0,
    mounts = 0,
    toolbarElement = null,
    portalTarget;
  const scope = {};
  const atoms = {
    At: 'host',
    ln: 'connection',
    p: 'archived',
    sn: 'title',
    ue: 'summary',
    qe: 'scope',
    r: 'globalPreview',
  };
  function NativeThread(props) {
    threadProps = props;
    React.useEffect(() => {
      mounts++;
    }, []);
    React.useEffect(() => {
      if (props.shouldResume) resumes++;
    }, [props.shouldResume]);
    return h('main', null, props.showComposer ? h('textarea') : null, props.footerContent);
  }
  function PreviewFooter(props) {
    return h(
      'footer',
      { 'data-thread': props.conversationId, 'data-host': props.hostId },
      'Restore task',
    );
  }
  const bindings = {
    Cs: React,
    TaskPanesRuntime: { usePane },
    ModexPaneProviders: passthrough,
    ...atoms,
    X: (atom) =>
      ({
        host: 'local',
        connection: { status: unavailable ? 'unavailable' : 'available' },
        archived,
        title: 'Task A',
        summary: { displayTitle: 'Task A' },
      })[atom],
    Y: () => React.useContext(GlobalPreview),
    Ut: () => scope,
    dt: () => ({ state: preview ? { archivedConversationPreview: true } : null }),
    bs: () => h('aside', null, 'Missing host'),
    xs: () => h('aside', null, 'Unarchive required'),
    It: () => h('aside', null, 'Loading'),
    modexReactDOM: () => ({
      createPortal: (children, target) => {
        portalTarget = target;
        return children;
      },
    }),
    Qr: () => {},
    Mi: {
      HeaderButton: ({ label, pressed, onClick }) =>
        h('button', { 'aria-label': label, 'aria-pressed': pressed, onClick }),
    },
    Hr: ({ children, ...props }) => h('button', props, children),
    aa: ({ trigger, isOpen, onOpenChange, children }) =>
      h(
        'section',
        null,
        React.cloneElement(trigger, { onClick: () => onOpenChange(!isOpen) }),
        isOpen ? children : null,
      ),
    Ca: () => h('aside', null, 'Native environment'),
    Pa: passthrough,
    Ta: {},
    xa: NativeThread,
    lo: PreviewFooter,
  };
  const Adapter = new Function(
    ...Object.keys(bindings),
    localAdapter.replace('export function', 'function') + ';return ModexLocalPaneTask;',
  )(...Object.values(bindings));
  const task = { conversationId: 'a', hostId: 'local', title: 'Task A' };
  const render = () =>
    h(
      GlobalPreview.Provider,
      { value: false },
      h(
        Pane.Provider,
        { value: { active: true, toolbarElement, setTitle: () => {} } },
        h(Adapter, { task }),
      ),
    );
  let tree;
  await act(async () => {
    tree = create(render());
  });
  expect(tree.root.findAllByType('main')).toHaveLength(0);
  expect(tree.root.findByType('aside').children).toEqual(['Unarchive required']);
  preview = true;
  await act(async () => tree.update(render()));
  expect(tree.root.findAllByType('textarea')).toHaveLength(0);
  expect(threadProps.isReadOnly).toBe(true);
  expect(threadProps.allowMissingConversation).toBe(true);
  expect(resumes).toBe(0);
  expect(tree.root.findByType('footer').props).toMatchObject({
    'data-thread': 'a',
    'data-host': 'local',
  });
  archived = false;
  preview = false;
  await act(async () => tree.update(render()));
  expect(tree.root.findAllByType('textarea')).toHaveLength(1);
  expect(threadProps.isReadOnly).toBe(false);
  expect(threadProps.allowMissingConversation).toBe(false);
  expect(resumes).toBe(1);
  expect(tree.root.findAllByType('footer')).toHaveLength(0);
  expect(tree.root.findAllByType('button')).toHaveLength(0);
  toolbarElement = { group: 'first' };
  await act(async () => tree.update(render()));
  expect(portalTarget).toBe(toolbarElement);
  await act(async () => tree.root.findByType('button').props.onClick());
  expect(tree.root.findByType('aside').children).toEqual(['Native environment']);
  toolbarElement = { group: 'second' };
  await act(async () => tree.update(render()));
  expect(portalTarget).toBe(toolbarElement);
  expect(mounts).toBe(1);
  expect(tree.root.findAllByType('textarea')).toHaveLength(1);
  unavailable = true;
  await act(async () => tree.update(render()));
  expect(tree.root.findByType('aside').children).toEqual(['Missing host']);
  await act(async () => tree.unmount());
});

test('cloud archived preview supplies the stock cloud footer and removes only the composer', async () => {
  let preview = true;
  function NativeThread({ showComposer, footerContent }) {
    return h('main', null, showComposer ? h('textarea') : null, footerContent);
  }
  const bindings = {
    bo: React,
    ModexPaneProviders: passthrough,
    TaskPanesRuntime: { usePane },
    G: (atom) => (atom === 'host' ? 'durable' : { data: { task: { title: 'Cloud task' } } }),
    m: 'host',
    Re: 'data',
    Ke: () => ({ state: preview ? { archivedConversationPreview: true } : null }),
    Ja: NativeThread,
    Wr: ({ conversationId, kind }) =>
      h('footer', { 'data-thread': conversationId, 'data-kind': kind }),
  };
  const Adapter = new Function(
    ...Object.keys(bindings),
    cloudAdapter.replace('export function', 'function') + ';return ModexCloudPaneTask;',
  )(...Object.values(bindings));
  const render = () => h(Adapter, { task: { taskId: 'cloud-a', title: 'Cloud task' } });
  let tree;
  await act(async () => {
    tree = create(render());
  });
  expect(tree.root.findAllByType('textarea')).toHaveLength(0);
  expect(tree.root.findByType('footer').props).toMatchObject({
    'data-thread': 'cloud-a',
    'data-kind': 'cloud',
  });
  preview = false;
  await act(async () => tree.update(render()));
  expect(tree.root.findAllByType('textarea')).toHaveLength(1);
  expect(tree.root.findAllByType('footer')).toHaveLength(0);
  await act(async () => tree.unmount());
});

for (const kind of ['local', 'cloud'])
  test(`native page preserves ${kind} archived preview across pane navigation and refreshes external route metadata`, async () => {
    const { Workspace, createWorkspaceStore } = await import('./runtime.mjs');
    const { createLayout, dropTask } = await import('./layout.mjs');
    const Location = React.createContext(null),
      Route = React.createContext({ matches: [{ params: {} }] });
    const path = kind === 'local' ? '/local/a' : '/remote/a';
    const task =
      kind === 'local'
        ? {
            kind,
            conversationId: 'a',
            hostId: 'local',
            key: 'local:local:a',
            path,
            title: 'Saved title',
          }
        : { kind, taskId: 'a', key: 'cloud:a', path, title: 'Saved title' };
    const other = {
      kind: 'local',
      conversationId: 'b',
      hostId: 'local',
      key: 'local:local:b',
      path: '/local/b',
      title: 'Other',
    };
    const { createDragCoordinator } = await import('./drag.mjs');
    const store = createWorkspaceStore(),
      coordinator = createDragCoordinator();
    let initial = createLayout(task);
    initial = dropTask(initial, { task: other, targetGroup: initial.activeGroup, edge: 'right' });
    initial = { ...initial, root: { ...initial.root, ratio: 0.63 } };
    store.update(initial);
    let location = {
      pathname: path,
      search: '',
      key: 'initial',
      state: { archivedConversationPreview: true, prefillPrompt: 'never replay' },
    };
    const routeFor = () =>
      location.pathname.startsWith('/remote/')
        ? {
            routeKind: 'remote-thread',
            taskId: 'a',
            pathname: location.pathname,
            search: location.search,
          }
        : {
            routeKind: 'local-thread',
            conversationId: location.pathname.split('/').at(-1),
            hostId: 'local',
            pathname: location.pathname,
            search: location.search,
          };
    const body = providerAdapter
      .slice(0, providerAdapter.indexOf('function ModexPaneShell'))
      .replace('export function', 'function');
    const Adapter = new Function(
      'mT',
      '$Ds',
      'IDs',
      'iT',
      'TaskPanesRuntime',
      'Zw',
      'pT',
      'fT',
      'JDs',
      'NDs',
      body + ';return ModexPaneProviders;',
    )(
      () => {},
      () => {},
      () => {},
      React,
      { usePane },
      () => location,
      Route,
      Location,
      passthrough,
      passthrough,
    );
    let mounts = 0,
      rerender;
    const observed = new Map(),
      navigations = [];
    function Content({ task }) {
      const value = React.useContext(Location).location;
      observed.set(task.key, value);
      React.useEffect(() => {
        mounts++;
      }, []);
      return h(
        'article',
        { 'data-preview-task': task.key },
        value.state?.archivedConversationPreview ? 'Archived preview' : 'Normal task',
      );
    }
    function Task({ task }) {
      return h(Adapter, { task }, h(Content, { task }));
    }
    function navigate(path, options) {
      navigations.push({ path, options });
      const url = new URL(path, 'https://modex.invalid');
      location = {
        pathname: url.pathname,
        search: url.search,
        key: String(navigations.length),
        state: options?.state ?? null,
      };
      rerender();
    }
    const pageBody = providerAdapter.slice(providerAdapter.indexOf('function ModexTaskPage'));
    const Page = new Function(
      'qN',
      'rQa',
      'sH',
      'Zw',
      'Db',
      'Dj',
      '$w',
      'r3',
      'pSo',
      'TaskPanesRuntime',
      'TaskPanesRenderer',
      'KN',
      'RV',
      '_1',
      'ModexPaneTab',
      'ssi',
      'osi',
      'ModexPaneShell',
      pageBody + ';return ModexTaskPage;',
    )(
      () => {},
      () => {},
      () => {},
      () => location,
      () => ({ value: routeFor() }),
      {},
      () => navigate,
      React,
      passthrough,
      { Workspace: (props) => h(Workspace, { ...props, store, coordinator }) },
      { getRenderer: () => Task },
      'button',
      undefined,
      { HeaderToolbar: passthrough },
      undefined,
      undefined,
      undefined,
      passthrough,
    );
    function App() {
      const [, refresh] = React.useReducer((value) => value + 1, 0);
      rerender = refresh;
      return h(
        Route.Provider,
        { value: { matches: [{ params: {} }] } },
        h(Page, { Page: () => null }),
      );
    }
    let tree;
    await act(async () => {
      tree = create(h(App), {
        createNodeMock: (element) =>
          element.type === 'div'
            ? { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) }
            : null,
      });
    });
    const click = (key) => tree.root.findByProps({ 'data-modex-tab-key': key }).props.onClick();
    await act(async () => click(other.key));
    await act(async () => click(task.key));
    expect(observed.get(task.key).state).toEqual({ archivedConversationPreview: true });
    expect(navigations.at(-1).options.state).toEqual({ archivedConversationPreview: true });
    expect(mounts).toBe(2);
    // An explicit normal navigation at the same path clears only preview metadata.
    await act(async () => {
      location = { ...location, key: 'normal', state: null };
      rerender();
    });
    expect(observed.get(task.key).state).toBeNull();
    expect(store.getSnapshot().root.first.tabs[0].archivedConversationPreview).toBeUndefined();
    // Same-path preview and a later query change both reconcile the stored tab.
    await act(async () => {
      location = {
        ...location,
        key: 'preview-again',
        state: { archivedConversationPreview: true },
      };
      rerender();
    });
    await act(async () => {
      location = { ...location, search: '?view=details', key: 'query' };
      rerender();
    });
    expect(observed.get(task.key).search).toBe('?view=details');
    expect(store.getSnapshot().root.first.tabs[0]).toMatchObject({
      path: path + '?view=details',
      title: 'Saved title',
      archivedConversationPreview: true,
    });
    expect(store.getSnapshot().root.ratio).toBe(0.63);
    expect(store.getSnapshot().root.first.id).toBe(initial.root.first.id);
    expect(store.getSnapshot().root.second.id).toBe(initial.root.second.id);
    await act(async () => click(other.key));
    await act(async () => {
      coordinator.start([store.getSnapshot().root.first.tabs[0]]);
      coordinator.move({ x: 300, y: 350 });
      expect(coordinator.drop()).toBe(true);
    });
    expect(navigations.at(-1).options.state).toEqual({ archivedConversationPreview: true });
    expect(observed.get(task.key).state).toEqual({ archivedConversationPreview: true });
    await act(async () => click(other.key));
    await act(async () => tree.root.findByProps({ 'aria-label': 'Close Other' }).props.onClick());
    expect(navigations.at(-1)).toEqual({
      path: path + '?view=details',
      options: { state: { archivedConversationPreview: true } },
    });
    expect(observed.get(task.key).state).toEqual({ archivedConversationPreview: true });
    expect(mounts).toBe(2);
    await act(async () => tree.unmount());
  });
