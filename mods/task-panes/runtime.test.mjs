import { test, expect } from 'bun:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Workspace, createWorkspaceStore, getPaneContext, usePane, useActiveEffect, usePaneWidth, composerAvailable, taskFromRoute } from './runtime.mjs';
import { createLayout, dropTask } from './layout.mjs';
import { createDragCoordinator } from './drag.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const a = { key: 'local:local:a', path: '/thread/a', conversationId: 'a', hostId: 'local', title: 'A' };
const b = { key: 'local:local:b', path: '/thread/b', conversationId: 'b', hostId: 'local', title: 'B' };
const route = id => ({ routeKind: 'local-thread', conversationId: id, hostId: 'local', pathname: `/thread/${id}`, search: '' });
const bounds = { left: 0, top: 0, width: 1000, height: 700 };
const nodeMock = element => element.type === 'div' ? { getBoundingClientRect: () => bounds } : null;
const findPane = (view, key) => view.root.findByProps({ 'data-modex-task-key': key });
async function setup(initial = null, extra = {}, createNodeMock = nodeMock) {
  const store = createWorkspaceStore(), coordinator = createDragCoordinator(), navigations = [], mounted = [], unmounted = [];
  if (initial) store.update(initial);
  const Task = ({ task }) => {
    const pane = usePane(React);
    const [draft, setDraft] = React.useState('');
    React.useEffect(() => { mounted.push(task.key); return () => unmounted.push(task.key); }, []);
    return React.createElement('input', { 'data-task-input': task.key, value: draft, onChange: event => setDraft(event.target.value), 'data-active': pane.active, 'data-visible': pane.visible });
  };
  const findActive = node => !node ? null : node.type === 'group' ? node.id === initial.activeGroup ? node.tabs.find(task => task.key === node.active) : null : findActive(node.first) ?? findActive(node.second);
  const activeTask = initial ? findActive(initial.root) : null;
  const props = { React, route: route(activeTask?.conversationId ?? 'a'), navigate: path => navigations.push(path), Task, store, coordinator, children: React.createElement('div', { 'data-stock': true }, 'Stock'), ...extra };
  let view;
  await act(async () => { view = TestRenderer.create(React.createElement(Workspace, props), { createNodeMock }); });
  return { view, store, coordinator, props, navigations, mounted, unmounted };
}

test('first accepted drop opens current and dragged tasks while foreign drag remains untouched', async () => {
  const { view, store, coordinator, navigations } = await setup();
  expect(view.root.findByProps({ 'data-stock': true })).toBeTruthy();
  let prevented = false;
  view.root.findByType('div').props.onDragOverCapture({ dataTransfer: { types: ['Files'] }, preventDefault() { prevented = true; } });
  expect(prevented).toBe(false);
  await act(async () => { coordinator.start([b]); coordinator.move({ x: 999, y: 350 }); expect(coordinator.drop()).toBe(true); });
  expect(store.getSnapshot().root.type).toBe('split');
  expect(findPane(view, a.key).props['data-modex-pane-visible']).toBe('true');
  expect(findPane(view, b.key).props['data-modex-pane-active']).toBe('true');
  expect(navigations).toEqual(['/thread/b']);
  await act(async () => view.unmount());
});

test('moving groups preserves component drafts and same-route rerenders preserve tabs', async () => {
  let initial = createLayout(a);
  initial = dropTask(initial, { task: b, targetGroup: initial.activeGroup, edge: 'right' });
  const { view, store, props, mounted, unmounted } = await setup(initial);
  await act(async () => view.root.findByProps({ 'data-task-input': b.key }).props.onChange({ target: { value: 'unsent draft' } }));
  const target = initial.root.first.id;
  await act(async () => store.update(value => dropTask(value, { task: b, targetGroup: target, edge: 'center' })));
  expect(view.root.findByProps({ 'data-task-input': b.key }).props.value).toBe('unsent draft');
  expect(mounted).toEqual([a.key, b.key]);
  expect(unmounted).toEqual([]);
  expect(findPane(view, a.key).props.hidden).toBe(true);
  expect(findPane(view, a.key).props.inert).toBe(true);
  await act(async () => view.update(React.createElement(Workspace, { ...props, route: route('a') })));
  expect(store.getSnapshot().root.tabs).toHaveLength(2);
  expect(view.root.findByProps({ 'data-task-input': b.key }).props.value).toBe('unsent draft');
  await act(async () => view.unmount());
});

