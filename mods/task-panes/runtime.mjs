import {
  createLayout,
  dropTask,
  closeTab,
  activateTab,
  resizeSplit,
  toggleMaximize,
  layoutRects,
  hitDropZone,
} from './layout.mjs';
import { drag } from './drag.mjs';

const contexts = new WeakMap();
export const getPaneContext = (React) => {
  const identity = React.createContext;
  if (!contexts.has(identity)) contexts.set(identity, React.createContext(null));
  return contexts.get(identity);
};
export const usePane = (React) => React.useContext(getPaneContext(React));
export function useActiveEffect(React, effect, deps = []) {
  const pane = usePane(React);
  React.useEffect(() => {
    if (!pane || pane.active) return effect();
  }, [...deps, pane?.active]);
}
export function usePaneWidth(React, stockWidth) {
  return usePane(React)?.width ?? stockWidth;
}
export function composerAvailable(element) {
  const pane = element?.closest?.('[data-modex-pane-active]');
  return (
    !pane ||
    (pane.getAttribute('data-modex-pane-active') === 'true' &&
      pane.getAttribute('data-modex-pane-visible') === 'true' &&
      !pane.hidden &&
      !pane.inert)
  );
}
export function createWorkspaceStore() {
  let state = createLayout();
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      const value = typeof next === 'function' ? next(state) : next;
      if (value !== state) {
        state = value;
        for (const listener of listeners) listener();
      }
    },
  };
}
const session = createWorkspaceStore();
const TAB_HEIGHT = 40;
const MIME = 'application/x-modex-task';
const collect = (node) =>
  !node ? [] : node.type === 'group' ? [node] : [...collect(node.first), ...collect(node.second)];
export function taskFromRoute(route) {
  if (route?.routeKind === 'remote-thread' && route.taskId)
    return {
      kind: 'cloud',
      routeKind: 'remote-thread',
      taskId: route.taskId,
      key: `cloud:${route.taskId}`,
      path: `${route.pathname ?? `/remote/${route.taskId}`}${route.search ?? ''}`,
      title: route.taskId,
      ...(route.archivedConversationPreview ? { archivedConversationPreview: true } : {}),
    };
  if (route?.routeKind !== 'local-thread' || !route.conversationId) return null;
  return {
    key: `local:${route.hostId ?? 'local'}:${route.conversationId}`,
    kind: 'local',
    routeKind: 'local-thread',
    path: `${route.pathname ?? `/local/${route.conversationId}`}${route.search ?? ''}`,
    conversationId: route.conversationId,
    hostId: route.hostId ?? 'local',
    title: route.conversationId,
    ...(route.archivedConversationPreview ? { archivedConversationPreview: true } : {}),
  };
}

function hitTarget(element, state, screen, tasks) {
  const bounds = element?.getBoundingClientRect();
  if (!bounds) return null;
  const nativeTargets = element.ownerDocument?.elementsFromPoint?.(screen.x, screen.y) ?? [];
  // Stock registers the whole transcript for references as well as the editor.
  // Reserve the native composer surface (including padding and controls), not
  // its whole-conversation portal, so transcript space can accept pane drops.
  if (
    nativeTargets.some((node) =>
      node.closest?.('[data-codex-composer-root], [data-codex-composer]'),
    )
  )
    return null;
  const point = { x: screen.x - bounds.left, y: screen.y - bounds.top };
  const rect = state.root
    ? layoutRects(state, bounds).groups.find((rect) => hitDropZone(rect, point))
    : { id: null, x: 0, y: 0, width: bounds.width, height: bounds.height };
  const edge = rect && hitDropZone(rect, point);
  if (!edge) return null;
  if (rect.id && point.y < rect.y + Math.min(TAB_HEIGHT, rect.height)) {
    const tablist = Array.from(element.querySelectorAll?.('[data-modex-tab-group]') ?? []).find(
      (node) => node.getAttribute('data-modex-tab-group') === rect.id,
    );
    const moving = new Set(tasks.map((task) => task.key));
    const tabs = Array.from(tablist?.querySelectorAll('[data-modex-tab-key]') ?? []).filter(
      (node) => !moving.has(node.getAttribute('data-modex-tab-key')),
    );
    let index = tabs.findIndex((node) => {
      const box = node.getBoundingClientRect();
      return screen.x < box.left + box.width / 2;
    });
    if (index < 0)
      index = tabs.length || rect.group.tabs.filter((task) => !moving.has(task.key)).length;
    return { rect, edge: 'center', index, tabbar: true };
  }
  return { rect, edge };
}
const titleTree = (node, key, title) =>
  !node
    ? node
    : node.type === 'group'
      ? { ...node, tabs: node.tabs.map((task) => (task.key === key ? { ...task, title } : task)) }
      : {
          ...node,
          first: titleTree(node.first, key, title),
          second: titleTree(node.second, key, title),
        };
