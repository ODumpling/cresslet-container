// VFS persistence (`boot({ persist })`): snapshots of the project directory (workdir, without any `node_modules`;
// the npm cache already persists packages) to OPFS, falling back to IndexedDB, restored on boot.
// A snapshot is written `debounceMs` after the last change, or as soon as `maxWrites` changes have piled up, and
// on teardown / page hide (best effort). Each one replaces the previous snapshot as a whole (one OPFS file or one
// IndexedDB record), so a write cut short leaves the previous snapshot.
import type { VFS } from './vfs'

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
// header: { v: 1, entries: [relPath, 'd' | 'f' | 'l', mtime, size (f) | target (l)][] }, parents before children.
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
  walk(dir, '')
  const header = new TextEncoder().encode(JSON.stringify({ v: 1, entries }))
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

/** Write a snapshot's files into `dir`. Throws (having written nothing) if the blob isn't a valid snapshot. */
export function restoreSnapshot(vfs: VFS, dir: string, bytes: Uint8Array): void {
  if (bytes.byteLength < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('not a VFS snapshot')
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (8 + len > bytes.byteLength) throw new Error('truncated VFS snapshot')
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as { v: number; entries: Entry[] }
  if (header.v !== 1 || !Array.isArray(header.entries)) throw new Error(`unsupported VFS snapshot version ${header.v}`)
  // validate everything before touching the VFS
  let off = 8 + len
  const files: Uint8Array[] = []
  for (const [rel, type, , extra] of header.entries) {
    if (typeof rel !== 'string' || !rel || rel.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`bad path in VFS snapshot: ${rel}`)
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
}

const OPFS_DIR = 'cresslet-vfs'
// encodeURIComponent leaves no '/' or '\', and the suffix rules out '.' / '..'
const opfsName = (key: string) => `${encodeURIComponent(key)}.snap`
const isNotFound = (e: unknown) => (e as { name?: string })?.name === 'NotFoundError'

/** OPFS store, or null where OPFS (with writable streams on this thread) is unavailable. */
export async function opfsStore(): Promise<SnapshotStore | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
    if (typeof FileSystemFileHandle === 'undefined' || typeof FileSystemFileHandle.prototype.createWritable !== 'function') return null
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true })
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
    }
  } catch {
    return null // e.g. SecurityError in some private modes
  }
}

const IDB_NAME = 'cresslet-vfs'
const IDB_STORE = 'snapshots'
const OPEN_TIMEOUT = 3000

/** IndexedDB store, or null where IndexedDB is unavailable. */
export async function idbStore(): Promise<SnapshotStore | null> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT)
    const done = (db: IDBDatabase | null) => (clearTimeout(timer), resolve(db))
    try {
      if (typeof indexedDB === 'undefined') return done(null)
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
      req.onsuccess = () => {
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
  }
}

/** The store snapshots go to: OPFS, else IndexedDB, else null. */
export async function pickStore(): Promise<SnapshotStore | null> {
  return (await opfsStore()) ?? (await idbStore())
}

/** Delete a key's snapshot from every backend (the one in use may differ from the one that wrote it). */
export async function clearSnapshot(key: string): Promise<void> {
  const stores = (await Promise.all([opfsStore(), idbStore()])).filter((s): s is SnapshotStore => !!s)
  await Promise.all(stores.map((s) => s.delete(key)))
}

export function persistKey(key: unknown = DEFAULT_KEY): string {
  if (typeof key !== 'string' || !key) throw new TypeError(`persist key must be a non-empty string, got ${JSON.stringify(key)}`)
  return key
}

// ---------------- scheduler ----------------
export class VfsPersistence implements Persistence {
  readonly key: string
  backend: 'opfs' | 'indexeddb' | null = null
  restored = false
  private readonly debounceMs: number
  private readonly maxWrites: number
  private store: SnapshotStore | null = null
  private pending = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The write (or delete) in progress, if any; operations run one after another. */
  private queue: Promise<void> = Promise.resolve()
  private stops: (() => void)[] = []
  private closed = false

  constructor(
    private readonly vfs: VFS,
    private readonly dir: string,
    opts: PersistOptions,
    /** Reports a snapshot that failed to store outside `flush()` (debounced writes, teardown). */
    private readonly onError: (message: string) => void,
    private readonly getStore: () => Promise<SnapshotStore | null> = pickStore,
  ) {
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
    try {
      const bytes = await this.store.read(this.key)
      if (bytes) {
        restoreSnapshot(this.vfs, this.dir, bytes)
        this.restored = true
      }
    } catch (e) {
      console.warn(`[cresslet] VFS snapshot '${this.key}' not restored:`, e)
    }
    if (this.closed) return
    const w = this.vfs.watch(this.dir, { recursive: true }, (_e, rel) => {
      if (!isNodeModules(rel)) this.changed()
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
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending >= this.maxWrites) this.flushQuietly()
    else this.timer = setTimeout(() => this.flushQuietly(), this.debounceMs)
  }

  private flushQuietly(): void {
    this.flush().catch((e) => this.onError(`VFS persistence: snapshot '${this.key}' not saved: ${e instanceof Error ? e.message : e}`))
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const store = this.store
    if (!store || !this.pending) return this.queue.catch(() => {})
    this.pending = 0
    // serialize now (the state flush() was called on), store after the write in progress
    const bytes = encodeSnapshot(this.vfs, this.dir)
    return this.enqueue(() => store.write(this.key, bytes))
  }

  clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = 0
    // every backend: a snapshot written where another was in use (e.g. before OPFS was available) must go too
    return this.enqueue(async () => void (await Promise.all([this.store?.delete(this.key), clearSnapshot(this.key)])))
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const p = this.queue.catch(() => {}).then(op)
    this.queue = p
    return p
  }

  /** Stop watching; write pending changes (best effort). */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const s of this.stops.splice(0)) s()
    if (this.pending) this.flushQuietly()
    else if (this.timer) clearTimeout(this.timer)
  }
}
