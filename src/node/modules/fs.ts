// node:fs polyfill over the main-thread VFS (sync via SAB, async via messages).
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { Readable, Writable } from 'readable-stream'
import { asyncCall, ref, syncCall } from '../rpc'
import { resolve as resolvePath } from '../../path'

interface RawStat {
  type: 'file' | 'dir' | 'symlink'
  size: number
  mtimeMs: number
  ctimeMs: number
  mode: number
}

export class Stats {
  dev = 1
  ino = 0
  nlink = 1
  uid = 1000
  gid = 1000
  rdev = 0
  blksize = 4096
  blocks: number
  size: number
  mode: number
  atimeMs: number
  mtimeMs: number
  ctimeMs: number
  birthtimeMs: number
  atime: Date
  mtime: Date
  ctime: Date
  birthtime: Date
  constructor(private raw: RawStat) {
    this.size = raw.size
    this.mode = raw.mode
    this.blocks = Math.ceil(raw.size / 512)
    this.atimeMs = this.mtimeMs = raw.mtimeMs
    this.ctimeMs = this.birthtimeMs = raw.ctimeMs
    this.atime = this.mtime = new Date(raw.mtimeMs)
    this.ctime = this.birthtime = new Date(raw.ctimeMs)
  }
  isFile() {
    return this.raw.type === 'file'
  }
  isDirectory() {
    return this.raw.type === 'dir'
  }
  isSymbolicLink() {
    return this.raw.type === 'symlink'
  }
  isFIFO() {
    return false
  }
  isSocket() {
    return false
  }
  isBlockDevice() {
    return false
  }
  isCharacterDevice() {
    return false
  }
}

export class Dirent {
  constructor(
    public name: string,
    private type: string,
    public parentPath = '',
  ) {}
  get path() {
    return this.parentPath
  }
  isFile() {
    return this.type === 'file'
  }
  isDirectory() {
    return this.type === 'dir'
  }
  isSymbolicLink() {
    return this.type === 'symlink'
  }
  isFIFO() {
    return false
  }
  isSocket() {
    return false
  }
  isBlockDevice() {
    return false
  }
  isCharacterDevice() {
    return false
  }
}

type PathLike = string | URL | Buffer
const P = (p: PathLike): string => {
  if (p instanceof URL) return decodeURIComponent(p.pathname)
  if (typeof p !== 'string') p = String(p)
  if (p.startsWith('file://')) p = decodeURIComponent(new URL(p).pathname)
  return resolvePath(p)
}

type Enc = BufferEncoding | null | undefined | { encoding?: BufferEncoding | null; flag?: string; withFileTypes?: boolean; recursive?: boolean; force?: boolean }
const encOf = (o: Enc): BufferEncoding | null => (typeof o === 'string' ? o : (o?.encoding ?? null))

function decode(bytes: Uint8Array, enc: BufferEncoding | null): string | Buffer {
  const b = Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
  return enc ? b.toString(enc) : b
}

function toData(d: unknown, enc?: BufferEncoding | null): Uint8Array | string {
  if (typeof d === 'string') return enc && enc !== 'utf8' && enc !== 'utf-8' ? new Uint8Array(Buffer.from(d, enc)) : d
  if (d instanceof Uint8Array) return d
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
  return String(d)
}

const fixErr = (e: unknown): never => {
  const err = e as Error & { code?: string; errno?: number; syscall?: string }
  if (err.code && !err.errno) err.errno = -2
  throw err
}

function wrapSync<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  return (...a) => {
    try {
      return fn(...a)
    } catch (e) {
      return fixErr(e)
    }
  }
}