test('ordinary route navigation opens into active group and a repeated existing task stays unique', async () => {
  const { view, store, props } = await setup(createLayout(a));
  await act(async () => view.update(React.createElement(Workspace, { ...props, route: route('b') })));
  expect(store.getSnapshot().root.tabs.map(task => task.key)).toEqual([a.key, b.key]);
  await act(async () => view.update(React.createElement(Workspace, { ...props, route: route('a') })));
  expect(store.getSnapshot().root.tabs.map(task => task.key)).toEqual([a.key, b.key]);
  expect(store.getSnapshot().root.active).toBe(a.key);
  await act(async () => view.unmount());
});

test('remounting a saved workspace reconciles the current route and retains existing tasks', async () => {
  let initial = createLayout(a);
  initial = dropTask(initial, { task: b, targetGroup: initial.activeGroup, edge: 'right' });
  const { view, store, props } = await setup(initial);
  await act(async () => view.unmount());
  let reopened;
  await act(async () => { reopened = TestRenderer.create(React.createElement(Workspace, { ...props, route: route('c') }), { createNodeMock: nodeMock }); });
  const state = store.getSnapshot();
  expect(state.root.first.tabs.map(task => task.key)).toEqual([a.key]);
  expect(state.root.second.tabs.map(task => task.key)).toEqual([b.key, 'local:local:c']);
  expect(state.root.second.active).toBe('local:local:c');
  expect(findPane(reopened, 'local:local:c').props['data-modex-pane-active']).toBe('true');
  expect(findPane(reopened, b.key).props.hidden).toBe(true);
  await act(async () => reopened.unmount());
});

test('visible unfocused groups accept focus; closing tabs changes layout only and restores stock children', async () => {
  let initial = createLayout(a);
  initial = dropTask(initial, { task: b, targetGroup: initial.activeGroup, edge: 'right' });
  const { view, store, navigations } = await setup(initial);
  expect(findPane(view, a.key).props.inert).toBe(false);
  await act(async () => findPane(view, a.key).props.onPointerDown());
  expect(findPane(view, a.key).props['data-modex-pane-active']).toBe('true');
  expect(findPane(view, b.key).props['data-modex-pane-active']).toBe('false');
  expect(navigations.at(-1)).toBe(a.path);
  await act(async () => view.root.findByProps({ 'aria-label': 'Close A' }).props.onClick());
  expect(store.getSnapshot().root.tabs).toEqual([b]);
  expect(navigations.at(-1)).toBe(b.path);
  await act(async () => view.root.findByProps({ 'aria-label': 'Close B' }).props.onClick());
  expect(store.getSnapshot().root).toBeNull();
  expect(view.root.findByProps({ 'data-stock': true })).toBeTruthy();
  expect(a.title).toBe('A'); expect(b.title).toBe('B');
  await act(async () => view.unmount());
});

test('tab keyboard activation and separator keyboard resize affect observable state', async () => {
  let initial = createLayout(a);
  initial = dropTask(initial, { task: b, targetGroup: initial.activeGroup, edge: 'center' });
  const { view, store } = await setup(initial);
  let prevented = false;
  await act(async () => view.root.findAllByProps({ role: 'tab' })[1].props.onKeyDown({ key: 'Home', preventDefault() { prevented = true; }, currentTarget: { closest: () => null } }));
  expect(prevented).toBe(true); expect(store.getSnapshot().root.active).toBe(a.key);
  await act(async () => store.update(value => dropTask(value, { task: b, targetGroup: value.activeGroup, edge: 'right' })));
  await act(async () => view.root.findByProps({ role: 'separator' }).props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }));
  expect(store.getSnapshot().root.ratio).toBeCloseTo(0.55);
  await act(async () => view.unmount());
});

