/** Safe wrappers: storage can be missing, full or blocked (private windows), so every access is guarded. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function safeStorage(): KeyValueStore {
  const memory = new Map<string, string>();
  const fallback: KeyValueStore = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
  try {
    const store = globalThis.localStorage;
    store.setItem('pl.probe', '1');
    store.removeItem('pl.probe');
    return {
      getItem: (k) => {
        try {
          return store.getItem(k);
        } catch {
          return fallback.getItem(k);
        }
      },
      setItem: (k, v) => {
        try {
          store.setItem(k, v);
        } catch {
          fallback.setItem(k, v);
        }
      },
      removeItem: (k) => {
        try {
          store.removeItem(k);
        } catch {
          fallback.removeItem(k);
        }
      },
    };
  } catch {
    return fallback;
  }
}
