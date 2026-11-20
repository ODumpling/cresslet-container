// Node-style module resolution over any sync file system (VFS on main thread, RPC fs in workers).
import { dirname, join, normalize } from './path'

export interface ResolveFs {
  isFile(p: string): boolean
  isDir(p: string): boolean
  readText(p: string): string | null
  /** Real path (symlinks resolved): linked packages (workspaces) then resolve their imports from where they are. */
  realpath?(p: string): string
}

export interface ResolveOptions {
  conditions: string[]
  extensions: string[]
  /** Honour package.json "browser" field. */
  browser?: boolean
  mainFields: string[]
}

export const BROWSER_OPTS: ResolveOptions = {
  conditions: ['browser', 'import', 'module', 'development', 'default'],
  extensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.cjs', '.json', '.css'],
  browser: true,
  mainFields: ['browser', 'module', 'main'],
}
export const NODE_OPTS: ResolveOptions = {
  conditions: ['node', 'require', 'default'],
  extensions: ['.js', '.json', '.cjs', '.mjs', '.ts', '.tsx', '.mts', '.cts', '.jsx', '.node'],
  mainFields: ['main'],
}

export interface PackageJson {
  name?: string
  version?: string
  main?: string
  module?: string
  browser?: string | Record<string, string | false>
  exports?: unknown
  imports?: unknown
  type?: string
  bin?: string | Record<string, string>
  [k: string]: unknown
}

export class ResolveError extends Error {
  code = 'MODULE_NOT_FOUND'
}

/** Result `false` means the module is intentionally empty (browser field mapping). */
export type Resolved = string | false

const pkgCache = new WeakMap<ResolveFs, Map<string, PackageJson | null>>()

export function readPackageJson(fs: ResolveFs, dir: string): PackageJson | null {
  let cache = pkgCache.get(fs)
  if (!cache) pkgCache.set(fs, (cache = new Map()))
  const p = join(dir, 'package.json')
  if (cache.has(p)) return cache.get(p)!
  const txt = fs.readText(p)
  let pkg: PackageJson | null = null
  if (txt != null) {
    try {
      pkg = JSON.parse(txt)
    } catch {
      pkg = null
    }
  }
  cache.set(p, pkg)
  return pkg
}

export function clearPackageCache(fs: ResolveFs): void {
  pkgCache.delete(fs)
}

/** Find nearest package.json dir at or above `dir`. */
export function findPackageRoot(fs: ResolveFs, dir: string): string | null {
  for (let d = dir; ; d = dirname(d)) {
    if (fs.isFile(join(d, 'package.json'))) return d
    if (d === '/') return null
  }
}

export function isBuiltinLike(spec: string): boolean {
  return spec.startsWith('node:')
}

export function isBare(spec: string): boolean {
  return !(spec.startsWith('.') || spec.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(spec))
}

export function splitBare(spec: string): { name: string; sub: string } {
  const parts = spec.split('/')
  const n = spec.startsWith('@') ? 2 : 1
  return { name: parts.slice(0, n).join('/'), sub: parts.slice(n).join('/') }
}

function realOrSame(fs: ResolveFs, p: string): string {
  if (!fs.realpath) return p
  try {
    return fs.realpath(p)
  } catch {
    return p
  }
}