test('composer eligibility excludes hidden or unfocused panes but preserves stock composers', () => {
  expect(composerAvailable({ closest: () => null })).toBe(true);
  const element = (active, visible, extra = {}) => ({ closest: () => ({ getAttribute: name => name === 'data-modex-pane-active' ? String(active) : String(visible), ...extra }) });
  expect(composerAvailable(element(true, true))).toBe(true);
  expect(composerAvailable(element(false, true))).toBe(false);
  expect(composerAvailable(element(true, false))).toBe(false);
  expect(composerAvailable(element(true, true, { inert: true }))).toBe(false);
});

test('active effects clean up on pane deactivation and stock effects and widths remain available', async () => {
  const calls = [];
  function Consumer() {
    const pane = usePane(React), width = usePaneWidth(React, 1200);
    useActiveEffect(React, () => { calls.push('start'); return () => calls.push('stop'); }, []);
    return React.createElement('span', { 'data-width': width, 'data-context': pane });
  }
  const render = value => React.createElement(getPaneContext(React).Provider, { value }, React.createElement(Consumer));
  let view;
  await act(async () => { view = TestRenderer.create(render({ active: false, width: 400 })); });
  expect(calls).toEqual([]);
  expect(view.root.findByType('span').props['data-width']).toBe(400);
  await act(async () => view.update(render({ active: true, width: 500 })));
  expect(calls).toEqual(['start']);
  await act(async () => view.update(render({ active: false, width: 500 })));
  expect(calls).toEqual(['start', 'stop']);
  await act(async () => view.update(render(null)));
  expect(calls).toEqual(['start', 'stop', 'start']);
  expect(view.root.findByType('span').props['data-width']).toBe(1200);
  expect(view.root.findByType('span').props['data-context']).toBeNull();
  await act(async () => view.unmount());
  expect(calls.at(-1)).toBe('stop');
});

test('distinct React namespace facades share context and isolate pane effects', async () => {
  const providerReact = { ...React }, consumerReact = { ...React }, calls = [];
  expect(getPaneContext(providerReact)).toBe(getPaneContext(consumerReact));
  function Consumer({ id }) {
    const pane = usePane(consumerReact);
    useActiveEffect(consumerReact, () => { calls.push(id); }, [id]);
    return React.createElement('span', { 'data-id': id, 'data-active': pane.active });
  }
  let view;
  await act(async () => { view = TestRenderer.create(React.createElement('div', null,
    React.createElement(getPaneContext(providerReact).Provider, { value: { active: true } }, React.createElement(Consumer, { id: 'active' })),
    React.createElement(getPaneContext(providerReact).Provider, { value: { active: false } }, React.createElement(Consumer, { id: 'inactive' })))); });
  expect(calls).toEqual(['active']);
  expect(view.root.findByProps({ 'data-id': 'inactive' }).props['data-active']).toBe(false);
  await act(async () => view.unmount());
});

test('local route references preserve stock local route kind and fallback path', () => {
  expect(taskFromRoute({ routeKind: 'local-thread', conversationId: 'abc', hostId: 'machine' })).toMatchObject({ key: 'local:machine:abc', path: '/local/abc', kind: 'local', routeKind: 'local-thread' });
  expect(taskFromRoute({ ...route('a'), search: '?host=machine' }).path).toBe('/thread/a?host=machine');
  expect(taskFromRoute(null)).toBeNull();
  expect(taskFromRoute({ routeKind: 'client-local-thread' })).toBeNull();
  expect(taskFromRoute({ routeKind: 'client-local-thread', conversationId: 'pending' })).toBeNull();
  expect(taskFromRoute({ routeKind: 'chatgpt-thread', conversationId: 'chat' })).toBeNull();
  expect(taskFromRoute({ routeKind: 'local-thread' })).toBeNull();
});

