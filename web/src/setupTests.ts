import '@testing-library/jest-dom/vitest'

// Node's own experimental `localStorage` global shadows jsdom's and evaluates
// to undefined unless node is started with --localstorage-file, so the tests
// see `sessionStorage` but no `localStorage` at all. Deliberately minimal and
// in-memory: it exists so the real code path runs, not to model quota, storage
// events or cross-tab behaviour.
if (typeof globalThis.localStorage === 'undefined') {
  const entries = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return entries.size
    },
    key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, String(value)),
    removeItem: key => void entries.delete(key),
    clear: () => entries.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  })
}
