// Both React suites share the runtime module's store singleton. Keep its backing
// storage identity stable regardless of test discovery order; reset store state
// through store().save in each harness instead of replacing global localStorage.
const values = new Map();
export const testStorage = {
  fail: false,
  getItem: (key) => values.get(key) ?? null,
  setItem(key, value) {
    if (this.fail) throw Error('Storage quota exceeded');
    values.set(key, value);
  },
};
globalThis.localStorage = testStorage;