test('cloud tasks coexist with local tasks and focusing each preserves its source route', async () => {
  const cloudRoute = { routeKind: 'remote-thread', taskId: 'cloud-123' };
  const cloud = taskFromRoute(cloudRoute);
  expect(cloud).toEqual({ kind: 'cloud', routeKind: 'remote-thread', taskId: 'cloud-123', key: 'cloud:cloud-123', path: '/remote/cloud-123', title: 'cloud-123' });
  expect(taskFromRoute({ ...cloudRoute, pathname: '/remote/cloud-123', search: '?view=details' }).path).toBe('/remote/cloud-123?view=details');
  const { view, store, props, coordinator, navigations } = await setup();
  await act(async () => { coordinator.start([cloud]); coordinator.move({ x: 999, y: 350 }); coordinator.drop(); });
  expect(findPane(view, a.key).props['data-modex-pane-visible']).toBe('true');
  expect(findPane(view, cloud.key).props['data-modex-pane-active']).toBe('true');
  expect(navigations.at(-1)).toBe('/remote/cloud-123');
  await act(async () => view.update(React.createElement(Workspace, { ...props, route: cloudRoute })));
  expect(store.getSnapshot().root.type).toBe('split');
  await act(async () => findPane(view, a.key).props.onPointerDown());
  expect(navigations.at(-1)).toBe(a.path);
  expect(findPane(view, cloud.key).props['data-modex-pane-active']).toBe('false');
  await act(async () => view.unmount());
});

test('tab strip drops insert and reorder at tab midpoints instead of splitting', async () => {
  let initial = createLayout(a);
  initial = dropTask(initial, { task: b, targetGroup: initial.activeGroup, edge: 'center' });
  const tab = (task, left) => ({ getAttribute: () => task.key, getBoundingClientRect: () => ({ left, width: 100 }) });
  let activeStore;
  const tablist = { getAttribute: () => initial.activeGroup, querySelectorAll: () => (activeStore?.getSnapshot().root.tabs ?? initial.root.tabs).map((task, index) => tab(task, index * 100)) };
  const mock = element => element.type === 'div' ? { getBoundingClientRect: () => bounds, querySelectorAll: () => [tablist] } : null;
  const { view, coordinator, store } = await setup(initial, {}, mock);
  activeStore = store;
  await act(async () => { coordinator.start([b]); coordinator.move({ x: 10, y: 10 }); });
  expect(view.root.findByProps({ 'data-modex-drop-preview': 'center' }).props.style.height).toBe(40);
  await act(async () => { expect(coordinator.drop()).toBe(true); });
  expect(store.getSnapshot().root.type).toBe('group');
  expect(store.getSnapshot().root.tabs.map(task => task.key)).toEqual([b.key, a.key]);
  const c = { ...a, key: 'local:local:c', path: '/local/c', title: 'C' };
  await act(async () => { coordinator.start([c]); coordinator.move({ x: 90, y: 10 }); expect(coordinator.drop()).toBe(true); });
  expect(store.getSnapshot().root.type).toBe('group');
  expect(store.getSnapshot().root.tabs.map(task => task.key)).toEqual([b.key, c.key, a.key]);
  await act(async () => view.unmount());
});