// ---------------- sync API ----------------
const s = {
  readFileSync: (p: PathLike | number, o?: Enc) => {
    if (typeof p === 'number') throw new Error('readFileSync(fd) not supported')
    return decode(syncCall<Uint8Array>('readFile', P(p)), encOf(o))
  },
  writeFileSync: (p: PathLike, d: unknown, o?: Enc) => syncCall('writeFile', P(p), toData(d, encOf(o)), typeof o === 'object' && o?.flag?.startsWith('a') ? 'a' : 'w'),
  appendFileSync: (p: PathLike, d: unknown, o?: Enc) => syncCall('writeFile', P(p), toData(d, encOf(o)), 'a'),
  existsSync: (p: PathLike) => {
    try {
      return syncCall<boolean>('exists', P(p))
    } catch {
      return false
    }
  },
  statSync: (p: PathLike, o?: { throwIfNoEntry?: boolean }) => {
    try {
      return new Stats(syncCall<RawStat>('stat', P(p)))
    } catch (e) {
      if (o?.throwIfNoEntry === false && (e as { code?: string }).code === 'ENOENT') return undefined
      throw e
    }
  },
  lstatSync: (p: PathLike, o?: { throwIfNoEntry?: boolean }) => {
    try {
      return new Stats(syncCall<RawStat>('lstat', P(p)))
    } catch (e) {
      if (o?.throwIfNoEntry === false && (e as { code?: string }).code === 'ENOENT') return undefined
      throw e
    }
  },
  readdirSync: (p: PathLike, o?: Enc) => {
    const dir = P(p)
    const ents = syncCall<{ name: string; type: string }[]>('readdir', dir)
    const withTypes = typeof o === 'object' && o?.withFileTypes
    if (typeof o === 'object' && o?.recursive) {
      const out: (string | Dirent)[] = []
      const walk = (d: string, rel: string, list: { name: string; type: string }[]) => {
        for (const e of list) {
          const r = rel ? `${rel}/${e.name}` : e.name
          out.push(withTypes ? new Dirent(e.name, e.type, d) : r)
          if (e.type === 'dir') walk(`${d}/${e.name}`, r, syncCall('readdir', `${d}/${e.name}`))
        }
      }
      walk(dir, '', ents)
      return out
    }
    return withTypes ? ents.map((e) => new Dirent(e.name, e.type, dir)) : ents.map((e) => e.name)
  },
  mkdirSync: (p: PathLike, o?: { recursive?: boolean; mode?: number } | number) => syncCall<string | undefined>('mkdir', P(p), typeof o === 'object' && o?.recursive),
  rmSync: (p: PathLike, o?: { recursive?: boolean; force?: boolean }) => syncCall('rm', P(p), o?.recursive, o?.force),
  rmdirSync: (p: PathLike, o?: { recursive?: boolean }) => (o?.recursive ? syncCall('rm', P(p), true, true) : syncCall('rmdir', P(p))),
  unlinkSync: (p: PathLike) => syncCall('unlink', P(p)),
  renameSync: (a: PathLike, b: PathLike) => syncCall('rename', P(a), P(b)),
  copyFileSync: (a: PathLike, b: PathLike) => syncCall('copyFile', P(a), P(b)),
  cpSync: (a: PathLike, b: PathLike) => syncCall('cp', P(a), P(b)),
  realpathSync: Object.assign((p: PathLike) => syncCall<string>('realpath', P(p)), { native: (p: PathLike) => syncCall<string>('realpath', P(p)) }),
  readlinkSync: (p: PathLike) => syncCall<string>('readlink', P(p)),
  symlinkSync: (t: PathLike, p: PathLike) => syncCall('symlink', String(t), P(p)),
  accessSync: (p: PathLike) => {
    if (!syncCall<boolean>('exists', P(p))) throw Object.assign(new Error(`ENOENT: no such file or directory, access '${p}'`), { code: 'ENOENT', errno: -2, syscall: 'access', path: String(p) })
  },
  utimesSync: (p: PathLike, _a: unknown, m: number | Date) => syncCall('utimes', P(p), m instanceof Date ? m.getTime() : Number(m) * 1000),
  chmodSync: () => {},
  chownSync: () => {},
  fsyncSync: () => {},
  mkdtempSync: (prefix: string) => {
    const p = prefix + Math.random().toString(36).slice(2, 8)
    syncCall('mkdir', P(p), true)
    return p
  },
}
for (const k of Object.keys(s) as (keyof typeof s)[]) (s as Record<string, unknown>)[k] = wrapSync(s[k] as (...a: unknown[]) => unknown)