export function resolveModule(fs: ResolveFs, spec: string, fromDir: string, opts: ResolveOptions): Resolved {
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    const abs = normalize(spec.startsWith('/') ? spec : join(fromDir, spec))
    const mapped = opts.browser ? browserMap(fs, abs) : abs
    if (mapped === false) return false
    const r = resolveFileOrDir(fs, mapped, opts)
    // its real path, as node: a file reached through a link (`node node_modules/ws/cli.js`) resolves its own
    // relative imports from where it really is
    if (r) return realOrSame(fs, r)
    throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`)
  }
  if (spec.startsWith('#')) {
    const root = findPackageRoot(fs, fromDir)
    const pkg = root ? readPackageJson(fs, root) : null
    if (root && pkg?.imports) {
      const t = matchExports(pkg.imports, spec, opts.conditions)
      if (t) return isBare(t) ? resolveModule(fs, t, root, opts) : resolveModule(fs, './' + t.replace(/^\.\//, ''), root, opts)
    }
    throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`)
  }
  const { name, sub } = splitBare(spec)
  // self/browser-field mapping of bare specifiers inside the importing package
  if (opts.browser) {
    const root = findPackageRoot(fs, fromDir)
    const pkg = root ? readPackageJson(fs, root) : null
    if (pkg && typeof pkg.browser === 'object' && spec in pkg.browser) {
      const m = pkg.browser[spec]
      if (m === false) return false
      if (m !== spec) return resolveModule(fs, isBare(m) ? m : './' + m.replace(/^\.\//, ''), root!, opts)
    }
  }
  for (let d = fromDir; ; d = dirname(d)) {
    if (!d.endsWith('/node_modules')) {
      const pkgDir = join(d, 'node_modules', name)
      if (fs.isDir(pkgDir)) {
        const r = resolvePackage(fs, fs.realpath?.(pkgDir) ?? pkgDir, sub, opts)
        if (r !== null) return r
      }
    }
    if (d === '/') break
  }
  throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`)
}

/** Resolve `sub` ('' for main) within an installed package dir. null if nothing found. */
export function resolvePackage(fs: ResolveFs, pkgDir: string, sub: string, opts: ResolveOptions): Resolved | null {
  const pkg = readPackageJson(fs, pkgDir)
  if (pkg?.exports !== undefined && pkg.exports !== null) {
    const t = matchExports(pkg.exports, sub ? './' + sub : '.', opts.conditions)
    if (t) {
      const r = resolveFileOrDir(fs, join(pkgDir, t), opts)
      if (r) return opts.browser ? (browserMap(fs, r) === false ? false : r) : r
    }
    // fall through to legacy resolution (lenient, like bundlers)
  }
  if (sub) {
    const abs = join(pkgDir, sub)
    const m = opts.browser ? browserMap(fs, abs) : abs
    if (m === false) return false
    return resolveFileOrDir(fs, m, opts)
  }
  return resolveFileOrDir(fs, pkgDir, opts)
}

function resolveFileOrDir(fs: ResolveFs, abs: string, opts: ResolveOptions): string | null {
  if (fs.isFile(abs)) return abs
  for (const ext of opts.extensions) if (fs.isFile(abs + ext)) return abs + ext
  // TS-style: './foo.js' -> './foo.ts'
  const m = abs.match(/\.(m|c)?jsx?$/)
  if (m) {
    const base = abs.slice(0, -m[0].length)
    for (const ext of ['.ts', '.tsx', '.mts', '.cts']) if (fs.isFile(base + ext)) return base + ext
  }
  if (fs.isDir(abs)) {
    const pkg = readPackageJson(fs, abs)
    if (pkg) {
      for (const f of opts.mainFields) {
        let v = pkg[f]
        if (f === 'browser' && typeof v !== 'string') continue
        if (typeof v === 'string' && v) {
          const r = resolveFileOrDir(fs, join(abs, v), { ...opts, mainFields: [] })
          if (r) return r
        }
      }
    }
    for (const ext of opts.extensions) if (fs.isFile(join(abs, 'index' + ext))) return join(abs, 'index' + ext)
  }
  return null
}

/** Apply object-form "browser" field of the owning package to an absolute file path. */
function browserMap(fs: ResolveFs, abs: string): string | false {
  const root = findPackageRoot(fs, dirname(abs))
  const pkg = root ? readPackageJson(fs, root) : null
  if (!root || !pkg || typeof pkg.browser !== 'object') return abs
  const rel = './' + abs.slice(root.length + 1)
  for (const cand of [rel, rel + '.js', rel.replace(/\.js$/, '')]) {
    if (cand in pkg.browser) {
      const m = pkg.browser[cand]
      return m === false ? false : join(root, m)
    }
  }
  return abs
}

/** Match package.json exports/imports against a subpath ('.' or './x'). */
export function matchExports(exp: unknown, sub: string, conditions: string[]): string | null {
  if (typeof exp === 'string' || Array.isArray(exp) || (exp && typeof exp === 'object' && !Object.keys(exp).some((k) => k.startsWith('.') || k.startsWith('#')))) {
    return sub === '.' ? pickTarget(exp, conditions, '') : null
  }
  const map = exp as Record<string, unknown>
  if (sub in map) return pickTarget(map[sub], conditions, '')
  let best: { key: string; star: string } | null = null
  for (const key of Object.keys(map)) {
    const i = key.indexOf('*')
    if (i >= 0) {
      const pre = key.slice(0, i)
      const post = key.slice(i + 1)
      if (sub.startsWith(pre) && sub.endsWith(post) && sub.length >= key.length - 1) {
        if (!best || pre.length > best.key.indexOf('*')) best = { key, star: sub.slice(pre.length, sub.length - post.length) }
      }
    } else if (key.endsWith('/') && sub.startsWith(key)) {
      if (!best) best = { key, star: sub.slice(key.length) }
    }
  }
  if (best) {
    const t = pickTarget(map[best.key], conditions, best.star)
    if (t && best.key.endsWith('/') && !best.key.includes('*')) return t + best.star
    return t
  }
  return null
}

function pickTarget(t: unknown, conditions: string[], star: string): string | null {
  if (t === null || t === undefined) return null
  if (typeof t === 'string') return t.replace(/\*/g, star)
  if (Array.isArray(t)) {
    for (const x of t) {
      const r = pickTarget(x, conditions, star)
      if (r) return r
    }
    return null
  }
  if (typeof t === 'object') {
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (k === 'default' || conditions.includes(k)) {
        const r = pickTarget(v, conditions, star)
        if (r) return r
      }
    }
  }
  return null
}
