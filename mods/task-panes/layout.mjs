// Pure workspace state. Removing a tab only changes this layout; it never closes a task.
const edges = new Set(['center', 'left', 'right', 'top', 'bottom']);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const validTask = (task) =>
  task &&
  typeof task.key === 'string' &&
  task.key.length > 0 &&
  typeof task.path === 'string' &&
  typeof task.title === 'string';
const find = (node, id) =>
  !node
    ? null
    : node.id === id
      ? node
      : node.type === 'split'
        ? find(node.first, id) || find(node.second, id)
        : null;
const groups = (node) =>
  !node ? [] : node.type === 'group' ? [node] : [...groups(node.first), ...groups(node.second)];
const mapNode = (node, id, change) =>
  !node
    ? null
    : node.id === id
      ? change(node)
      : node.type === 'split'
        ? {
            ...node,
            first: mapNode(node.first, id, change),
            second: mapNode(node.second, id, change),
          }
        : node;

function remove(node, key) {
  if (!node) return null;
  if (node.type === 'group') {
    const index = node.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return node;
    const tabs = node.tabs.filter((tab) => tab.key !== key);
    return tabs.length
      ? {
          ...node,
          tabs,
          active: node.active === key ? tabs[Math.min(index, tabs.length - 1)].key : node.active,
        }
      : null;
  }
  const first = remove(node.first, key),
    second = remove(node.second, key);
  return !first ? second : !second ? first : { ...node, first, second };
}

function normalize(state) {
  const remaining = groups(state.root);
  return {
    ...state,
    activeGroup: remaining.some((group) => group.id === state.activeGroup)
      ? state.activeGroup
      : (remaining[0]?.id ?? null),
    maximizedGroup: remaining.some((group) => group.id === state.maximizedGroup)
      ? state.maximizedGroup
      : null,
  };
}

export function createLayout(task) {
  return validTask(task)
    ? {
        root: { id: 'group-1', type: 'group', tabs: [{ ...task }], active: task.key },
        activeGroup: 'group-1',
        maximizedGroup: null,
        nextId: 2,
      }
    : { root: null, activeGroup: null, maximizedGroup: null, nextId: 1 };
}

export function dropTask(state, options = {}) {
  const { task, targetGroup, edge = 'center', index } = options ?? {};
  if (
    !state ||
    !validTask(task) ||
    !edges.has(edge) ||
    (index !== undefined && (!Number.isInteger(index) || index < 0))
  )
    return state;
  if (!state.root) {
    if (targetGroup != null) return state;
    const id = `group-${state.nextId}`;
    return {
      ...state,
      root: { id, type: 'group', tabs: [{ ...task }], active: task.key },
      activeGroup: id,
      maximizedGroup: null,
      nextId: state.nextId + 1,
    };
  }
  const target = find(state.root, targetGroup);
  if (target?.type !== 'group') return state;
  const source = groups(state.root).find((group) => group.tabs.some((tab) => tab.key === task.key));
  const reference = source?.tabs.find((tab) => tab.key === task.key) ?? { ...task };
  if (source?.id === targetGroup && edge !== 'center' && source.tabs.length === 1) return state;
  if (source?.id === targetGroup && edge === 'center') {
    const tabs =
      index === undefined ? target.tabs : target.tabs.filter((tab) => tab.key !== task.key);
    if (index !== undefined) tabs.splice(Math.min(index, tabs.length), 0, reference);
    return {
      ...state,
      root: mapNode(state.root, targetGroup, (group) => ({ ...group, tabs, active: task.key })),
      activeGroup: targetGroup,
    };
  }
  let root = source ? remove(state.root, task.key) : state.root;
  if (edge === 'center') {
    root = mapNode(root, targetGroup, (group) => {
      const tabs = [...group.tabs];
      tabs.splice(index === undefined ? tabs.length : Math.min(index, tabs.length), 0, reference);
      return { ...group, tabs, active: task.key };
    });
    return normalize({ ...state, root, activeGroup: targetGroup });
  }
  const id = `group-${state.nextId}`;
  const added = { id, type: 'group', tabs: [reference], active: task.key };
  root = mapNode(root, targetGroup, (group) => ({
    id: `split-${state.nextId + 1}`,
    type: 'split',
    axis: edge === 'left' || edge === 'right' ? 'x' : 'y',
    ratio: 0.5,
    first: edge === 'left' || edge === 'top' ? added : group,
    second: edge === 'left' || edge === 'top' ? group : added,
  }));
  return normalize({
    ...state,
    root,
    activeGroup: id,
    maximizedGroup: null,
    nextId: state.nextId + 2,
  });
}

