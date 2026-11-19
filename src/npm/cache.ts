// Persistent npm cache (IndexedDB): tarballs keyed by integrity (else URL), packuments keyed by registry|name with
// a fetch timestamp. Every operation degrades to a miss / no-op when IndexedDB is unavailable or failing
// (private mode, blocked storage, quota), so installs never fail because of the cache.

export interface PackageCache {
  get<T = unknown>(store: CacheStore, key: string): Promise<T | undefined>
  put(store: CacheStore, key: string, value: unknown): Promise<void>
  delete(store: CacheStore, key: string): Promise<void>
}

export type CacheStore = 'tarballs' | 'packuments'

const DB_NAME = 'cresslet-npm'
const STORES: CacheStore[] = ['tarballs', 'packuments']
const OPEN_TIMEOUT = 3000

/** In-memory PackageCache (tests, or a host that wants per-session caching only). */
export class MemoryCache implements PackageCache {
  readonly data = new Map<string, unknown>()
  async get<T>(store: CacheStore, key: string) {
    return this.data.get(`${store}:${key}`) as T | undefined
  }
  async put(store: CacheStore, key: string, value: unknown) {
    this.data.set(`${store}:${key}`, value)
  }
  async delete(store: CacheStore, key: string) {
    this.data.delete(`${store}:${key}`)
  }
}

export class IdbCache implements PackageCache {
  private db: Promise<IDBDatabase | null> | null = null

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise<IDBDatabase | null>((resolve) => {
      const done = (db: IDBDatabase | null) => (clearTimeout(timer), resolve(db))
      // a blocked upgrade (another tab on an older version) or a hung open must not stall installs
      const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT)
      try {
        if (typeof indexedDB === 'undefined') return done(null)
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
        }
        req.onsuccess = () => done(req.result)
        req.onerror = () => done(null)
        req.onblocked = () => done(null)
      } catch {
        done(null)
      }
    })
    return this.db
  }

  private async tx<T>(store: CacheStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    const db = await this.open()
    if (!db) return undefined
    return new Promise<T | undefined>((resolve) => {
      try {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        t.oncomplete = () => resolve(req.result as T)
        t.onerror = t.onabort = () => resolve(undefined)
      } catch {
        resolve(undefined)
      }
    })
  }

  get<T>(store: CacheStore, key: string) {
    return this.tx<T>(store, 'readonly', (s) => s.get(key))
  }
  async put(store: CacheStore, key: string, value: unknown) {
    await this.tx(store, 'readwrite', (s) => s.put(value, key))
  }
  async delete(store: CacheStore, key: string) {
    await this.tx(store, 'readwrite', (s) => s.delete(key))
  }
}

/** Cache key for a tarball: its integrity (content-addressed, shared across mirrors) or, without one, its URL. */
export function tarballKey(url: string, integrity?: string): string {
  const sri = integrity?.split(/\s+/).find((s) => /^sha(256|384|512)-/.test(s))
  return sri ?? url
}

let shared: IdbCache | null = null
/** One IndexedDB connection per page, shared by all containers. */
export const sharedIdbCache = (): IdbCache => (shared ??= new IdbCache())
