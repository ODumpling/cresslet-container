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
/** Bound for one IndexedDB transaction (and for flushing pending writes): past it a get is a miss, a put/delete a no-op. */
export const OP_TIMEOUT = 2000

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
    if (this.db) return this.db
    const p: Promise<IDBDatabase | null> = new Promise((resolve) => {
      let settled = false
      const done = (db: IDBDatabase | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(db)
      }
      // a blocked upgrade (another tab on an older version) or a hung open must not stall installs
      const timer = setTimeout(() => done(null), OPEN_TIMEOUT)
      const drop = () => void (this.db === p && (this.db = null)) // reopen on next use
      try {
        if (typeof indexedDB === 'undefined') return done(null)
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
        }
        req.onsuccess = () => {
          const db = req.result
          // the fallback already resolved: an unused open connection would block deleteDatabase / version bumps;
          // drop the null result so the next operation reopens instead of staying cache-less until reload
          if (settled) return db.close(), drop()
          db.onversionchange = () => (db.close(), drop())
          db.onclose = drop
          done(db)
        }
        // a late error after the fallback: drop the null result too, so the next operation retries the open
        req.onerror = () => (settled ? drop() : done(null))
        req.onblocked = () => done(null)
      } catch {
        done(null)
      }
    })
    this.db = p
    return p
  }

  private async tx<T>(store: CacheStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    const db = await this.open()
    if (!db) return undefined
    return new Promise<T | undefined>((resolve) => {
      let t: IDBTransaction | undefined
      const done = (v: T | undefined) => (clearTimeout(timer), resolve(v))
      // a stuck transaction is a miss / no-op, and is aborted so a late put/delete can't commit after we gave up
      const timer = setTimeout(() => {
        resolve(undefined)
        try {
          t?.abort()
        } catch {}
      }, OP_TIMEOUT)
      try {
        t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        t.oncomplete = () => done(req.result as T)
        t.onerror = t.onabort = () => done(undefined)
      } catch {
        done(undefined)
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

const ALGOS = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' } as const
export interface Digest {
  /** `algo-hash`, the token used as the cache key */
  token: string
  algo: keyof typeof ALGOS
  hash: string
  /** every hash given for `algo` (SRI: matching any one of them passes); `hash` is the first */
  hashes: string[]
  /** WebCrypto algorithm name */
  subtle: string
}

/** The strongest supported algorithm (SRI rules): its first token keys the cache, all of its tokens verify. */
export function selectDigest(integrity?: string): Digest | null {
  let best = null as Digest | null
  const rank = (a: string) => Object.keys(ALGOS).indexOf(a)
  for (const t of integrity?.trim().split(/\s+/) ?? []) {
    const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=_-]+)/.exec(t) // drops SRI `?options`
    if (!m) continue
    const algo = m[1] as Digest['algo']
    if (best?.algo === algo) best.hashes.push(m[2])
    else if (!best || rank(algo) < rank(best.algo)) best = { token: `${algo}-${m[2]}`, algo, hash: m[2], hashes: [m[2]], subtle: ALGOS[algo] }
  }
  return best
}

/** Whether a digest can actually be checked here (WebCrypto is missing on insecure origins). */
export const canVerify = (d: Digest | null): d is Digest => !!d && !!globalThis.crypto?.subtle

/** Cache key for a tarball: its sha256+ digest when it is verified on read (content-addressed, shared across mirrors), else its URL. */
export function tarballKey(url: string, integrity?: string): string {
  const d = selectDigest(integrity)
  return canVerify(d) && d.algo !== 'sha1' ? d.token : url
}

let shared: IdbCache | null = null
/** One IndexedDB connection per page, shared by all containers. */
export const sharedIdbCache = (): IdbCache => (shared ??= new IdbCache())