export function closeTab(state, groupId, key) {
  const group = find(state?.root, groupId);
  if (group?.type !== 'group' || !group.tabs.some((tab) => tab.key === key)) return state;
  return normalize({ ...state, root: remove(state.root, key) });
}

export function activateTab(state, groupId, key) {
  const group = find(state?.root, groupId);
  if (group?.type !== 'group' || !group.tabs.some((tab) => tab.key === key)) return state;
  return {
    ...state,
    root: mapNode(state.root, groupId, (node) => ({ ...node, active: key })),
    activeGroup: groupId,
  };
}

export function resizeSplit(state, splitId, ratio) {
  if (find(state?.root, splitId)?.type !== 'split' || !Number.isFinite(ratio)) return state;
  return {
    ...state,
    root: mapNode(state.root, splitId, (node) => ({ ...node, ratio: clamp(ratio, 0.05, 0.95) })),
  };
}

export function toggleMaximize(state, groupId) {
  if (find(state?.root, groupId)?.type !== 'group') return state;
  return {
    ...state,
    activeGroup: groupId,
    maximizedGroup: state.maximizedGroup === groupId ? null : groupId,
  };
}

export function layoutRects(state, dimensions = {}, gap = 4) {
  let { width, height } = dimensions ?? {};
  const result = { groups: [], splitters: [] };
  width = Number.isFinite(width) ? Math.max(0, width) : 0;
  height = Number.isFinite(height) ? Math.max(0, height) : 0;
  gap = Number.isFinite(gap) ? Math.max(0, gap) : 4;
  const minimum = (node) =>
    node.type === 'group'
      ? { width: 260, height: 180 }
      : (() => {
          const a = minimum(node.first),
            b = minimum(node.second);
          return node.axis === 'x'
            ? { width: a.width + gap + b.width, height: Math.max(a.height, b.height) }
            : { width: Math.max(a.width, b.width), height: a.height + gap + b.height };
        })();
  const visit = (node, rect) => {
    if (!node) return;
    if (node.type === 'group') {
      result.groups.push({ id: node.id, group: node, ...rect });
      return;
    }
    const horizontal = node.axis === 'x',
      dimension = horizontal ? 'width' : 'height';
    const separator = Math.min(gap, rect[dimension]),
      available = rect[dimension] - separator;
    const minA = minimum(node.first)[dimension],
      minB = minimum(node.second)[dimension];
    const scale = Math.min(1, available / (minA + minB));
    const firstSize = clamp(available * node.ratio, minA * scale, available - minB * scale);
    const secondSize = Math.max(0, available - firstSize);
    const first = { ...rect, [dimension]: firstSize };
    const splitter = {
      ...rect,
      [horizontal ? 'x' : 'y']: rect[horizontal ? 'x' : 'y'] + firstSize,
      [dimension]: separator,
    };
    const second = {
      ...rect,
      [horizontal ? 'x' : 'y']: splitter[horizontal ? 'x' : 'y'] + separator,
      [dimension]: secondSize,
    };
    result.splitters.push({
      id: node.id,
      axis: node.axis,
      ratio: node.ratio,
      container: { ...rect },
      ...splitter,
    });
    visit(node.first, first);
    visit(node.second, second);
  };
  visit(find(state?.root, state?.maximizedGroup) ?? state?.root, { x: 0, y: 0, width, height });
  return result;
}

// Coordinates use the same space as rect; ties consistently prefer horizontal edges.
export function hitDropZone(rect, point, edgeFraction = 0.25) {
  if (
    !rect ||
    !point ||
    ![rect.x, rect.y, rect.width, rect.height, point.x, point.y, edgeFraction].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  const x = (point.x - rect.x) / rect.width,
    y = (point.y - rect.y) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const distances = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= clamp(edgeFraction, 0, 0.5) ? distances[0][0] : 'center';
}
