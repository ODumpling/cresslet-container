// VFS persistence (`boot({ persist })`): snapshots of the project directory (workdir, without any `node_modules`;
// the npm cache already persists packages) to OPFS, falling back to IndexedDB, restored on boot.
// A snapshot is written `debounceMs` after the last change, or as soon as `maxWrites` changes have piled up, and
// on teardown / page hide (best effort). Each one replaces the previous snapshot as a whole (one OPFS file or one
// IndexedDB record), so a write cut short leaves the previous snapshot.
import type { VFS } from './vfs'
import { basename, dirname, join, normalize } from './path'

export interface PersistOptions {
  /** Snapshot name: one per project. Default 'default'. Containers with the same key share (overwrite) one snapshot. */
  key?: string
  /** Write a snapshot this long after the last change. Default 1000 ms. */
  debounceMs?: number
  /** ...or once this many changes are pending, even while changes keep coming. Default 100. */
  maxWrites?: number
}

/** `c.persistence` when booted with `persist`. */
export interface Persistence {
  readonly key: string
  /** Where snapshots go: 'opfs', 'indexeddb', or null when neither is available (persistence is then off). */
  readonly backend: 'opfs' | 'indexeddb' | null
  /** Whether boot restored the workdir from a snapshot (false: none stored, or it couldn't be read). */
  readonly restored: boolean
  /** Write pending changes now; resolves once the snapshot is stored. Rejects if storing fails. */
  flush(): Promise<void>
  /** Delete the stored snapshot (pending changes are dropped). Later changes are snapshotted again. */
  clear(): Promise<void>
}

export const DEFAULT_KEY = 'default'
const DEFAULT_DEBOUNCE = 1000
const DEFAULT_MAX_WRITES = 100

// ---------------- snapshot format ----------------
// 'CVFS' | u32 LE header length | header JSON | file bytes (in header order)
// header: { v: 1, t: saved at (ms), entries: [relPath, 'd' | 'f' | 'l', mtime, size (f) | target (l)][] }, parents
// before children.
const MAGIC = [0x43, 0x56, 0x46, 0x53]
type Entry = [path: string, type: 'd' | 'f' | 'l', mtime: number, extra?: number | string]

const isNodeModules = (rel: string) => rel === 'node_modules' || rel.startsWith('node_modules/') || rel.includes('/node_modules/') || rel.endsWith('/node_modules')

/** Serialize `dir` (recursively, without `node_modules`) into one snapshot blob. */
export function encodeSnapshot(vfs: VFS, dir: string): Uint8Array {
  const entries: Entry[] = []
  const chunks: Uint8Array[] = []
  const walk = (abs: string, rel: string) => {
    for (const d of vfs.readdirEntries(abs)) {
      if (d.name === 'node_modules') continue
      const r = rel ? `${rel}/${d.name}` : d.name
      const p = `${abs === '/' ? '' : abs}/${d.name}`
      const mtime = vfs.lstat(p).mtimeMs
      if (d.isSymbolicLink()) entries.push([r, 'l', mtime, vfs.readlink(p)])
      else if (d.isDirectory()) {
        entries.push([r, 'd', mtime])
        walk(p, r)
      } else {
        const data = vfs.readFile(p)
        entries.push([r, 'f', mtime, data.byteLength])
        chunks.push(data)
      }
    }
  }
  if (vfs.isDir(dir)) walk(dir, '') // a removed workdir is an empty one
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, t: Date.now(), entries }))
  let size = 8 + header.byteLength
  for (const c of chunks) size += c.byteLength
  const out = new Uint8Array(size)
  out.set(MAGIC)
  new DataView(out.buffer).setUint32(4, header.byteLength, true)
  out.set(header, 8)
  let off = 8 + header.byteLength
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

function readHeader(bytes: Uint8Array): { len: number; header: { v: number; t?: number; entries: Entry[] } } {
  if (bytes.byteLength < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not a VFS snapshot')
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (8 + len > bytes.byteLength) throw new Error('truncated VFS snapshot')
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len)))
  if (header?.v !== 1 || !Array.isArray(header.entries)) throw new Error(`unsupported VFS snapshot version ${header?.v}`)
  return { len, header }
}