// ---------------- file descriptors (minimal, buffered) ----------------
interface Fd {
  path: string
  flags: string
  pos: number
  data: Uint8Array | null
}
const fds = new Map<number, Fd>()
let nextFd = 10
const fdApi = {
  openSync: (p: PathLike, flags: string | number = 'r') => {
    const f = typeof flags === 'number' ? (flags & 1 || flags & 2 ? 'w' : 'r') : flags
    const path = P(p)
    if (f.startsWith('w')) syncCall('writeFile', path, '', 'w')
    else if (f.startsWith('a') && !syncCall('exists', path)) syncCall('writeFile', path, '', 'w')
    else if (!syncCall('exists', path)) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT', errno: -2 })
    const fd = nextFd++
    fds.set(fd, { path, flags: f, pos: 0, data: null })
    return fd
  },
  closeSync: (fd: number) => void fds.delete(fd),
  writeSync: (fd: number, d: unknown, ...rest: unknown[]) => {
    if (fd === 1 || fd === 2) {
      ;(fd === 1 ? globalThis.process.stdout : globalThis.process.stderr).write(d as string)
      return typeof d === 'string' ? d.length : (d as Uint8Array).byteLength
    }
    const h = fds.get(fd)
    if (!h) throw Object.assign(new Error('EBADF: bad file descriptor'), { code: 'EBADF' })
    let bytes = typeof d === 'string' ? new TextEncoder().encode(d) : (d as Uint8Array)
    if (typeof rest[0] === 'number' && typeof d !== 'string') bytes = bytes.subarray(rest[0] as number, (rest[0] as number) + ((rest[1] as number) ?? bytes.length))
    syncCall('writeFile', h.path, bytes, 'a')
    return bytes.byteLength
  },
  readSync: (fd: number, buf: Uint8Array, off = 0, len = buf.byteLength - off, pos: number | null = null) => {
    const h = fds.get(fd)
    if (!h) throw Object.assign(new Error('EBADF: bad file descriptor'), { code: 'EBADF' })
    h.data ??= syncCall<Uint8Array>('readFile', h.path)
    const start = pos ?? h.pos
    const chunk = h.data.subarray(start, start + len)
    buf.set(chunk, off)
    if (pos === null) h.pos += chunk.byteLength
    return chunk.byteLength
  },
  fstatSync: (fd: number) => {
    if (fd <= 2) return new Stats({ type: 'file', size: 0, mtimeMs: Date.now(), ctimeMs: Date.now(), mode: 0o20666 })
    return s.statSync(fds.get(fd)!.path)
  },
  ftruncateSync: () => {},
}

// ---------------- promises API ----------------
const a = <T>(op: string, ...args: unknown[]) => asyncCall<T>(op, ...args)
export const promises = {
  readFile: async (p: PathLike, o?: Enc) => decode(await a<Uint8Array>('readFile', P(p)), encOf(o)),
  writeFile: (p: PathLike, d: unknown, o?: Enc) => a<void>('writeFile', P(p), toData(d, encOf(o)), typeof o === 'object' && o?.flag?.startsWith('a') ? 'a' : 'w'),
  appendFile: (p: PathLike, d: unknown, o?: Enc) => a<void>('writeFile', P(p), toData(d, encOf(o)), 'a'),
  stat: async (p: PathLike) => new Stats(await a<RawStat>('stat', P(p))),
  lstat: async (p: PathLike) => new Stats(await a<RawStat>('lstat', P(p))),
  readdir: async (p: PathLike, o?: Enc) => {
    const ents = await a<{ name: string; type: string }[]>('readdir', P(p))
    return typeof o === 'object' && o?.withFileTypes ? ents.map((e) => new Dirent(e.name, e.type, P(p))) : ents.map((e) => e.name)
  },
  mkdir: (p: PathLike, o?: { recursive?: boolean }) => a<string | undefined>('mkdir', P(p), o?.recursive),
  rm: (p: PathLike, o?: { recursive?: boolean; force?: boolean }) => a<void>('rm', P(p), o?.recursive, o?.force),
  rmdir: (p: PathLike, o?: { recursive?: boolean }) => (o?.recursive ? a<void>('rm', P(p), true, true) : a<void>('rmdir', P(p))),
  unlink: (p: PathLike) => a<void>('unlink', P(p)),
  rename: (x: PathLike, y: PathLike) => a<void>('rename', P(x), P(y)),
  copyFile: (x: PathLike, y: PathLike) => a<void>('copyFile', P(x), P(y)),
  cp: (x: PathLike, y: PathLike) => a<void>('cp', P(x), P(y)),
  realpath: (p: PathLike) => a<string>('realpath', P(p)),
  readlink: (p: PathLike) => a<string>('readlink', P(p)),
  symlink: (t: PathLike, p: PathLike) => a<void>('symlink', String(t), P(p)),
  access: async (p: PathLike) => {
    if (!(await a<boolean>('exists', P(p)))) throw Object.assign(new Error(`ENOENT: no such file or directory, access '${p}'`), { code: 'ENOENT', errno: -2, path: String(p) })
  },
  utimes: (p: PathLike, _a: unknown, m: number | Date) => a<void>('utimes', P(p), m instanceof Date ? m.getTime() : Number(m) * 1000),
  chmod: async () => {},
  chown: async () => {},
  mkdtemp: async (prefix: string) => {
    const p = prefix + Math.random().toString(36).slice(2, 8)
    await a('mkdir', P(p), true)
    return p
  },
  open: async (p: PathLike, flags = 'r') => {
    const fd = fdApi.openSync(p, flags)
    return {
      fd,
      readFile: (o?: Enc) => promises.readFile(p, o),
      writeFile: (d: unknown) => promises.writeFile(p, d),
      write: async (d: unknown) => ({ bytesWritten: fdApi.writeSync(fd, d) }),
      stat: () => promises.stat(p),
      close: async () => fdApi.closeSync(fd),
      [Symbol.asyncDispose]: async () => fdApi.closeSync(fd),
    }
  },
  constants: {},
}

