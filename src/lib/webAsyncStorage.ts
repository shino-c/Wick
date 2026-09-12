/**
 * webAsyncStorage.ts — an SSR-safe stand-in for
 * `@react-native-async-storage/async-storage`, used on web only.
 *
 * WHY THIS EXISTS
 * ---------------
 * Expo Router web renders every route on the server first
 * (app.json: `"web": { "output": "static" }`). During that pass there is no
 * `window`, and the AsyncStorage package's web build is a thin wrapper over
 * `window.localStorage` with no guard:
 *
 *     function createPromise(getValue, callback) {
 *       return new Promise((resolve, reject) => {
 *         const value = getValue();   // <- window.localStorage.getItem(...)
 *
 * Supabase Auth reads its persisted session the moment the client is
 * constructed, which happens at module scope in src/lib/supabaseClient.ts — so
 * the import alone was enough to take the whole server render down with
 * `ReferenceError: window is not defined`.
 *
 * WHAT IT DOES
 * ------------
 * Same API surface as the real package, with the two things SSR needs:
 *   1. `window`/`localStorage` are never touched unless they exist, and every
 *      access is wrapped so a locked-down browser (Safari private mode,
 *      storage disabled by policy) degrades instead of throwing.
 *   2. The storage backend is resolved lazily per call rather than captured at
 *      module scope, so a module imported during SSR still works once the same
 *      bundle runs in the browser.
 *
 * This is wired in by src/../metro.config.js through `resolver.resolveRequest`
 * for `platform === 'web'` only. Native never sees this file: Android and iOS
 * keep the real AsyncStorage.
 */

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear?(): void;
  key?(index: number): string | null;
  readonly length?: number;
};

/**
 * The browser's localStorage, or null when there is none.
 *
 * Probed lazily and defensively: `typeof window` is checked before anything is
 * read off it, and the property access itself can throw in some browsers, so it
 * sits inside the try.
 */
function backend(): StorageLike | null {
  if (typeof window === 'undefined') return null;

  try {
    const ls = window.localStorage;
    if (!ls) return null;
    // Touch it once: a quota-exceeded or policy-disabled localStorage throws on
    // access rather than on read, and we would rather find out here.
    return typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

/**
 * In-memory fallback for when browser storage is unavailable.
 *
 * Without it, a private-mode browser would silently lose everything written
 * during the session — including the Supabase session the user just created.
 * Memory-only persistence keeps the app coherent for as long as the tab lives;
 * nothing is written anywhere it can leak.
 */
const memory = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  const store = backend();
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      // fall through to memory
    }
  }
  return memory.get(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  memory.set(key, value);
  const store = backend();
  if (store) {
    try {
      store.setItem(key, value);
    } catch {
      // Quota or policy refusal — the in-memory copy above is still authoritative
      // for this session.
    }
  }
}

export async function removeItem(key: string): Promise<void> {
  memory.delete(key);
  const store = backend();
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      // Nothing useful to do; the key is already gone from memory.
    }
  }
}

export async function clear(): Promise<void> {
  memory.clear();
  const store = backend();
  if (store) {
    try {
      store.clear?.();
    } catch {
      // Ignored — see removeItem.
    }
  }
}

export async function getAllKeys(): Promise<string[]> {
  const store = backend();
  const keys = new Set<string>(memory.keys());
  if (store?.key && typeof store.length === 'number') {
    try {
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k !== null) keys.add(k);
      }
    } catch {
      // Fall back to the in-memory keys alone.
    }
  }
  return Array.from(keys);
}

export async function multiGet(keys: string[]): Promise<[string, string | null][]> {
  return Promise.all(keys.map(async (k) => [k, await getItem(k)] as [string, string | null]));
}

export async function multiSet(pairs: [string, string][]): Promise<void> {
  await Promise.all(pairs.map(([k, v]) => setItem(k, v)));
}

export async function multiRemove(keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => removeItem(k)));
}

/** The real package's default export shape, for `import AsyncStorage from ...`. */
const AsyncStorage = {
  getItem,
  setItem,
  removeItem,
  clear,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove,
};

export default AsyncStorage;