/** When a snapshot was saved (0 if unreadable). */
export function savedAt(bytes: Uint8Array): number {
  try {
    const t = readHeader(bytes).header.t
    return typeof t === 'number' ? t : 0
  } catch {
    return 0
  }
}

/** Write a snapshot's files into `dir`. Throws (having written nothing) if the blob isn't a valid snapshot. */
export function restoreSnapshot(vfs: VFS, dir: string, bytes: Uint8Array): void {
  const { len, header } = readHeader(bytes)
  // validate everything before touching the VFS
  let off = 8 + len
  const files: Uint8Array[] = []
  // as the encoder writes them: each path once, after its parent directory (never under a file or symlink: that
  // would fail halfway, or write through the link)
  const dirSet = new Set([''])
  const seen = new Set<string>()
  for (const [rel, type, mtime, extra] of header.entries) {
    if (typeof rel !== 'string' || !rel || rel.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`bad path in VFS snapshot: ${rel}`)
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    if (typeof mtime !== 'number' || !dirSet.has(parent) || seen.has(rel)) throw new Error(`bad entry in VFS snapshot: ${rel}`)
    seen.add(rel)
    if (type === 'd') dirSet.add(rel)
    if (type === 'f') {
      const n = extra as number
      if (!Number.isInteger(n) || n < 0 || off + n > bytes.byteLength) throw new Error('truncated VFS snapshot')
      files.push(bytes.slice(off, off + n))
      off += n
    } else if (type === 'l' ? typeof extra !== 'string' : type !== 'd') throw new Error(`bad entry in VFS snapshot: ${rel}`)
  }
  const base = dir === '/' ? '' : dir
  vfs.mkdir(dir, { recursive: true })
  let f = 0
  const dirs: [string, number][] = []
  for (const [rel, type, mtime, extra] of header.entries) {
    const p = `${base}/${rel}`
    if (type === 'd') {
      vfs.mkdir(p, { recursive: true })
      dirs.push([p, mtime])
    } else {
      vfs.rm(p, { force: true, recursive: true })
      if (type === 'l') vfs.symlink(extra as string, p)
      else {
        vfs.writeFile(p, files[f++], { mkdirp: true })
        vfs.utimes(p, mtime)
      }
    }
  }
  // directories last: creating their children bumped their mtimes
  for (const [p, mtime] of dirs) vfs.utimes(p, mtime)
}

// ---------------- stores ----------------
export interface SnapshotStore {
  readonly backend: 'opfs' | 'indexeddb'
  read(key: string): Promise<Uint8Array | null>
  write(key: string, bytes: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  /** Release the connection (stores opened for one operation). */
  close(): void
}

const OPFS_DIR = 'cresslet-vfs'
// encodeURIComponent leaves no '/' or '\', and the suffix rules out '.' / '..'
const opfsName = (key: string) => `${encodeURIComponent(key)}.snap`
const isNotFound = (e: unknown) => (e as { name?: string })?.name === 'NotFoundError'

/**
 * OPFS store, or null where OPFS (with writable streams on this thread) is unavailable. `create: false` (to read or
 * delete what's there): no writable streams needed, and null when nothing was ever stored there.
 */
export async function opfsStore(create = true): Promise<SnapshotStore | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    if (create && (typeof FileSystemFileHandle === 'undefined' || typeof FileSystemFileHandle.prototype.createWritable !== 'function')) return null
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create })
    if (create) {
      // createWritable() can exist and still be refused: probe it (a name of its own, so concurrent boots don't collide)
      const probe = `probe-${Math.random().toString(36).slice(2)}`
      try {
        await (await (await dir.getFileHandle(probe, { create: true })).createWritable()).abort()
      } finally {
        await dir.removeEntry(probe).catch(() => {})
      }
    }
    return {
      backend: 'opfs',
      async read(key) {
        try {
          const file = await (await dir.getFileHandle(opfsName(key))).getFile()
          return new Uint8Array(await file.arrayBuffer())
        } catch (e) {
          if (isNotFound(e)) return null
          throw e
        }
      },
      async write(key, bytes) {
        // a writable stream writes to a swap file and replaces the file atomically on close()
        const w = await (await dir.getFileHandle(opfsName(key), { create: true })).createWritable()
        try {
          await w.write(bytes as Uint8Array<ArrayBuffer>)
          await w.close()
        } catch (e) {
          await w.abort().catch(() => {})
          throw e
        }
      },
      async delete(key) {
        await dir.removeEntry(opfsName(key)).catch((e) => {
          if (!isNotFound(e)) throw e
        })
      },
      close() {},
    }
  } catch {
    return null // e.g. SecurityError in some private modes, a refused probe; NotFoundError without `create`
  }
}

