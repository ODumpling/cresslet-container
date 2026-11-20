// CSS processing shared by the dev server and build: PostCSS (project config) and Tailwind CSS v4, run by a
// long-lived CSS worker (a `node` process running ./worker.cjs over the project's own packages).
import type { Container } from '../container'
import type { VFS } from '../vfs'
import { join } from '../path'
import { Channel, type CommandContext } from '../process'
import { runNode } from '../node/host'
import { CandidateScanner, type SourceRoot, type SourceSpec } from './scan'
import workerSource from './worker.cjs?raw'

/** CSS that needs Tailwind (keep in sync with TAILWIND_RE in worker.cjs). */
export const TAILWIND_RE = /@(?:import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']|tailwind\b|theme\b|apply\b|utility\b|variant\b|custom-variant\b|plugin\b|config\b|source\b|reference\b)|--(?:theme|spacing|alpha)\(/

export const POSTCSS_CONFIGS = ['postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs', 'postcss.config.ts', 'postcss.config.mts', '.postcssrc.js', '.postcssrc.cjs', '.postcssrc.mjs', '.postcssrc.json']
/** Files whose change re-detects the CSS mode (and restarts the worker). */
export const CSS_CONFIG_RE = /^(postcss\.config\.[mc]?[jt]s|\.postcssrc(\.[mc]?js|\.json)?)$/

export interface CssRequest {
  root: string
  file: string
  css: string
  candidates: string[]
  postcssConfig: string | null
  env: 'development' | 'production'
}
export interface CssResult {
  css: string
  /** absolute paths the output depends on (Tailwind imports/plugins/configs, PostCSS `dependency` messages) */
  deps: string[]
  /** directories whose files the output depends on (PostCSS `dir-dependency`, e.g. Tailwind v3 content globs) */
  dirs: string[]
  /** one entry per Tailwind compile that ran: its `@source`s and `source(...)` root */
  tailwind: { sources: SourceSpec[]; root: SourceRoot }[]
  warnings: string[]
}
/** Where requests run: the node worker in the container; in-process in tests. */
export interface CssBackend {
  process(req: CssRequest): Promise<CssResult>
  /** Drop the worker (plugins/config changed); the next request starts a fresh one. */
  restart(): void
}

export interface CssMode {
  postcssConfig: string | null
  tailwind: boolean
}

export function detectCssMode(vfs: VFS, root: string): CssMode {
  const postcssConfig = POSTCSS_CONFIGS.map((f) => join(root, f)).find((p) => vfs.isFile(p)) ?? null
  let deps: Record<string, string> = {}
  try {
    const j = JSON.parse(vfs.tryReadText(join(root, 'package.json')) ?? '{}')
    deps = { ...j.devDependencies, ...j.dependencies }
  } catch {
    /* ignore */
  }
  return { postcssConfig, tailwind: !!(deps.tailwindcss || deps['@tailwindcss/postcss'] || deps['@tailwindcss/vite'] || deps['@tailwindcss/cli']) }
}

export interface CssProcessed {
  css: string
  deps: string[]
  dirs: string[]
  /** output depends on project sources (Tailwind content scanning): re-process when they bring new candidates */
  content: boolean
}

export class CssPipeline {
  mode: CssMode
  scanner: CandidateScanner

  constructor(
    private c: Pick<Container, 'vfs' | 'cssWorker'>,
    private root: string,
    private env: CssRequest['env'],
  ) {
    this.mode = detectCssMode(c.vfs, root)
    this.scanner = this.newScanner()
  }

  get active(): boolean {
    return !!this.mode.postcssConfig || this.mode.tailwind
  }

  /** Re-detect after package.json / PostCSS config / node_modules changes. */
  reset(): void {
    this.mode = detectCssMode(this.c.vfs, this.root)
    this.scanner = this.newScanner()
    this.c.cssWorker().restart()
  }

  needs(text: string): boolean {
    return !!this.mode.postcssConfig || (this.mode.tailwind && TAILWIND_RE.test(text))
  }

  async process(file: string, css: string): Promise<CssProcessed> {
    if (!this.needs(css)) return { css, deps: [], dirs: [], content: false }
    const scanner = this.scanner
    const req = (): CssRequest => ({ root: this.root, file, css, candidates: this.mode.tailwind ? scanner.all() : [], postcssConfig: this.mode.postcssConfig, env: this.env })
    let r = await this.c.cssWorker().process(req())
    if (r.tailwind.length) {
      let widened = false
      for (const t of r.tailwind) widened = scanner.addSources(t.root, t.sources) || widened
      // `@source` / `source("dir")` reach files the default scan didn't: build again with their candidates
      if (widened) r = await this.c.cssWorker().process(req())
    }
    for (const w of r.warnings) console.warn(`[cresslet] ${file}: ${w}`)
    return { css: r.css, deps: r.deps, dirs: r.dirs ?? [], content: r.tailwind.length > 0 }
  }

  private newScanner() {
    const s = new CandidateScanner(this.c.vfs, this.root)
    s.addSources(null, []) // Tailwind's automatic source detection: the project root
    return s
  }
}

const WORKER_PATH = '/tmp/.cresslet/css-worker.cjs'
const MARK = '\u0000cresslet-css\u0000'

/** The container's CSS worker: one `node` process, started on first use, JSON lines over stdin/stdout. */
export function nodeCssBackend(c: Container): CssBackend & { close(): void } {
  type Pending = { resolve: (r: CssResult) => void; reject: (e: Error) => void }
  let proc: { stdin: Channel; abort: AbortController; pending: Map<number, Pending> } | null = null
  let nextId = 0

  const start = () => {
    c.vfs.writeFile(WORKER_PATH, workerSource, { mkdirp: true })
    const stdin = new Channel()
    const abort = new AbortController()
    const pending = new Map<number, Pending>()
    const me = { stdin, abort, pending }
    let buf = ''
    let errTail = ''
    const ctx: CommandContext = {
      args: [],
      cwd: c.workdir,
      env: { NODE_ENV: 'development', HOME: '/home', PATH: '/usr/local/bin:/usr/bin:/bin' },
      stdout: {
        write: (s) => {
          buf += s
          let i
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i)
            buf = buf.slice(i + 1)
            const k = line.indexOf(MARK)
            if (k < 0) {
              if (line.trim()) console.log('[cresslet css]', line)
              continue
            }
            if (k > 0) console.log('[cresslet css]', line.slice(0, k))
            const m = JSON.parse(line.slice(k + MARK.length)) as { id: number; ok: boolean; error?: string } & CssResult
            const p = pending.get(m.id)
            if (!p) continue
            pending.delete(m.id)
            if (m.ok) p.resolve(m)
            else p.reject(new Error(m.error))
          }
        },
      },
      stderr: { write: (s) => void ((errTail = (errTail + s).slice(-4000)), console.warn('[cresslet css]', s.trimEnd())) },
      stdin,
      signal: abort.signal,
      container: c,
    }
    runNode(ctx, WORKER_PATH, []).then((code) => {
      if (proc === me) proc = null
      const err = new Error(`CSS worker exited with code ${code}${errTail.trim() ? `:\n${errTail.trim()}` : ''}`)
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    })
    return me
  }

  const stop = () => {
    if (!proc) return
    const p = proc
    proc = null
    p.stdin.close()
    p.abort.abort()
    for (const q of p.pending.values()) q.reject(new Error('CSS worker restarted'))
    p.pending.clear()
  }

  return {
    process(req) {
      proc ??= start()
      const p = proc
      const id = ++nextId
      return new Promise<CssResult>((resolve, reject) => {
        p.pending.set(id, { resolve, reject })
        p.stdin.push(JSON.stringify({ id, ...req }) + '\n')
      })
    },
    restart: stop,
    close: stop,
  }
}
