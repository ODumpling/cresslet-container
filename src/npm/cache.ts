// Persistent npm cache (IndexedDB): tarballs keyed by integrity (else URL), packuments keyed by registry|name with
// a fetch timestamp. Every operation degrades to a miss / no-op when IndexedDB is unavailable or failing
// (private mode, blocked storage, quota), so installs never fail because of the cache.
// Size cap: a `meta` store records each entry's size and last use (write or read hit, a counter shared by all
// connections) plus a running total; an operation that leaves the total over `maxBytes` evicts least-recently-used
// entries (either store) in the same transaction.

export interface PackageCache {
  get<T = unknown>(store: CacheStore, key: string): Promise<T | undefined>
  put(store: CacheStore, key: string, value: unknown): Promise<void>
  delete(store: CacheStore, key: string): Promise<void>
}

export type CacheStore = 'tarballs' | 'packuments'

const DB_NAME = 'cresslet-npm'
/** v2 adds the `meta` store (sizes + last use for LRU eviction). */
const DB_VERSION = 2
const STORES: CacheStore[] = ['tarballs', 'packuments']
const META = 'meta'
/** `meta` record holding the summed size of all entries and the use counter. Entry ids are `store:key`: no collision. */
const STATE = '#state'
/** Default cap on the cache's (approximate) total size. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
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

interface MetaEntry {
  id: string
  store: CacheStore
  key: string
  size: number
  used: number
}
interface MetaState {
  id: typeof STATE
  bytes: number
  /** Last use stamp handed out: shared by every connection, so uses in one tick (or tab) keep their order. */
  seq: number
}

const metaId = (store: CacheStore, key: string) => `${store}:${key}`

/** Approximate stored size of a value: bytes for binary data, else its JSON length. */
export function sizeOf(value: unknown): number {
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

export interface IdbCacheOptions {
  /** Cap on the cache's total size; least-recently-used entries are evicted past it. Default DEFAULT_MAX_BYTES. */
  maxBytes?: number
}

export class IdbCache implements PackageCache {
  readonly maxBytes: number
  private db: Promise<IDBDatabase | null> | null = null

  constructor(opts: IdbCacheOptions = {}) {
    this.maxBytes = checkMaxBytes(opts.maxBytes ?? DEFAULT_MAX_BYTES)
  }

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
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = (e) => {
          const db = req.result
          for (const s of STORES) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
            // v1 entries have no size / last-use record, so eviction could never see them: start over
            else if (e.oldVersion < 2) req.transaction!.objectStore(s).clear()
          }
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' }).createIndex('used', 'used')
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

  /** Runs `fn` in one transaction; resolves to its result getter's value once committed, or undefined on failure / timeout. */
  private async tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => () => T): Promise<T | undefined> {
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
        t = db.transaction(stores, mode)
        const result = fn(t)
        t.oncomplete = () => done(result())
        t.onerror = t.onabort = () => done(undefined)
      } catch {
        done(undefined)
      }
    })
  }

  /** A hit counts as a use, recorded in the same transaction, so a write right after can't evict what was just read. */
  async get<T>(store: CacheStore, key: string): Promise<T | undefined> {
    const id = metaId(store, key)
    return this.tx<T>([...STORES, META], 'readwrite', (t) => {
      const meta = t.objectStore(META)
      const req = t.objectStore(store).get(key)
      const entry = meta.get(id)
      const state = meta.get(STATE)
      state.onsuccess = () => {
        const st = readState(state.result)
        let e = entry.result as MetaEntry | undefined
        if (req.result === undefined || !e) return void (st.bytes > this.maxBytes && this.settle(t, st))
        if (e.size > this.maxBytes) {
          // bigger than a cap lowered since it was stored: it could never fit (this read still returns it)
          t.objectStore(store).delete(key)
          meta.delete(id)
          st.bytes = Math.max(0, st.bytes - e.size)
          e = undefined
        } else meta.put({ ...e, used: ++st.seq } satisfies MetaEntry)
        this.settle(t, st, e) // also trims a cache over a cap lowered since it was filled
      }
      return () => req.result as T
    })
  }

  async put(store: CacheStore, key: string, value: unknown): Promise<void> {
    const size = sizeOf(value)
    if (!(size <= this.maxBytes)) return void (await this.delete(store, key)) // could never fit; drop any older copy
    const id = metaId(store, key)
    await this.tx([...STORES, META], 'readwrite', (t) => {
      const meta = t.objectStore(META)
      // requests run in order: `old` is read before the new record replaces it
      const old = meta.get(id)
      t.objectStore(store).put(value, key)
      const state = meta.get(STATE)
      state.onsuccess = () => {
        const st = readState(state.result)
        const entry: MetaEntry = { id, store, key, size, used: ++st.seq }
        meta.put(entry)
        st.bytes = Math.max(0, st.bytes - ((old.result as MetaEntry | undefined)?.size ?? 0)) + size
        this.settle(t, st, entry)
      }
      return () => undefined
    })
  }

  async delete(store: CacheStore, key: string): Promise<void> {
    const id = metaId(store, key)
    await this.tx([store, META], 'readwrite', (t) => {
      const meta = t.objectStore(META)
      t.objectStore(store).delete(key)
      const old = meta.get(id)
      const state = meta.get(STATE)
      state.onsuccess = () => {
        const size = (old.result as MetaEntry | undefined)?.size
        if (size === undefined) return
        const st = readState(state.result)
        st.bytes = Math.max(0, st.bytes - size)
        meta.delete(id)
        meta.put(st)
      }
      return () => undefined
    })
  }

  /**
   * Saves `st` after evicting least-recently-used entries (other than `keep`, the entry just used) until its total
   * fits the cap.
   */
  private settle(t: IDBTransaction, st: MetaState, keep?: { id: string; size: number }): void {
    const meta = t.objectStore(META)
    if (st.bytes <= this.maxBytes) return void meta.put(st)
    const cur = meta.index('used').openCursor() // oldest first
    cur.onsuccess = () => {
      const c = cur.result
      // ran out of other entries: only `keep` is left (also repairs a total that drifted high)
      if (!c) return (st.bytes = keep?.size ?? 0), void meta.put(st)
      const e = c.value as MetaEntry
      if (e.id !== keep?.id) {
        t.objectStore(e.store).delete(e.key)
        c.delete()
        st.bytes -= e.size
      }
      if (st.bytes <= this.maxBytes) return void meta.put(st)
      c.continue()
    }
  }
}

const readState = (v: unknown): MetaState => ({ id: STATE, bytes: 0, seq: 0, ...(v as Partial<MetaState> | undefined) })

/** A cap must be a positive number of bytes (`Infinity` for none). */
export function checkMaxBytes(n: unknown): number {
  if (typeof n !== 'number' || !(n > 0)) throw new TypeError(`npm cache maxBytes must be a positive number, got ${JSON.stringify(n) ?? String(n)}`)
  return n
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

const shared = new Map<number, IdbCache>()
/** One IndexedDB connection per page and cap, shared by all containers using that cap. */
export function sharedIdbCache(maxBytes = DEFAULT_MAX_BYTES): IdbCache {
  let c = shared.get(maxBytes)
  if (!c) shared.set(maxBytes, (c = new IdbCache({ maxBytes })))
  return c
}
