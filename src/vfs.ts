// In-memory POSIX file system. Sync core; Container exposes async wrappers.
import { basename, dirname, normalize } from './path'

export type WatchEvent = 'change' | 'rename'
export type WatchListener = (event: WatchEvent, filename: string) => void

interface Base {
  mtime: number
  ctime: number
}
export interface FileNode extends Base {
  type: 'file'
  data: Uint8Array
}
export interface DirNode extends Base {
  type: 'dir'
  children: Map<string, Node>
}
export interface SymlinkNode extends Base {
  type: 'symlink'
  target: string
}
export type Node = FileNode | DirNode | SymlinkNode

export interface Stats {
  type: 'file' | 'dir' | 'symlink'
  size: number
  mtimeMs: number
  ctimeMs: number
  mode: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export interface Dirent {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export class FsError extends Error {
  constructor(
    public code: string,
    op: string,
    public path: string,
  ) {
    super(`${code}: ${describe(code)}, ${op} '${path}'`)
    this.name = 'Error'
  }
  get errno(): number {
    return ERRNO[this.code] ?? -1
  }
  get syscall(): string {
    return this.message.split(', ')[1]?.split(' ')[0] ?? ''
  }
}
const ERRNO: Record<string, number> = { ENOENT: -2, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, ENOTEMPTY: -39, EINVAL: -22, ELOOP: -40 }
function describe(code: string): string {
  return (
    {
      ENOENT: 'no such file or directory',
      EEXIST: 'file already exists',
      ENOTDIR: 'not a directory',
      EISDIR: 'illegal operation on a directory',
      ENOTEMPTY: 'directory not empty',
      EINVAL: 'invalid argument',
      ELOOP: 'too many symbolic links encountered',
    }[code] ?? code
  )
}

const enc = new TextEncoder()
const dec = new TextDecoder()
export const toBytes = (d: string | Uint8Array): Uint8Array => (typeof d === 'string' ? enc.encode(d) : d)
export const toText = (d: Uint8Array): string => dec.decode(d)

interface Watcher {
  path: string
  recursive: boolean
  fn: WatchListener
}

export function makeStats(n: Node): Stats {
  const size = n.type === 'file' ? n.data.byteLength : n.type === 'dir' ? 4096 : n.target.length
  return {
    type: n.type,
    size,
    mtimeMs: n.mtime,
    ctimeMs: n.ctime,
    mode: n.type === 'dir' ? 0o40755 : n.type === 'symlink' ? 0o120777 : 0o100644,
    isFile: () => n.type === 'file',
    isDirectory: () => n.type === 'dir',
    isSymbolicLink: () => n.type === 'symlink',
  }
}

export class VFS {
  root: DirNode = { type: 'dir', children: new Map(), mtime: Date.now(), ctime: Date.now() }
  private watchers = new Set<Watcher>()

  // ---- lookup ----
  private split(p: string): string[] {
    const n = normalize(p.startsWith('/') ? p : '/' + p)
    return n.split('/').filter(Boolean)
  }

  /** Resolve a path to its node. followLast=false returns a symlink itself. */
  private lookup(p: string, followLast = true, depth = 0): Node | undefined {
    if (depth > 32) throw new FsError('ELOOP', 'stat', p)
    const parts = this.split(p)
    let cur: Node = this.root
    for (let i = 0; i < parts.length; i++) {
      if (cur.type === 'symlink') cur = this.lookup(cur.target, true, depth + 1)!
      if (!cur) return undefined
      if (cur.type !== 'dir') return undefined
      const next = cur.children.get(parts[i])
      if (!next) return undefined
      if (next.type === 'symlink' && (i < parts.length - 1 || followLast)) {
        const target = next.target.startsWith('/') ? next.target : '/' + parts.slice(0, i).join('/') + '/' + next.target
        const r = this.lookup(target, true, depth + 1)
        if (!r) return undefined
        cur = r
      } else cur = next
    }
    return cur
  }

  private parentOf(p: string, op: string): { dir: DirNode; name: string; path: string } {
    const path = normalize('/' + this.split(p).join('/'))
    if (path === '/') throw new FsError('EINVAL', op, p)
    const dir = this.lookup(dirname(path))
    if (!dir) throw new FsError('ENOENT', op, p)
    if (dir.type !== 'dir') throw new FsError('ENOTDIR', op, p)
    return { dir, name: basename(path), path }
  }

  // ---- queries ----
  exists(p: string): boolean {
    return !!this.lookup(p)
  }
  stat(p: string): Stats {
    const n = this.lookup(p)
    if (!n) throw new FsError('ENOENT', 'stat', p)
    return makeStats(n)
  }
  lstat(p: string): Stats {
    const n = this.lookup(p, false)
    if (!n) throw new FsError('ENOENT', 'lstat', p)
    return makeStats(n)
  }
  isFile(p: string): boolean {
    return this.lookup(p)?.type === 'file'
  }
  isDir(p: string): boolean {
    return this.lookup(p)?.type === 'dir'
  }
  readFile(p: string): Uint8Array {
    const n = this.lookup(p)
    if (!n) throw new FsError('ENOENT', 'open', p)
    if (n.type === 'dir') throw new FsError('EISDIR', 'read', p)
    return (n as FileNode).data
  }
  readText(p: string): string {
    return toText(this.readFile(p))
  }
  /** Returns file text or null (no throw). */
  tryReadText(p: string): string | null {
    const n = this.lookup(p)
    return n?.type === 'file' ? toText(n.data) : null
  }
  readdir(p: string): string[] {
    return this.readdirEntries(p).map((d) => d.name)
  }
  readdirEntries(p: string): Dirent[] {
    const n = this.lookup(p)
    if (!n) throw new FsError('ENOENT', 'scandir', p)
    if (n.type !== 'dir') throw new FsError('ENOTDIR', 'scandir', p)
    return [...n.children.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, c]) => ({
        name,
        isFile: () => c.type === 'file',
        isDirectory: () => c.type === 'dir',
        isSymbolicLink: () => c.type === 'symlink',
      }))
  }
  readlink(p: string): string {
    const n = this.lookup(p, false)
    if (!n) throw new FsError('ENOENT', 'readlink', p)
    if (n.type !== 'symlink') throw new FsError('EINVAL', 'readlink', p)
    return n.target
  }
  realpath(p: string): string {
    const parts = this.split(p)
    let real = ''
    for (let i = 0; i < parts.length; i++) {
      const cand = real + '/' + parts[i]
      const n = this.lookup(cand, false)
      if (!n) throw new FsError('ENOENT', 'realpath', p)
      if (n.type === 'symlink') real = this.realpath(n.target.startsWith('/') ? n.target : (real || '/') + '/' + n.target)
      else real = cand
    }
    return real || '/'
  }