// ---------------- callback API ----------------
type CB = (err: Error | null, v?: unknown) => void
function callbackify(fn: (...a: unknown[]) => Promise<unknown>) {
  return (...args: unknown[]) => {
    const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as CB) : null
    const release = ref()
    fn(...args).then(
      (v) => (release(), cb?.(null, v)),
      (e) => (release(), cb?.(e)),
    )
  }
}
const cbApi: Record<string, unknown> = {}
for (const [k, fn] of Object.entries(promises)) if (typeof fn === 'function') cbApi[k] = callbackify(fn as (...a: unknown[]) => Promise<unknown>)
cbApi.exists = (p: PathLike, cb: (v: boolean) => void) => {
  const release = ref()
  a<boolean>('exists', P(p)).then(
    (v) => (release(), cb(v)),
    () => (release(), cb(false)),
  )
}
for (const k of ['open', 'close', 'read', 'write', 'fstat'] as const) {
  const sync = (fdApi as Record<string, (...a: unknown[]) => unknown>)[k + 'Sync']
  cbApi[k] = (...args: unknown[]) => {
    const cb = args.pop() as CB
    try {
      const r = sync(...args)
      queueMicrotask(() => cb(null, r))
    } catch (e) {
      queueMicrotask(() => cb(e as Error))
    }
  }
}

// ---------------- streams ----------------
export function createReadStream(p: PathLike, o?: Enc & { start?: number; end?: number; highWaterMark?: number }) {
  const path = P(p)
  const enc = encOf(o)
  const opts = typeof o === 'object' && o ? o : {}
  let loaded = false
  const stream = new Readable({
    highWaterMark: opts.highWaterMark ?? 64 * 1024,
    read() {
      if (loaded) return
      loaded = true
      a<Uint8Array>('readFile', path).then(
        (data) => {
          const slice = data.subarray(opts.start ?? 0, opts.end !== undefined ? opts.end + 1 : undefined)
          const CH = 64 * 1024
          for (let i = 0; i < slice.byteLength; i += CH) {
            const c = Buffer.from(slice.subarray(i, i + CH))
            this.push(enc ? c.toString(enc) : c)
          }
          this.push(null)
        },
        (e) => this.destroy(e),
      )
    },
  }) as Readable & { path: string; bytesRead: number }
  stream.path = path
  stream.bytesRead = 0
  queueMicrotask(() => stream.emit('open', 3))
  return stream
}

export function createWriteStream(p: PathLike, o?: Enc) {
  const path = P(p)
  const append = typeof o === 'object' && o?.flag?.startsWith('a')
  let first = !append
  const stream = new Writable({
    write(chunk: unknown, _enc: string, cb: (e?: Error | null) => void) {
      const mode = first ? 'w' : 'a'
      first = false
      a('writeFile', path, toData(chunk), mode).then(() => cb(), cb)
    },
    final(cb: (e?: Error | null) => void) {
      if (first) a('writeFile', path, '', 'w').then(() => cb(), cb)
      else cb()
    },
  }) as Writable & { path: string; bytesWritten: number }
  stream.path = path
  stream.bytesWritten = 0
  queueMicrotask(() => stream.emit('open', 4))
  return stream
}

function watch(_p: PathLike, ..._args: unknown[]) {
  const w = new EventEmitter() as EventEmitter & { close(): void; ref(): unknown; unref(): unknown }
  w.close = () => {}
  w.ref = w.unref = () => w
  return w
}

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  S_IFMT: 0o170000,
  S_IFREG: 0o100000,
  S_IFDIR: 0o40000,
  S_IFLNK: 0o120000,
  COPYFILE_EXCL: 1,
}

const fs = {
  ...s,
  ...fdApi,
  ...cbApi,
  promises,
  constants,
  Stats,
  Dirent,
  createReadStream,
  createWriteStream,
  watch,
  watchFile: () => {},
  unwatchFile: () => {},
  ...constants,
}
;(promises as Record<string, unknown>).constants = constants
export default fs
