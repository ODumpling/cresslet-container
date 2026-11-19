// POSIX path utilities (node:path/posix subset, also used as the `path` polyfill).

export const sep = '/'
export const delimiter = ':'

function normalizeParts(parts: string[], allowAboveRoot: boolean): string[] {
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (allowAboveRoot) out.push('..')
    } else out.push(p)
  }
  return out
}

export function isAbsolute(p: string): boolean {
  return p.startsWith('/')
}

export function normalize(p: string): string {
  if (!p) return '.'
  const abs = isAbsolute(p)
  const trailing = p.endsWith('/')
  let res = normalizeParts(p.split('/'), !abs).join('/')
  if (!res && !abs) res = '.'
  if (res && trailing) res += '/'
  return (abs ? '/' : '') + res
}

export function join(...parts: string[]): string {
  const joined = parts.filter((p) => p).join('/')
  return joined ? normalize(joined) : '.'
}

let cwdFn: () => string = () => '/'
/** Set the cwd provider used by resolve() (node worker sets process.cwd). */
export function setCwd(fn: () => string): void {
  cwdFn = fn
}

export function resolve(...parts: string[]): string {
  let res = ''
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(res); i--) {
    const p = parts[i]
    if (p) res = res ? `${p}/${res}` : p
  }
  if (!isAbsolute(res)) res = `${cwdFn()}/${res}`
  const n = '/' + normalizeParts(res.split('/'), false).join('/')
  return n
}

export function dirname(p: string): string {
  if (!p) return '.'
  const s = p.replace(/\/+$/, '')
  if (!s) return '/'
  const i = s.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return s.slice(0, i)
}

export function basename(p: string, ext?: string): string {
  const s = p.replace(/\/+$/, '')
  let b = s.slice(s.lastIndexOf('/') + 1)
  if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length)
  return b
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i <= 0 ? '' : b.slice(i)
}

export function relative(from: string, to: string): string {
  const f = resolve(from).split('/').filter(Boolean)
  const t = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/')
}

export interface ParsedPath {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

export function parse(p: string): ParsedPath {
  const root = isAbsolute(p) ? '/' : ''
  const base = basename(p)
  const ext = extname(p)
  const d = dirname(p)
  return { root, dir: d === '.' && !p.includes('/') ? '' : d, base, ext, name: ext ? base.slice(0, -ext.length) : base }
}

export function format(o: Partial<ParsedPath>): string {
  const dir = o.dir || o.root || ''
  const base = o.base || (o.name || '') + (o.ext || '')
  if (!dir) return base
  return dir === o.root ? dir + base : `${dir}/${base}`
}

export function toNamespacedPath(p: string): string {
  return p
}

const path = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  toNamespacedPath,
  posix: undefined as unknown,
  win32: undefined as unknown,
}
path.posix = path
path.win32 = path
export default path
