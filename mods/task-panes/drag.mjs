// One coordinator per renderer. Stock sidebar reordering owns gestures until a
// pane explicitly accepts the drop; file/text drops never enter this channel.
export function createDragCoordinator() {
  let workspace = null,
    tasks = [],
    point = null;
  const clear = () => {
    tasks = [];
    point = null;
    workspace?.preview(null);
  };
  return {
    attach(value) {
      workspace = value;
      return () => {
        if (workspace === value) {
          clear();
          workspace = null;
        }
      };
    },
    start(value) {
      clear();
      tasks = Array.isArray(value)
        ? value.filter(
            (task) => task && typeof task.key === 'string' && typeof task.path === 'string',
          )
        : [];
    },
    move(value) {
      point = value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
      workspace?.preview(tasks.length && point ? { tasks, point } : null);
    },
    claims(value) {
      return !!(
        tasks.length &&
        value &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        workspace?.accepts?.({ tasks, point: value })
      );
    },
    drop() {
      const accepted = !!(tasks.length && point && workspace?.drop({ tasks, point }));
      clear();
      return accepted;
    },
    cancel: clear,
  };
}
export const drag = createDragCoordinator();