  // ---- mutations ----
  mkdir(p: string, opts: { recursive?: boolean } = {}): void {
    const parts = this.split(p)
    let cur: DirNode = this.root
    for (let i = 0; i < parts.length; i++) {
      const sub = '/' + parts.slice(0, i + 1).join('/')
      let next = cur.children.get(parts[i])
      if (next?.type === 'symlink') next = this.lookup(sub)
      if (!next) {
        if (!opts.recursive && i < parts.length - 1) throw new FsError('ENOENT', 'mkdir', p)
        const now = Date.now()
        next = { type: 'dir', children: new Map(), mtime: now, ctime: now }
        cur.children.set(parts[i], next)
        cur.mtime = now
        this.emit(sub, 'rename')
      } else if (i === parts.length - 1 && !opts.recursive) throw new FsError('EEXIST', 'mkdir', p)
      if (next.type !== 'dir') throw new FsError(i === parts.length - 1 ? 'EEXIST' : 'ENOTDIR', 'mkdir', p)
      cur = next
    }
  }

  writeFile(p: string, data: string | Uint8Array, opts: { mkdirp?: boolean; append?: boolean } = {}): void {
    if (opts.mkdirp) this.mkdir(dirname(normalize('/' + this.split(p).join('/'))), { recursive: true })
    const { dir, name, path } = this.parentOf(p, 'open')
    let existing = dir.children.get(name)
    if (existing?.type === 'symlink') existing = this.lookup(path)
    if (existing?.type === 'dir') throw new FsError('EISDIR', 'open', p)
    let bytes = toBytes(data)
    const now = Date.now()
    if (existing?.type === 'file') {
      if (opts.append) {
        const merged = new Uint8Array(existing.data.byteLength + bytes.byteLength)
        merged.set(existing.data)
        merged.set(bytes, existing.data.byteLength)
        bytes = merged
      }
      existing.data = bytes
      existing.mtime = now
      this.emit(path, 'change')
    } else {
      dir.children.set(name, { type: 'file', data: bytes, mtime: now, ctime: now })
      dir.mtime = now
      this.emit(path, 'rename')
    }
  }