const IDB_NAME = 'cresslet-vfs'
const IDB_STORE = 'snapshots'
const OPEN_TIMEOUT = 3000

/** IndexedDB store, or null where IndexedDB is unavailable. `create: false`: null too when the database doesn't exist. */
export async function idbStore(create = true): Promise<SnapshotStore | null> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    let settled = false
    const done = (db: IDBDatabase | null) => {
      settled = true
      clearTimeout(timer)
      resolve(db)
    }
    const timer = setTimeout(() => done(null), OPEN_TIMEOUT)
    try {
      if (typeof indexedDB === 'undefined') return done(null)
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = (e) => {
        // aborting the version change leaves no database behind
        if (!create && e.oldVersion === 0) req.transaction!.abort()
        else req.result.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => {
        if (settled) return req.result.close() // opened after the timeout: unused
        req.result.onversionchange = () => req.result.close()
        done(req.result)
      }
      req.onerror = () => done(null)
      req.onblocked = () => done(null)
    } catch {
      done(null)
    }
  })
  if (!db) return null
  const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode)
      const req = op(tx.objectStore(IDB_STORE))
      tx.oncomplete = () => resolve(req.result as T)
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction aborted'))
    })
  return {
    backend: 'indexeddb',
    async read(key) {
      const v = await run<unknown>('readonly', (s) => s.get(key))
      return v instanceof Uint8Array ? v : null
    },
    write: (key, bytes) => run('readwrite', (s) => s.put(bytes, key)),
    delete: (key) => run('readwrite', (s) => s.delete(key)),
    close: () => db.close(),
  }
}

/** The store snapshots go to: OPFS, else IndexedDB, else null. */
export async function pickStore(): Promise<SnapshotStore | null> {
  return (await opfsStore()) ?? (await idbStore())
}

/** The backend not in use, to read or delete what it holds (written while the one in use wasn't usable). */
export function otherStore(inUse: SnapshotStore['backend']): Promise<SnapshotStore | null> {
  return inUse === 'opfs' ? idbStore(false) : opfsStore(false)
}

/**
 * Delete a key's snapshot from every backend (one in use may differ from the one that wrote it), and from `inUse`.
 * Creates no storage.
 */
export async function clearSnapshot(key: string, inUse?: SnapshotStore | null): Promise<void> {
  // not the backend in use a second time: two concurrent OPFS removeEntry() calls on one file conflict
  const others = await Promise.all([inUse?.backend === 'opfs' ? null : opfsStore(false), inUse?.backend === 'indexeddb' ? null : idbStore(false)])
  try {
    await Promise.all([inUse?.delete(key), ...others.map((s) => s?.delete(key))])
  } finally {
    for (const s of others) s?.close()
  }
}

export function persistKey(key: unknown = DEFAULT_KEY): string {
  if (typeof key !== 'string' || !key) throw new TypeError(`persist key must be a non-empty string, got ${JSON.stringify(key)}`)
  return key
}

// ---------------- scheduler ----------------
/** Instances with a store, until teardown has released it (its last save may still be queued). */
const live = new Set<VfsPersistence>()

/**
 * `Container.clearPersisted(key)`: through the containers on this page using `key`, so the delete runs after a save
 * they still have queued (e.g. right after teardown) instead of being undone by it.
 */
export async function clearPersisted(key: string): Promise<void> {
  const users = [...live].filter((p) => p.key === key)
  if (!users.length) return clearSnapshot(key)
  // all at once: each drops its pending changes now, and deletes after what it has queued
  await Promise.all(users.map((p) => p.clear()))
}