test('own task MIME is consumed during capture before editor drop handlers', async () => {
  const { view, coordinator } = await setup();
  const root = view.root.findByType('div');
  expect(root.props.onDrop).toBeUndefined();
  let prevented = 0, stopped = 0;
  const event = { dataTransfer: { types: ['application/x-modex-task'] }, clientX: 990, clientY: 350,
    preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
  await act(async () => { coordinator.start([b]); root.props.onDragOverCapture(event); root.props.onDropCapture(event); });
  expect(prevented).toBe(2); expect(stopped).toBe(2);
  await act(async () => view.unmount());
});

test('supplied native Button renders all pane controls with stock variants', async () => {
  const Button = props => React.createElement('button', { ...props, 'data-native-button': true });
  const { view } = await setup(createLayout(a), { Button });
  const buttons = view.root.findAllByType(Button);
  expect(buttons).toHaveLength(3);
  expect(buttons.every(button => ['ghostActive','ghostSecondary'].includes(button.props.color) && button.props.size === 'compact')).toBe(true);
  expect(buttons.find(button => button.props.role === 'tab').props.allowShrink).toBe(true);
  expect(buttons.filter(button => button.props.uniform)).toHaveLength(2);
  await act(async () => view.unmount());
});

test.each(['composer-root', 'composer'])('native %s drop targets take precedence over pane preview and consumption', async marker => {
  let nativeTarget = false;
  const ownerDocument = { elementsFromPoint: () => nativeTarget ? [{ closest: selector => {
    return selector.includes('[data-codex-'+marker+']') ? {} : null;
  } }] : [] };
  const mock = element => element.type === 'div' ? { getBoundingClientRect: () => bounds, ownerDocument } : null;
  const { view, coordinator, store } = await setup(null, {}, mock);
  await act(async () => { coordinator.start([b]); coordinator.move({ x: 990, y: 350 }); });
  expect(view.root.findByProps({ 'data-modex-drop-preview': 'right' }).findByType('span').children).toEqual(['Split right']);
  nativeTarget = true;
  await act(async () => coordinator.move({ x: 990, y: 350 }));
  expect(view.root.findAllByProps({ 'data-modex-drop-preview': 'right' })).toHaveLength(0);
  let prevented = false, stopped = false;
  const event = { dataTransfer: { types: ['application/x-modex-task'] }, clientX: 990, clientY: 350,
    preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
  const root = view.root.findByType('div');
  await act(async () => root.props.onDragOverCapture(event));
  expect(prevented).toBe(false); expect(stopped).toBe(false);
  await act(async () => { expect(coordinator.drop()).toBe(false); });
  await act(async () => { coordinator.start([b]); root.props.onDropCapture(event); });
  expect(prevented).toBe(false); expect(stopped).toBe(false);
  expect(store.getSnapshot().root).toBeNull();
  await act(async () => view.unmount());
});

test('whole-conversation reference wrapper yields to pane placement while nested composer keeps references', async () => {
  const referenceSelector='[data-codex-thread-reference-drop-target]';
  const composerTarget={querySelector:()=>null};
  const conversationTarget={querySelector:selector=>selector===referenceSelector?composerTarget:null};
  let target=conversationTarget;
  const ownerDocument={elementsFromPoint:()=>[{closest:selector=>selector===referenceSelector?target:target===composerTarget?composerTarget:null}]};
  const mock=element=>element.type==='div'?{getBoundingClientRect:()=>bounds,ownerDocument}:null;
  const {view,coordinator,store}=await setup(null,{},mock);
  await act(async()=>{coordinator.start([b]);coordinator.move({x:990,y:350});});
  expect(coordinator.claims({x:990,y:350})).toBe(true);
  expect(view.root.findByProps({'data-modex-drop-preview':'right'})).toBeTruthy();
  target=composerTarget;
  expect(coordinator.claims({x:990,y:350})).toBe(false);
  await act(async()=>{coordinator.move({x:990,y:350});expect(coordinator.drop()).toBe(false);});
  expect(store.getSnapshot().root).toBeNull();
  target=conversationTarget;
  await act(async()=>{coordinator.start([b]);coordinator.move({x:990,y:350});expect(coordinator.drop()).toBe(true);});
  expect(store.getSnapshot().root.type).toBe('split');
  expect(coordinator.claims({x:990,y:350})).toBe(false);
  await act(async()=>view.unmount());
});

test('native pane toolbar and tab components own chrome while task identity survives actions', async () => {
  const Toolbar=({children})=>React.createElement('header',null,children);
  const ToolbarActions=({children})=>React.createElement('nav',null,children);
  const Tab=props=>React.createElement('section',null,React.createElement('button',{...props.tabActivatorProps,onClick:props.onActivate},props.title));
  const {view,store,mounted,unmounted}=await setup(createLayout(a),{Toolbar,ToolbarActions,Tab});
  expect(view.root.findByType(Toolbar).props).toMatchObject({size:'pane',inset:'tab-strip'});
  expect(view.root.findByType(ToolbarActions).props.compact).toBe(true);
  const tab=view.root.findByType(Tab);
  expect(tab.props).toMatchObject({id:a.key,title:'A',isActive:true,isClosable:true,activateOnClick:true});
  await act(async()=>view.root.findByProps({'aria-label':'Maximize pane'}).props.onClick());
  expect(view.root.findByProps({'aria-label':'Restore pane'})).toBeTruthy();
  expect(mounted).toEqual([a.key]);expect(unmounted).toEqual([]);
  await act(async()=>tab.props.onClose());
  expect(store.getSnapshot().root).toBeNull();
  await act(async()=>view.unmount());
});

for(const kind of ['local','cloud'])test(`sidebar selection focuses existing ${kind} task without moving it or collapsing split groups`,async()=>{
  const selected=kind==='local'?a:taskFromRoute({routeKind:'remote-thread',taskId:'cloud-keep'});
  let initial=createLayout(selected);
  initial=dropTask(initial,{task:b,targetGroup:initial.activeGroup,edge:'right'});
  initial={...initial,root:{...initial.root,ratio:0.63}};
  const {view,store,props,mounted,unmounted}=await setup(initial);
  const targetRoute=kind==='local'?route('a'):{routeKind:'remote-thread',taskId:'cloud-keep'};
  for(const nextRoute of [targetRoute,route('b'),targetRoute,route('b')]){
    await act(async()=>view.update(React.createElement(Workspace,{...props,route:nextRoute})));
    expect(store.getSnapshot().root.type).toBe('split');
    expect(store.getSnapshot().root.ratio).toBe(0.63);
    expect(store.getSnapshot().root.first.tabs.map(task=>task.key)).toEqual([selected.key]);
    expect(store.getSnapshot().root.second.tabs.map(task=>task.key)).toEqual([b.key]);
    expect(view.root.findAllByProps({'data-modex-pane-visible':'true'})).toHaveLength(2);
  }
  expect(mounted).toEqual([selected.key,b.key]);expect(unmounted).toEqual([]);
  await act(async()=>view.unmount());
});

test('sidebar navigation while maximized preserves maximize mode and the underlying split',async()=>{
  let initial=createLayout(a);initial=dropTask(initial,{task:b,targetGroup:initial.activeGroup,edge:'right'});
  initial={...initial,maximizedGroup:initial.activeGroup};
  const {view,store,props}=await setup(initial);
  await act(async()=>view.update(React.createElement(Workspace,{...props,route:route('a')})));
  expect(store.getSnapshot().root.type).toBe('split');
  expect(store.getSnapshot().maximizedGroup).toBe(initial.root.first.id);
  expect(findPane(view,a.key).props['data-modex-pane-visible']).toBe('true');
  expect(findPane(view,b.key).props['data-modex-pane-visible']).toBe('false');
  await act(async()=>view.root.findByProps({'aria-label':'Restore pane'}).props.onClick());
  expect(view.root.findAllByProps({'data-modex-pane-visible':'true'})).toHaveLength(2);
  await act(async()=>view.unmount());
});

test('new sidebar tasks add to focused pane and existing hidden tabs focus in place',async()=>{
  const c={...a,key:'local:local:c',conversationId:'c',path:'/thread/c',title:'C'};
  let initial=createLayout(a);initial=dropTask(initial,{task:c,targetGroup:initial.activeGroup,edge:'center'});
  initial=dropTask(initial,{task:b,targetGroup:initial.activeGroup,edge:'right'});
  const {view,store,props}=await setup(initial);
  await act(async()=>view.update(React.createElement(Workspace,{...props,route:route('d')})));
  expect(store.getSnapshot().root.second.tabs.map(task=>task.key)).toEqual([b.key,'local:local:d']);
  expect(store.getSnapshot().root.first.tabs.map(task=>task.key)).toEqual([a.key,c.key]);
  await act(async()=>view.update(React.createElement(Workspace,{...props,route:route('a')})));
  expect(store.getSnapshot().root.first.active).toBe(a.key);
  expect(store.getSnapshot().root.second.active).toBe('local:local:d');
  expect(store.getSnapshot().root.second.tabs.map(task=>task.key)).toEqual([b.key,'local:local:d']);
  expect(view.root.findAllByProps({'data-modex-pane-visible':'true'})).toHaveLength(2);
  await act(async()=>view.unmount());
  let reopened;
  await act(async()=>{reopened=TestRenderer.create(React.createElement(Workspace,{...props,route:route('b')}),{createNodeMock:nodeMock});});
  expect(store.getSnapshot().root.type).toBe('split');
  expect(store.getSnapshot().activeGroup).toBe(initial.root.second.id);
  expect(store.getSnapshot().root.first.tabs.map(task=>task.key)).toEqual([a.key,c.key]);
  await act(async()=>reopened.unmount());
});