  symlink(target: string, p: string): void {
    const { dir, name, path } = this.parentOf(p, 'symlink')
    if (dir.children.has(name)) throw new FsError('EEXIST', 'symlink', p)
    const now = Date.now()
    dir.children.set(name, { type: 'symlink', target, mtime: now, ctime: now })
    this.emit(path, 'rename')
  }

  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const path = normalize('/' + this.split(p).join('/'))
    if (path === '/') {
      if (!opts.recursive) throw new FsError('EISDIR', 'rm', p)
      for (const k of [...this.root.children.keys()]) this.rm('/' + k, opts)
      return
    }
    const parent = this.lookup(dirname(path))
    const name = basename(path)
    const n = parent?.type === 'dir' ? parent.children.get(name) : undefined
    if (!n || parent?.type !== 'dir') {
      if (opts.force) return
      throw new FsError('ENOENT', 'rm', p)
    }
    if (n.type === 'dir' && n.children.size && !opts.recursive) throw new FsError('ENOTEMPTY', 'rmdir', p)
    if (n.type === 'dir' && !opts.recursive && !n.children.size) {
      /* empty dir ok with rmdir semantics */
    }
    parent.children.delete(name)
    parent.mtime = Date.now()
    this.emit(path, 'rename')
  }

  unlink(p: string): void {
    const n = this.lookup(p, false)
    if (!n) throw new FsError('ENOENT', 'unlink', p)
    if (n.type === 'dir') throw new FsError('EISDIR', 'unlink', p)
    this.rm(p)
  }

  rmdir(p: string): void {
    const n = this.lookup(p, false)
    if (!n) throw new FsError('ENOENT', 'rmdir', p)
    if (n.type !== 'dir') throw new FsError('ENOTDIR', 'rmdir', p)
    if (n.children.size) throw new FsError('ENOTEMPTY', 'rmdir', p)
    this.rm(p)
  }

  rename(from: string, to: string): void {
    const a = this.parentOf(from, 'rename')
    const n = a.dir.children.get(a.name)
    if (!n) throw new FsError('ENOENT', 'rename', from)
    const b = this.parentOf(to, 'rename')
    if (b.path === a.path) return
    if (n.type === 'dir' && (b.path + '/').startsWith(a.path + '/')) throw new FsError('EINVAL', 'rename', from)
    const existing = b.dir.children.get(b.name)
    if (existing?.type === 'dir' && existing.children.size) throw new FsError('ENOTEMPTY', 'rename', to)
    a.dir.children.delete(a.name)
    b.dir.children.set(b.name, n)
    a.dir.mtime = b.dir.mtime = Date.now()
    this.emit(a.path, 'rename')
    this.emit(b.path, 'rename')
  }

  copyFile(from: string, to: string): void {
    this.writeFile(to, this.readFile(from).slice())
  }

  /** Recursively copy a file or directory. */
  cp(from: string, to: string): void {
    const s = this.stat(from)
    if (s.isDirectory()) {
      this.mkdir(to, { recursive: true })
      for (const name of this.readdir(from)) this.cp(`${from}/${name}`, `${to}/${name}`)
    } else this.copyFile(from, to)
  }

  utimes(p: string, mtime: number): void {
    const n = this.lookup(p)
    if (!n) throw new FsError('ENOENT', 'utime', p)
    n.mtime = mtime
  }

  /** Walk all files under dir (absolute paths). */
  *walk(dir: string, skip?: (path: string, isDir: boolean) => boolean): Generator<string> {
    const n = this.lookup(dir)
    if (!n || n.type !== 'dir') return
    for (const [name, c] of n.children) {
      const p = dir === '/' ? `/${name}` : `${dir}/${name}`
      const isDir = c.type === 'dir'
      if (skip?.(p, isDir)) continue
      if (isDir) yield* this.walk(p, skip)
      else yield p
    }
  }

  // ---- watching ----
  watch(path: string, opts: { recursive?: boolean }, fn: WatchListener): { close(): void } {
    const w: Watcher = { path: normalize('/' + this.split(path).join('/')), recursive: !!opts.recursive, fn }
    this.watchers.add(w)
    return { close: () => void this.watchers.delete(w) }
  }

  private emit(path: string, event: WatchEvent): void {
    for (const w of this.watchers) {
      const base = w.path === '/' ? '' : w.path
      if (path === w.path) {
        w.fn(event, basename(path))
        continue
      }
      if (!path.startsWith(base + '/')) continue
      const rel = path.slice(base.length + 1)
      if (!w.recursive && rel.includes('/')) continue
      try {
        w.fn(event, rel)
      } catch (e) {
        console.error(e)
      }
    }
  }
}