export class VfsPersistence implements Persistence {
  readonly key: string
  backend: 'opfs' | 'indexeddb' | null = null
  restored = false
  private readonly debounceMs: number
  private readonly maxWrites: number
  private store: SnapshotStore | null = null
  /** Changes not in the stored snapshot (nor in the write in progress). A failed write adds its changes back. */
  private pending = 0
  /** Bumped by clear(): a write that fails after it doesn't bring its (cleared) changes back. */
  private gen = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The last write or delete queued; they run one after another. */
  private queue: Promise<void> = Promise.resolve()
  /** A write waiting for the one in progress. It serializes the workdir when it starts, so later changes join it. */
  private queued: Promise<void> | null = null
  /** When the other backend's copy of this key (seen at boot) was saved: dropped after the first save. */
  private otherSavedAt: number | null = null
  private stops: (() => void)[] = []
  private closed = false
  private readonly dir: string

  constructor(
    private readonly vfs: VFS,
    dir: string,
    opts: PersistOptions,
    /** Reports a snapshot that failed to store outside `flush()` (debounced and page-hide writes). */
    private readonly onError: (message: string) => void,
    private readonly getStore: () => Promise<SnapshotStore | null> = pickStore,
    private readonly getOther: (inUse: SnapshotStore['backend']) => Promise<SnapshotStore | null> = otherStore,
  ) {
    // '/home/project/', 'home/project': the watcher compares absolute paths without a trailing slash
    this.dir = normalize('/' + dir).replace(/(.)\/$/, '$1')
    this.key = persistKey(opts.key)
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE
    this.maxWrites = opts.maxWrites ?? DEFAULT_MAX_WRITES
    if (!(this.debounceMs >= 0)) throw new TypeError(`persist.debounceMs must be >= 0, got ${opts.debounceMs}`)
    if (!(this.maxWrites >= 1)) throw new TypeError(`persist.maxWrites must be >= 1, got ${opts.maxWrites}`)
  }

  /** Pick the store, restore the workdir from its snapshot, then start watching for changes. */
  async start(): Promise<void> {
    this.store = await this.getStore()
    this.backend = this.store?.backend ?? null
    if (!this.store || this.closed) return
    live.add(this)
    const other = await this.getOther(this.store.backend).catch(() => null)
    try {
      // the other backend may hold a copy saved while this one wasn't usable (OPFS before a browser update, or
      // read-only for a while): restore the newer one
      const [mine, theirs] = await Promise.all([
        this.store.read(this.key).catch((e) => (console.warn(`[cresslet] VFS snapshot '${this.key}' unreadable:`, e), null)),
        other?.read(this.key).catch(() => null) ?? null,
      ])
      this.otherSavedAt = theirs ? savedAt(theirs) : null
      // newest first; restoreSnapshot validates before writing, so a bad one leaves nothing behind for the next
      const candidates = [mine, theirs].filter((b): b is Uint8Array => !!b).sort((a, b) => savedAt(b) - savedAt(a))
      for (const bytes of candidates) {
        try {
          restoreSnapshot(this.vfs, this.dir, bytes)
          this.restored = true
          break
        } catch (e) {
          console.warn(`[cresslet] VFS snapshot '${this.key}' not restored:`, e)
        }
      }
    } finally {
      other?.close()
    }
    if (this.closed) return
    // from the root: removing or renaming an ancestor (`rm -rf /home`) changes the workdir too.
    // `dir` counts if it's the workdir `b` or an ancestor (removed / renamed), or a path in it outside node_modules
    const under = (abs: string, b: string) => (b + '/').startsWith(abs + '/') || (abs.startsWith(b + '/') && !isNodeModules(abs.slice(b.length + 1)))
    const base = this.dir === '/' ? '' : this.dir
    const w = this.vfs.watch('/', { recursive: true }, (event, rel) => {
      const abs = '/' + rel
      if (under(abs, base)) return this.changed()
      // through a symlink? A linked directory on the way (`node_modules/pkg -> ../packages/pkg`, a link from
      // elsewhere: writes, new files, removals), a write through a link to a file, or a workdir that is itself a
      // link now (moved, linked back)
      try {
        const real = this.vfs.exists(this.dir) ? this.vfs.realpath(this.dir) : this.dir
        const bases = real === this.dir ? [base] : [base, real === '/' ? '' : real]
        const counts = (p: string) => bases.some((b) => under(p, b))
        const dir = dirname(abs)
        if (counts(abs)) return this.changed()
        if (this.vfs.isDir(dir) && counts(join(this.vfs.realpath(dir), basename(abs)))) return this.changed()
        if (event === 'change' && this.vfs.lstat(abs).isSymbolicLink() && counts(this.vfs.realpath(abs))) this.changed()
      } catch {
        /* any resolution error (a symlink loop, ...): not a path into the workdir */
      }
    })
    this.stops.push(() => w.close())
    if (typeof addEventListener === 'function' && typeof document !== 'undefined') {
      // the page may be going away: write what's pending (best effort, the write may not finish)
      const hide = () => void (document.visibilityState === 'hidden' && this.pending && this.flushQuietly())
      addEventListener('pagehide', hide)
      document.addEventListener('visibilitychange', hide)
      this.stops.push(() => (removeEventListener('pagehide', hide), document.removeEventListener('visibilitychange', hide)))
    }
  }