const routeIdentity = (task) =>
  task ? JSON.stringify([task.path, task.archivedConversationPreview === true]) : null;
const routeTree = (node, current) =>
  !node
    ? node
    : node.type === 'group'
      ? {
          ...node,
          tabs: node.tabs.map((task) => {
            if (task.key !== current.key) return task;
            const next = { ...task, path: current.path };
            if (current.archivedConversationPreview) next.archivedConversationPreview = true;
            else delete next.archivedConversationPreview;
            return next;
          }),
        }
      : { ...node, first: routeTree(node.first, current), second: routeTree(node.second, current) };
const colors = {
  background: 'var(--color-token-bg-primary, var(--color-surface, Canvas))',
  color: 'var(--color-token-text-primary, var(--color-text, CanvasText))',
};

export function Workspace({
  React,
  route,
  navigate,
  Task,
  Shell,
  Toolbar,
  ToolbarActions,
  Tab,
  Tooltip,
  MaximizeIcon,
  RestoreIcon,
  Button = 'button',
  children,
  store = session,
  coordinator = drag,
}) {
  const h = React.createElement;
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const root = React.useRef(null);
  const [size, setSize] = React.useState({ width: 1000, height: 700 });
  const [preview, setPreview] = React.useState(null);
  const [toolbars, setToolbars] = React.useState({});
  const toolbarRefs = React.useRef(new Map());
  const toolbarRef = (id) => {
    if (!toolbarRefs.current.has(id))
      toolbarRefs.current.set(id, (element) =>
        setToolbars((value) => (value[id] === element ? value : { ...value, [id]: element })),
      );
    return toolbarRefs.current.get(id);
  };
  const current = taskFromRoute(route);
  const currentRoute = routeIdentity(current);
  const lastRoute = React.useRef(null);
  const geometry = layoutRects(state, size);
  const snapshot = React.useRef(null);
  snapshot.current = { state, geometry, current, navigate };
  const navigateTask = (task) => {
    lastRoute.current = routeIdentity(task);
    snapshot.current.navigate?.(task.path, {
      state: task.archivedConversationPreview ? { archivedConversationPreview: true } : null,
    });
  };
  const focus = (groupId, key) => {
    const next = activateTab(store.getSnapshot(), groupId, key);
    store.update(next);
    const task = collect(next.root)
      .find((group) => group.id === groupId)
      ?.tabs.find((tab) => tab.key === key);
    if (task) navigateTask(task);
  };
  const close = (groupId, key) => {
    const before = store.getSnapshot(),
      next = closeTab(before, groupId, key);
    store.update(next);
    if (before.activeGroup === groupId) {
      const group = collect(next.root).find((item) => item.id === next.activeGroup);
      const task = group?.tabs.find((tab) => tab.key === group.active);
      if (task) navigateTask(task);
    }
  };
  React.useEffect(() => {
    if (!current || lastRoute.current === currentRoute) return;
    lastRoute.current = currentRoute;
    if (store.getSnapshot().root)
      store.update((value) => {
        const existing = collect(value.root).find((group) =>
          group.tabs.some((task) => task.key === current.key),
        );
        if (existing) {
          const next = activateTab(
            { ...value, root: routeTree(value.root, current) },
            existing.id,
            current.key,
          );
          return value.maximizedGroup ? { ...next, maximizedGroup: existing.id } : next;
        }
        return dropTask(value, { task: current, targetGroup: value.activeGroup, edge: 'center' });
      });
  }, [currentRoute, store]);
  React.useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const Observer = globalThis.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!state.root]);
  React.useEffect(
    () =>
      coordinator.attach({
        accepts({ tasks, point }) {
          return !!hitTarget(root.current, store.getSnapshot(), point, tasks);
        },
        preview(value) {
          if (!value) {
            setPreview(null);
            return;
          }
          setPreview(hitTarget(root.current, store.getSnapshot(), value.point, value.tasks));
        },
        drop({ tasks, point: screen }) {
          let value = store.getSnapshot();
          const hit = hitTarget(root.current, value, screen, tasks);
          if (!hit || !tasks.length) return false;
          const { rect, edge } = hit;
          if (!value.root) value = createLayout(snapshot.current.current);
          let target = rect.id ?? value.activeGroup;
          for (const [index, task] of tasks.entries()) {
            value = dropTask(value, {
              task: { ...task, title: task.title ?? task.conversationId ?? task.key },
              targetGroup: target,
              edge: index ? 'center' : edge,
              index: hit.index === undefined ? undefined : hit.index + index,
            });
            target = value.activeGroup;
          }
          store.update(value);
          const group = collect(value.root).find((group) => group.id === value.activeGroup);
          const task = group?.tabs.find((task) => task.key === group.active);
          if (task) navigateTask(task);
          return true;
        },
      }),
    [coordinator, store],
  );
  const dragEvents = {
    onDragOverCapture(event) {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(MIME)) return;
      const point = { x: event.clientX, y: event.clientY };
      coordinator.move(point);
      if (!hitTarget(root.current, store.getSnapshot(), point, [])) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onDropCapture(event) {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(MIME)) return;
      coordinator.move({ x: event.clientX, y: event.clientY });
      if (coordinator.drop()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onKeyDown(event) {
      if (event.key === 'Escape') {
        coordinator.cancel();
        setPreview(null);
      }
    },
  };
  const previewNode =
    preview &&
    h(
      'div',
      {
        'data-modex-drop-preview': preview.edge,
        style: {
          position: 'absolute',
          pointerEvents: 'none',
          zIndex: 50,
          border: '2px solid var(--color-background-primary-solid, Highlight)',
          background:
            'color-mix(in srgb, var(--color-background-primary-solid, Highlight) 15%, transparent)',
          borderRadius: 4,
          left: preview.rect.x + (preview.edge === 'right' ? preview.rect.width / 2 : 0),
          top: preview.rect.y + (preview.edge === 'bottom' ? preview.rect.height / 2 : 0),
          width: preview.rect.width / (['left', 'right'].includes(preview.edge) ? 2 : 1),
          height: preview.tabbar
            ? Math.min(TAB_HEIGHT, preview.rect.height)
            : preview.rect.height / (['top', 'bottom'].includes(preview.edge) ? 2 : 1),
          boxSizing: 'border-box',
        },
      },
      h(
        'span',
        {
          style: {
            display: 'inline-block',
            margin: 6,
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--color-text, CanvasText)',
            background: 'var(--color-surface, Canvas)',
          },
        },
        {
          left: 'Split left',
          right: 'Split right',
          top: 'Split above',
          bottom: 'Split below',
          center: 'Add to tabs',
        }[preview.edge],
      ),
    );
  const baseStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  };
  if (!state.root)
    return h('div', { ref: root, style: baseStyle, ...dragEvents }, children, previewNode);
  const rendered = [];
  for (const group of collect(state.root)) {
    const rect = geometry.groups.find((rect) => rect.id === group.id);
    for (const task of group.tabs) {
      const visible = !!rect && group.active === task.key;
      const active = visible && state.activeGroup === group.id;
      const context = {
        active,
        visible,
        toolbarElement: visible ? (toolbars[group.id] ?? null) : null,
        width: rect?.width ?? 0,
        setTitle(title) {
          if (typeof title !== 'string' || !title.trim()) return;
          store.update((value) => {
            const existing = collect(value.root)
              .flatMap((group) => group.tabs)
              .find((item) => item.key === task.key);
            return !existing || existing.title === title
              ? value
              : { ...value, root: titleTree(value.root, task.key, title) };
          });
        },
      };
      rendered.push(
        h(
          'div',
          {
            key: task.key,
            'data-modex-task-key': task.key,
            'data-modex-pane-active': String(active),
            'data-modex-pane-visible': String(visible),
            inert: !visible,
            hidden: !visible,
            onPointerDown: () => {
              if (!active) focus(group.id, task.key);
            },
            style: {
              position: 'absolute',
              display: visible ? 'flex' : 'none',
              flexDirection: 'column',
              left: rect?.x ?? 0,
              top: (rect?.y ?? 0) + Math.min(TAB_HEIGHT, rect?.height ?? 0),
              width: rect?.width ?? 0,
              height: Math.max(0, (rect?.height ?? 0) - TAB_HEIGHT),
              overflow: 'hidden',
              ...colors,
              border: 'none',
            },
          },
          h(getPaneContext(React).Provider, { value: context }, h(Task, { task })),
        ),
      );
    }
  }
  // The task pool remains one flat keyed sibling list even as its group changes.
  const tabs = geometry.groups.map(({ group, ...rect }) => {
    const tabNodes = group.tabs.map((task, index) => {
      const keyboard = (event) => {
        const count = group.tabs.length;
        const next =
          event.key === 'ArrowRight'
            ? (index + 1) % count
            : event.key === 'ArrowLeft'
              ? (index + count - 1) % count
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? count - 1
                  : null;
        if (next !== null) {
          event.preventDefault();
          focus(group.id, group.tabs[next].key);
          event.currentTarget
            .closest('[role="tablist"]')
            ?.querySelectorAll('[role="tab"]')
            [next]?.focus();
        } else if (event.key === 'Delete') {
          event.preventDefault();
          close(group.id, task.key);
        }
      };
      const activator = {
        role: 'tab',
        'data-modex-tab-key': task.key,
        'aria-selected': group.active === task.key,
        tabIndex: group.active === task.key ? 0 : -1,
        onKeyDown: keyboard,
      };
      const dragProps = {
        draggable: true,
        onDragStart(event) {
          event.dataTransfer.setData(MIME, task.key);
          event.dataTransfer.effectAllowed = 'move';
          coordinator.start([task]);
        },
        onDragEnd: () => coordinator.cancel(),
      };
      if (Tab)
        return h(Tab, {
          key: task.key,
          id: task.key,
          title: task.title,
          isActive: group.active === task.key,
          isClosable: true,
          activateOnClick: true,
          onActivate: () => focus(group.id, task.key),
          onClose: () => close(group.id, task.key),
          tabActivatorProps: activator,
          activatorProps: dragProps,
          closeButtonTabIndex: 0,
        });
      return h(
        'div',
        { key: task.key, style: { display: 'flex', minWidth: 0 } },
        h(
          Button,
          {
            ...activator,
            ...dragProps,
            type: 'button',
            color: 'ghostActive',
            size: 'compact',
            allowShrink: true,
            onClick: () => focus(group.id, task.key),
          },
          task.title,
        ),
        h(
          Button,
          {
            type: 'button',
            color: 'ghostSecondary',
            size: 'compact',
            uniform: true,
            'aria-label': `Close ${task.title}`,
            onClick: () => close(group.id, task.key),
          },
          '×',
        ),
      );
    });
    const maximized = state.maximizedGroup === group.id;
    const Icon = maximized ? RestoreIcon : MaximizeIcon;
    const label = maximized ? 'Restore pane' : 'Maximize pane';
    const maximize = h(
      Button,
      {
        type: 'button',
        color: Tab ? 'ghost' : 'ghostSecondary',
        size: Tab ? 'toolbar' : 'compact',
        uniform: true,
        'aria-pressed': maximized,
        'aria-label': label,
        onClick: () => {
          focus(group.id, group.active);
          store.update((value) => toggleMaximize(value, group.id));
        },
      },
      Icon ? h(Icon, { 'aria-hidden': true }) : label,
    );
    const controls = h(
      ToolbarActions ?? 'div',
      ToolbarActions
        ? { compact: true }
        : { style: { display: 'flex', alignItems: 'center', gap: 4 } },
      h('div', { ref: toolbarRef(group.id), style: { display: 'contents' } }),
      Tooltip ? h(Tooltip, { tooltipContent: label, delayOpen: true }, maximize) : maximize,
    );
    const tablist = h(
      'div',
      {
        role: 'tablist',
        'data-modex-tab-group': group.id,
        'aria-label': 'Task tabs',
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flex: 1,
          minWidth: 0,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        },
      },
      tabNodes,
    );
    return h(
      'div',
      {
        key: group.id,
        'data-modex-pane-toolbar': group.id,
        style: {
          position: 'absolute',
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: Math.min(TAB_HEIGHT, rect.height),
          overflow: 'hidden',
        },
      },
      h(
        Toolbar ?? 'div',
        Toolbar
          ? { size: 'pane', inset: 'tab-strip' }
          : {
              style: {
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                gap: 8,
                padding: '0 8px',
              },
            },
        tablist,
        controls,
      ),
    );
  });
  const splitters = geometry.splitters.map((rect) =>
    h('div', {
      key: rect.id,
      role: 'separator',
      tabIndex: 0,
      'aria-label': 'Resize task panes',
      'aria-orientation': rect.axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuemin': 5,
      'aria-valuemax': 95,
      'aria-valuenow': Math.round(rect.ratio * 100),
      onPointerDown(event) {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.dataset.resizing = 'true';
      },
      onPointerMove(event) {
        if (event.currentTarget.dataset.resizing !== 'true') return;
        const bounds = root.current?.getBoundingClientRect();
        if (!bounds) return;
        const x = rect.axis === 'x',
          available = x ? rect.container.width - rect.width : rect.container.height - rect.height;
        if (available <= 0) return;
        const distance = x
          ? event.clientX - bounds.left - rect.container.x
          : event.clientY - bounds.top - rect.container.y;
        store.update((value) => resizeSplit(value, rect.id, distance / available));
      },
      onPointerUp(event) {
        delete event.currentTarget.dataset.resizing;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      },
      onPointerCancel(event) {
        delete event.currentTarget.dataset.resizing;
      },
      onKeyDown(event) {
        const negative = rect.axis === 'x' ? 'ArrowLeft' : 'ArrowUp',
          positive = rect.axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        const ratio =
          event.key === negative
            ? rect.ratio - 0.05
            : event.key === positive
              ? rect.ratio + 0.05
              : event.key === 'Home'
                ? 0.05
                : event.key === 'End'
                  ? 0.95
                  : null;
        if (ratio !== null) {
          event.preventDefault();
          store.update((value) => resizeSplit(value, rect.id, ratio));
        }
      },
      style: {
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background:
          rect.axis === 'x'
            ? 'linear-gradient(to right, transparent 2px, var(--color-token-border-light, #e5e5e5) 2px, var(--color-token-border-light, #e5e5e5) 3px, transparent 3px)'
            : 'linear-gradient(to bottom, transparent 2px, var(--color-token-border-light, #e5e5e5) 2px, var(--color-token-border-light, #e5e5e5) 3px, transparent 3px)',
        cursor: rect.axis === 'x' ? 'col-resize' : 'row-resize',
        touchAction: 'none',
        zIndex: 10,
      },
    }),
  );
  const surface = h(
    'div',
    { ref: root, style: baseStyle, ...dragEvents },
    h('div', { style: { display: 'contents' } }, rendered),
    tabs,
    splitters,
    previewNode,
  );
  return Shell ? h(Shell, null, surface) : surface;
}
