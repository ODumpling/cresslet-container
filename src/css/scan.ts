// Tailwind content scanning over the VFS (stand-in for Tailwind's native oxide scanner): which files are sources, and
// which class candidates they contain. Over-extraction is harmless (Tailwind ignores tokens that aren't utilities).
import type { VFS } from '../vfs'
import { join, normalize } from '../path'

/** Files Tailwind never scans: styles, lockfiles, binaries/media. */
const SKIP_EXT = /\.(css|scss|sass|less|styl|lock|log|map|png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|flac|pdf|zip|gz|tgz|br|wasm|exe|dll|so|dylib|node|db|sqlite)$/i
const SKIP_NAMES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'npm-shrinkwrap.json'])
/** Directories auto-detection skips (Tailwind skips gitignored paths; projects here rarely have a .gitignore). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out'])

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

/** Glob-free leading directory of `base/pattern`, plus a matcher (null: everything under it). */
function compileSource(base: string, pattern: string): { dir: string; match: RegExp | null } {
  const abs = normalize(pattern.startsWith('/') ? pattern : join(base, pattern))
  const segs = abs.split('/')
  const k = segs.findIndex((s) => /[*?{]/.test(s))
  if (k < 0) return { dir: abs, match: null }
  return { dir: segs.slice(0, k).join('/') || '/', match: globToRegExp(abs) }
}

interface Scope {
  dir: string
  match: RegExp | null
  /** auto-detection: skip node_modules/dist/dot-dirs; explicit `@source` paths are scanned as given */
  auto: boolean
}

/** The union of every Tailwind stylesheet's sources, and the candidates found in them (only ever grows, like Tailwind). */
export class CandidateScanner {
  private scopes: Scope[] = []
  private excludes: RegExp[] = []
  private keys = new Set<string>()
  private files = new Map<string, Set<string>>()
  readonly candidates = new Set<string>()
  private scanned = false

  constructor(
    private vfs: VFS,
    private root: string,
  ) {}

  /** Add a stylesheet's sources; returns true when that widened the scan (callers must re-request with candidates()). */
  addSources(root: SourceRoot, sources: SourceSpec[]): boolean {
    let changed = false
    const scope = (s: Scope, key: string) => {
      if (this.keys.has(key)) return
      this.keys.add(key)
      this.scopes.push(s)
      changed = true
      if (this.scanned) this.walk(s)
    }
    if (root === null) scope({ dir: this.root, match: null, auto: true }, 'auto:' + this.root)
    else if (root !== 'none') scope({ dir: normalize(join(root.base, root.pattern)), match: null, auto: true }, 'auto:' + join(root.base, root.pattern))
    for (const s of sources) {
      const c = compileSource(s.base, s.pattern)
      const key = `${s.negated ? '!' : ''}${s.base}\0${s.pattern}`
      if (s.negated) {
        if (!this.keys.has(key)) this.keys.add(key), this.excludes.push(c.match ?? new RegExp('^' + c.dir.replace(/[.+^$()|[\]\\*?{}]/g, '\\$&') + '(?:/|$)'))
      } else scope({ ...c, auto: false }, key)
    }
    return changed
  }

  /** Every candidate in every source file (scans lazily, once). */
  all(): string[] {
    if (!this.scanned) {
      this.scanned = true
      for (const s of this.scopes) this.walk(s)
    }
    return [...this.candidates]
  }

  /** Whether a changed file is a source; re-extracts it. Returns true when it brought new candidates. */
  update(file: string): boolean {
    if (!this.scanned || !this.inScope(file)) return false
    const text = this.vfs.tryReadText(file)
    if (text == null) return false
    return this.extract(file, text)
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
      return !s.auto || !this.autoSkips(file.slice(s.dir.length + 1))
    })
  }

  private isSource(file: string): boolean {
    const name = file.slice(file.lastIndexOf('/') + 1)
    return !SKIP_EXT.test(name) && !SKIP_NAMES.has(name)
  }

  private autoSkips(rel: string): boolean {
    const segs = rel.split('/')
    return segs.slice(0, -1).some((d) => SKIP_DIRS.has(d) || d.startsWith('.'))
  }

  private walk(s: Scope): void {
    const visit = (p: string, rel: string) => {
      if (this.vfs.isFile(p)) {
        if (this.isSource(p) && (!s.match || s.match.test(p)) && !this.excludes.some((r) => r.test(p)) && !this.files.has(p)) {
          const t = this.vfs.tryReadText(p)
          if (t != null && t.length < 2_000_000) this.extract(p, t)
        }
        return
      }
      if (!this.vfs.isDir(p)) return
      for (const name of this.vfs.readdir(p)) {
        if (s.auto && (SKIP_DIRS.has(name) || name.startsWith('.')) && this.vfs.isDir(join(p, name))) continue
        visit(join(p, name), rel ? rel + '/' + name : name)
      }
    }
    visit(s.dir, '')
  }
}