  private changed(): void {
    this.pending++
    this.cancelTimer()
    if (this.pending >= this.maxWrites) this.flushQuietly()
    else this.timer = setTimeout(() => this.flushQuietly(), this.debounceMs)
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private flushQuietly(): void {
    // a queued write will include these changes, and the call that queued it reports its failure: once
    if (this.queued && this.pending) return
    this.flush().catch((e) => this.onError(`VFS persistence: snapshot '${this.key}' not saved: ${e instanceof Error ? e.message : e}`))
  }

  flush(): Promise<void> {
    this.cancelTimer()
    const store = this.store
    if (!store) return Promise.resolve()
    // nothing new: wait for the write in progress; if it failed, its changes are pending again: retry them
    if (!this.pending) return this.queue.catch(() => {}).then(() => (this.pending ? this.flush() : undefined))
    if (!this.queued) {
      const gen = this.gen
      const p: Promise<void> = this.queue.catch(() => {}).then(() => {
        if (this.queued === p) this.queued = null
        // queued before a clear(): its changes are gone, and later ones get a write of their own after the delete
        if (gen === this.gen) return this.write(store)
      })
      this.queued = this.queue = p
    }
    return this.queued
  }

  private async write(store: SnapshotStore): Promise<void> {
    const n = this.pending
    const gen = this.gen
    if (!n) return // cleared meanwhile
    this.pending = 0
    try {
      await store.write(this.key, encodeSnapshot(this.vfs, this.dir))
    } catch (e) {
      if (gen === this.gen) this.pending += n // the next change, flush() or teardown retries
      throw e
    }
    if (this.otherSavedAt !== null) {
      // older than what was just saved; best effort (newest-wins at boot covers a copy that can't be deleted).
      // Only the copy seen at boot: not one another container (tab) saved there since
      const seen = this.otherSavedAt
      this.otherSavedAt = null
      const other = await this.getOther(store.backend).catch(() => null)
      try {
        const now = await other?.read(this.key)
        if (now && savedAt(now) <= seen) await other!.delete(this.key)
      } catch {
        /* best effort */
      } finally {
        other?.close()
      }
    }
  }

  clear(): Promise<void> {
    this.cancelTimer()
    this.pending = 0
    this.gen++
    this.queued = null
    this.otherSavedAt = null // deleted too
    // the store as of when the delete runs: none after teardown closed it (clearSnapshot opens its own)
    const p = this.queue.catch(() => {}).then(() => clearSnapshot(this.key, this.store))
    this.queue = p
    return p
  }

  /** Stop watching; write pending changes (best effort: teardown can't wait for it). */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const s of this.stops.splice(0)) s()
    this.cancelTimer()
    // also when nothing is pending: a write in progress that fails is retried. The container's listeners are gone
    // by the time this fails: warn instead
    void this.flush().catch((e) => console.warn(`[cresslet] VFS snapshot '${this.key}' not saved on teardown:`, e))
    // release the store once nothing is queued on it (e.g. `teardown(); await persistence.clear()`)
    const closeWhenIdle = () => {
      const q = this.queue
      void q.catch(() => {}).then(() => {
        if (q !== this.queue) return closeWhenIdle()
        this.store?.close()
        this.store = null
        live.delete(this)
      })
    }
    closeWhenIdle()
  }
}
