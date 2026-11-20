// Tailwind content scanning over the VFS (stand-in for Tailwind's native oxide scanner): which files are sources, and
// which class candidates they contain. Over-extraction is harmless (Tailwind ignores tokens that aren't utilities).
import type { VFS } from '../vfs'
import { join, normalize } from '../path'

/** Files Tailwind never scans: styles, lockfiles, binaries/media. */
const SKIP_EXT = /\.(css|scss|sass|less|styl|lock|log|map|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|flac|pdf|zip|gz|tgz|br|wasm|exe|dll|so|dylib|node|db|sqlite)$/i
const SKIP_NAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json'])
/** Auto-detection skips these directories at any depth (Tailwind skips gitignored paths; projects here rarely have a .gitignore)... */
const SKIP_ANY_DIRS = new Set(['node_modules'])
/** ...and these only at the scope root (a `src/build/` or `components/out/` folder is source). */
const SKIP_ROOT_DIRS = new Set(['dist', 'build', 'coverage', 'out'])
/** Larger files aren't sources (generated bundles, data dumps): checked before reading/decoding. */
const MAX_FILE = 2_000_000
/** Yield to the event loop this often (ms) while walking a large tree. */
const SLICE_MS = 8

/** Class-candidate tokens in a source file. */
export function extractCandidates(text: string, into = new Set<string>()): Set<string> {
  // split on characters that can't be part of a class: whitespace, quotes, braces
  for (const raw of text.split(/[\s"'`{};\\]+/)) {
    if (!raw || raw.length > 200) continue
    add(raw, into)
    // `cn(a,b)`, `x=y`, `<p>flex</p>`: the pieces too (the whole token stays for `w-[calc(1px)]`, `[&>*]:p-4`)
    if (/[(),=<>]/.test(raw)) for (const p of raw.split(/[(),=<>]+/)) if (p !== raw) add(p, into)
  }
  return into
}

function add(tok: string, into: Set<string>) {
  // trailing punctuation from prose / code (`flex,` `p-4.`); a `)` only when it closes nothing in the token
  let t = tok.replace(/^[,:(]+/, '').replace(/[,.:]+$/, '')
  if (!t.includes('(')) t = t.replace(/\)+$/, '').replace(/[,.:]+$/, '')
  if (t && /[a-z]/i.test(t)) into.add(t)
}

export interface SourceSpec {
  base: string
  pattern: string
  negated: boolean
}
/** compile()'s `root`: null = auto-detect from the project root, 'none' = `source(none)`, or `source("dir")`. */
export type SourceRoot = null | 'none' | { base: string; pattern: string }
/** One stylesheet's source rules: one entry per Tailwind compile it ran (usually one). */
export type SourceRules = { root: SourceRoot; sources: SourceSpec[] }[]
export const rulesKey = (rules: SourceRules): string => JSON.stringify(rules.map((r) => [r.root, r.sources.map((s) => [s.base, s.pattern, s.negated])]))

/** Minimal glob -> RegExp (`**`, `*`, `?`, `{a,b}`), matched against an absolute path. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (ch === '?') re += '[^/]'
    else if (ch === '{') {
      const end = glob.indexOf('}', i)
      if (end < 0) re += '\\{'
      else {
        re += '(?:' + glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'
        i = end
      }
    } else re += /[.+^$()|[\]\\]/.test(ch) ? '\\' + ch : ch
  }
  return new RegExp('^' + re + '$')
}

/** No trailing slash (`source("./src/")`): scope prefixes are matched as `dir + '/'`. */
const trimDir = (p: string) => p.replace(/(?<=.)\/+$/, '')
/** isFile/isDir that treat errors (a symlink loop: ELOOP) as neither. */
const kind = (vfs: VFS, p: string): 'file' | 'dir' | null => {
  try {
    return vfs.isFile(p) ? 'file' : vfs.isDir(p) ? 'dir' : null
  } catch {
    return null
  }
}

/** Glob-free leading directory of `base/pattern`, plus a matcher (null: everything under it). */
function compileSource(base: string, pattern: string): { dir: string; match: RegExp | null } {
  const abs = trimDir(normalize(pattern.startsWith('/') ? pattern : join(base, pattern)))
  const segs = abs.split('/')
  const k = segs.findIndex((s) => /[*?{]/.test(s))
  if (k < 0) return { dir: abs, match: null }
  return { dir: segs.slice(0, k).join('/') || '/', match: globToRegExp(abs) }
}

interface Scope {
  dir: string
  match: RegExp | null
  /** auto-detection: skip node_modules/dot-dirs (+ dist/build/out/coverage at its root); explicit `@source` paths are scanned as given */
  auto: boolean
}

let scannerIds = 0
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** One set of source rules (a stylesheet's), and the candidates found in its sources (only ever grows, like Tailwind). */
export class CandidateScanner {
  /** Unique per scanner: names its candidate set in the CSS worker. */
  readonly id = ++scannerIds
  private scopes: Scope[] = []
  private excludes: RegExp[] = []
  private files = new Map<string, Set<string>>()
  readonly candidates = new Set<string>()
  private scan: Promise<void> | null = null

  constructor(
    private vfs: VFS,
    private root: string,
    rules: SourceRules = [{ root: null, sources: [] }],
  ) {
    const keys = new Set<string>()
    const scope = (s: Scope, key: string) => {
      if (!keys.has(key)) keys.add(key), this.scopes.push(s)
    }
    for (const r of rules) {
      if (r.root === null) scope({ dir: this.root, match: null, auto: true }, 'auto:' + this.root)
      else if (r.root !== 'none') {
        const dir = trimDir(normalize(join(r.root.base, r.root.pattern)))
        scope({ dir, match: null, auto: true }, 'auto:' + dir)
      }
      for (const s of r.sources) {
        const c = compileSource(s.base, s.pattern)
        const key = `${s.negated ? '!' : ''}${s.base}\0${s.pattern}`
        if (!s.negated) scope({ ...c, auto: false }, key)
        else if (!keys.has(key)) keys.add(key), this.excludes.push(c.match ?? new RegExp('^' + c.dir.replace(/[.+^$()|[\]\\*?{}]/g, '\\$&') + '(?:/|$)'))
      }
    }
  }

  /** Every candidate in every source file (scans once, lazily, yielding between slices of a large tree). */
  async all(): Promise<string[]> {
    this.scan ??= this.walkAll()
    await this.scan
    return [...this.candidates]
  }

  /**
   * A file changed: re-extract it if it's a source. Applies as soon as the scan has started (the walk skips files this
   * already read); before that the scan will read it. Returns true when it brought new candidates.
   */
  update(file: string): boolean {
    if (!this.scan || !this.inScope(file)) return false
    const text = this.read(file)
    if (text == null) {
      this.files.delete(file)
      return false
    }
    return this.extract(file, text)
  }

  private read(file: string): string | null {
    try {
      if (this.vfs.stat(file).size > MAX_FILE) return null
    } catch {
      return null
    }
    return this.vfs.tryReadText(file)
  }

  private extract(file: string, text: string): boolean {
    const found = extractCandidates(text)
    this.files.set(file, found)
    const before = this.candidates.size
    for (const t of found) this.candidates.add(t)
    return this.candidates.size > before
  }

  private inScope(file: string): boolean {
    if (!this.isSource(file) || this.excludes.some((r) => r.test(file))) return false
    return this.scopes.some((s) => {
      if (file !== s.dir && !file.startsWith(s.dir === '/' ? '/' : s.dir + '/')) return false
      if (s.match && !s.match.test(file)) return false
      return !s.auto || !autoSkips(file.slice(s.dir === '/' ? 1 : s.dir.length + 1))
    })
  }

  private isSource(file: string): boolean {
    const name = file.slice(file.lastIndexOf('/') + 1)
    return !SKIP_EXT.test(name) && !SKIP_NAMES.has(name)
  }

  private async walkAll(): Promise<void> {
    let t = now()
    for (const s of this.scopes) {
      let scopeReal: string
      try {
        scopeReal = this.vfs.realpath(s.dir)
      } catch {
        continue
      }
      // real paths of directories walked: a directory symlink into one of them (an ancestor, a loop, a second path to
      // the same tree) or above the scope is not followed
      const seen = new Set<string>()
      const stack: { path: string; real: string; top: boolean }[] = []
      const k = kind(this.vfs, s.dir)
      if (k === 'file') this.visitFile(s, s.dir)
      else if (k === 'dir') stack.push({ path: s.dir, real: scopeReal, top: true })
      while (stack.length) {
        const d = stack.pop()!
        if (seen.has(d.real)) continue
        seen.add(d.real)
        let entries
        try {
          entries = this.vfs.readdirEntries(d.path)
        } catch {
          continue
        }
        for (const e of entries) {
          const p = d.path === '/' ? '/' + e.name : d.path + '/' + e.name
          let dir = e.isDirectory()
          if (e.isSymbolicLink()) {
            const k = kind(this.vfs, p)
            if (!k) continue // dangling, or a loop
            dir = k === 'dir'
          }
          if (dir) {
            if (s.auto && (SKIP_ANY_DIRS.has(e.name) || e.name.startsWith('.') || (d.top && SKIP_ROOT_DIRS.has(e.name)))) continue
            let real = p
            if (e.isSymbolicLink()) {
              try {
                real = this.vfs.realpath(p)
              } catch {
                continue
              }
              if (seen.has(real) || scopeReal === real || scopeReal.startsWith(real === '/' ? '/' : real + '/') || d.real.startsWith(real + '/')) continue
            } else real = d.real === '/' ? '/' + e.name : d.real + '/' + e.name
            stack.push({ path: p, real, top: false })
          } else this.visitFile(s, p)
          if (now() - t > SLICE_MS) {
            await tick()
            t = now()
          }
        }
      }
    }
  }

  private visitFile(s: Scope, p: string): void {
    if (this.files.has(p) || !this.isSource(p) || (s.match && !s.match.test(p)) || this.excludes.some((r) => r.test(p))) return
    const t = this.read(p)
    if (t != null) this.extract(p, t)
  }
}

/** Auto-detection: whether a path relative to the scope dir is in a skipped directory. */
function autoSkips(rel: string): boolean {
  const segs = rel.split('/').slice(0, -1)
  return (segs.length > 0 && SKIP_ROOT_DIRS.has(segs[0])) || segs.some((d) => SKIP_ANY_DIRS.has(d) || d.startsWith('.'))
}
