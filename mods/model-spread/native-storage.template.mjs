/*__STORAGE_IMPORTS__*/
export const storage = {
  getItem(key) {
    initialize();
    const value = read(key);
    return value === undefined ? null : JSON.stringify(value);
  },
  setItem(key, value) {
    initialize();
    write(key, JSON.parse(value));
  },
};
export const target = {
  addEventListener(type, listener) {
    if (type !== 'storage') return;
    bridge.subscribe('persisted-atom-updated', (event) =>
      queueMicrotask(() => listener({ key: event.key })),
    );
    bridge.subscribe('persisted-atom-sync', () => queueMicrotask(() => listener({ key: null })));
  },
};
