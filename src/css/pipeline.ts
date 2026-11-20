// CSS processing shared by the dev server and build: PostCSS (project config) and Tailwind CSS v4, run by a
// long-lived CSS worker (a `node` process running ./worker.cjs over the project's own packages).
import type { Container } from '../container'
import type { VFS } from '../vfs'
import { join } from '../path'
import { Channel, type CommandContext } from '../process'
import { runNode } from '../node/host'
import { CandidateScanner, rulesKey, type SourceRules } from './scan'
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
  /** Every candidate for this stylesheet (the backend sends the worker only what it hasn't seen for `candidateSet`). */
  candidates: string[]
  /** Names an append-only candidate set (one per scanner): the worker accumulates it across requests. */
  candidateSet?: string
  /** Owner of the worker-side state (compilers, candidate sets): a dev server, or one build. */
  session?: string
  /** Only report the stylesheet's Tailwind source rules (no utilities built): the caller then scans those sources. */
  discover?: boolean
  postcssConfig: string | null
  env: 'development' | 'production'
  /** The project depends on Tailwind: a PostCSS config without a Tailwind plugin still gets v4 compiled. */
  tailwind?: boolean
  /** false: project code (`@plugin`, `@config`) is not run (`boot({ cssPlugins: false })`). */
  plugins?: boolean
}
export interface CssResult {
  css: string
  /** absolute paths the output depends on (Tailwind imports/plugins/configs, PostCSS `dependency` messages) */
  deps: string[]
  /** directories whose files the output depends on (PostCSS `dir-dependency`, e.g. Tailwind v3 content globs) */
  dirs: string[]
  /** one entry per Tailwind compile that ran: its `@source`s and `source(...)` root */
  tailwind: SourceRules
  warnings: string[]
}
/**
 * A failed request: what the compile had read (or tried to) before it failed, so changing/creating those retries it.
 * `restarted`: a restart (config/plugins changed) cut it off; the caller sends it again with its current mode.
 */
export type CssError = Error & { deps?: string[]; dirs?: string[]; restarted?: boolean }
/** Where requests run: the node worker in the container; in-process in tests. */
export interface CssBackend {
  process(req: CssRequest): Promise<CssResult>
  /** Drop the worker (plugins/config changed); the next request starts a fresh one. */
  restart(): void
  /** Forget a session's worker-side state (its dev server closed / its build finished). */
  release?(session: string): void
}

export interface CssMode {
  postcssConfig: string | null
  tailwind: boolean
}

export function detectCssMode(vfs: VFS, root: string, plugins = true): CssMode {
  const postcssConfig = plugins ? (POSTCSS_CONFIGS.map((f) => join(root, f)).find((p) => vfs.isFile(p)) ?? null) : null
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
  /** the scanner (source rules key) whose candidates the output was built from: re-process when it grows; null: none */
  scanner: string | null
}

let sessions = 0

export class CssPipeline {
  mode: CssMode
  /** Names this pipeline's state in the worker: a build gets a fresh one (no classes from dev or earlier builds). */
  readonly session: string
  /** One scanner per distinct set of source rules: stylesheets with different `@source`/`source()` don't mix. */
  private scanners = new Map<string, CandidateScanner>()
  /** Last source rules seen per stylesheet (for its text): known before its first candidate build. null: no Tailwind v4. */
  private rules = new Map<string, { css: string; key: string | null; rules: SourceRules }>()
  /** Bumped whenever a scanner gains candidates (a build that read the old ones is stale). */
  revision = 0
  private plugins: boolean
  private released = false
  /** Bumped by reset(): a request prepared under an older mode is prepared again. */
  private generation = 0

  constructor(
    private c: Pick<Container, 'vfs' | 'cssWorker'> & { cssPlugins?: boolean },
    private root: string,
    private env: CssRequest['env'],
  ) {
    this.plugins = c.cssPlugins !== false
    this.session = `${env}-${++sessions}-${Math.random().toString(36).slice(2, 8)}`
    this.mode = detectCssMode(c.vfs, root, this.plugins)
  }

  get active(): boolean {
    return !!this.mode.postcssConfig || this.mode.tailwind
  }

  /** Re-detect after package.json / PostCSS config / node_modules changes. */
  reset(): void {
    this.mode = detectCssMode(this.c.vfs, this.root, this.plugins)
    this.generation++
    this.scanners.clear()
    this.rules.clear()
    this.c.cssWorker().restart()
  }

  /** Free this pipeline's worker-side state. */
  release(): void {
    this.released = true
    this.c.cssWorker().release?.(this.session)
  }

  needs(text: string): boolean {
    return !!this.mode.postcssConfig || (this.mode.tailwind && TAILWIND_RE.test(text))
  }

  /** A project file changed: the scanners whose candidates it grew (their stylesheets need re-serving). */
  update(file: string): string[] {
    const grown: string[] = []
    for (const [k, s] of this.scanners) if (s.update(file)) grown.push(k)
    if (grown.length) this.revision++
    return grown
  }

  async process(file: string, css: string): Promise<CssProcessed> {
    if (!this.needs(css)) return { css, deps: [], dirs: [], scanner: null }
    let known = this.rules.get(file)
    if (known && known.css !== css) known = undefined
    let r!: CssResult
    for (let attempt = 0, restarts = 0; attempt < 4; attempt++) {
      // the stylesheet's source rules come first (a discovery request when they aren't known for this text), so its
      // first build already has the candidates of exactly its sources
      if (restarts && !this.needs(css)) return { css, deps: [], dirs: [], scanner: null } // the new mode doesn't process it
      const gen = this.generation
      const scanner = this.mode.tailwind && known?.key != null ? this.scannerFor(known.key, known.rules) : null
      const discover = this.mode.tailwind && !known
      const candidates = scanner ? await scanner.all() : []
      // closed meanwhile (dev server closed, build done): nothing may recreate its worker-side state
      if (this.released) throw new Error('CSS pipeline closed')
      if (gen !== this.generation && ++restarts <= 3) {
        // reset during the scan: prepare it again under the new mode (rules and scanners were cleared)
        known = undefined
        attempt--
        continue
      }
      try {
        r = await this.c.cssWorker().process({
          root: this.root,
          file,
          css,
          candidates,
          candidateSet: scanner ? `${this.session}:${scanner.id}` : undefined,
          session: this.session,
          discover,
          postcssConfig: this.mode.postcssConfig,
          env: this.env,
          tailwind: this.mode.tailwind,
          plugins: this.plugins,
        })
      } catch (e) {
        // cut off by a reset: again with the mode (config path) and rules as they are now
        if (!(e as CssError).restarted || this.released || ++restarts > 3) throw e
        known = this.rules.get(file) // cleared by our reset (another pipeline's restart keeps them)
        if (known && known.css !== css) known = undefined
        attempt--
        continue
      }
      if (this.released) throw new Error('CSS pipeline closed')
      const key = r.tailwind.length ? rulesKey(r.tailwind) : null
      const done = discover ? key === null : key === (known?.key ?? null) || !this.mode.tailwind
      this.rules.set(file, (known = { css, key, rules: r.tailwind }))
      if (done) break
    }
    for (const w of r.warnings) console.warn(`[cresslet] ${file}: ${w}`)
    return { css: r.css, deps: r.deps, dirs: r.dirs ?? [], scanner: known?.key ?? null }
  }

  private scannerFor(key: string, rules: SourceRules): CandidateScanner {
    let s = this.scanners.get(key)
    if (!s) this.scanners.set(key, (s = new CandidateScanner(this.c.vfs, this.root, rules)))
    return s
  }
}

const WORKER_PATH = '/tmp/.cresslet/css-worker.cjs'
const MARK = '\u0000cresslet-css\u0000'
const TIMEOUT_MS = 30_000

/** A running CSS worker: JSON lines in, output to the `io` callbacks. */
export interface CssWorkerProcess {
  write(line: string): void
  kill(): void
  exited: Promise<number>
}
export type CssWorkerSpawn = (io: { stdout(s: string): void; stderr(s: string): void }) => CssWorkerProcess

/** The default: a `node` process in the container running ./worker.cjs. */
function containerSpawn(c: Container): CssWorkerSpawn {
  return (io) => {
    c.vfs.writeFile(WORKER_PATH, workerSource, { mkdirp: true })
    const stdin = new Channel()
    const abort = new AbortController()
    const ctx: CommandContext = {
      args: [],
      cwd: c.workdir,
      env: { NODE_ENV: 'development', HOME: '/home', PATH: '/usr/local/bin:/usr/bin:/bin' },
      stdout: { write: io.stdout },
      stderr: { write: io.stderr },
      stdin,
      signal: abort.signal,
      container: c,
    }
    return {
      write: (s) => stdin.push(s),
      kill: () => (stdin.close(), abort.abort()),
      exited: runNode(ctx, WORKER_PATH, []),
    }
  }
}

/**
 * The container's CSS worker: one `node` process, started on first use, JSON lines over stdin/stdout. It handles
 * requests in order; the one it is on has a timeout (the worker is recycled, the others are retried once on a new
 * one). A restart rejects pending requests as `restarted` (the pipeline sends them again with its new mode). Candidate
 * sets go over as deltas (per worker instance: a new worker gets the whole set).
 */
export function nodeCssBackend(c: Container, o: { timeoutMs?: number; spawn?: CssWorkerSpawn } = {}): CssBackend & { close(): void } {
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS
  const spawn = o.spawn ?? containerSpawn(c)
  type Job = { req: CssRequest; resolve: (r: CssResult) => void; reject: (e: Error) => void; retried: boolean; timer?: ReturnType<typeof setTimeout> }
  type Proc = { w: CssWorkerProcess; pending: Map<number, Job>; sent: Map<string, number> }
  let proc: Proc | null = null
  let nextId = 0
  let closed = false

  const start = (): Proc => {
    const me: Proc = { w: null as unknown as CssWorkerProcess, pending: new Map(), sent: new Map() }
    let buf = ''
    let errTail = ''
    me.w = spawn({
      stdout: (s) => {
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
          const job = me.pending.get(m.id)
          if (!job) continue
          me.pending.delete(m.id)
          clearTimeout(job.timer)
          arm(me)
          if (m.ok) job.resolve(m)
          else job.reject(Object.assign(new Error(m.error), { deps: m.deps ?? [], dirs: m.dirs ?? [] }))
        }
      },
      stderr: (s) => void ((errTail = (errTail + s).slice(-4000)), console.warn('[cresslet css]', s.trimEnd())),
    })
    me.w.exited.then((code) => {
      if (proc === me) proc = null
      const err = new Error(`CSS worker exited with code ${code}${errTail.trim() ? `:\n${errTail.trim()}` : ''}`)
      for (const j of me.pending.values()) clearTimeout(j.timer), j.reject(err)
      me.pending.clear()
    })
    return me
  }

  const send = (job: Job) => {
    if (closed) return job.reject(new Error('CSS worker closed'))
    const me = (proc ??= start())
    const id = ++nextId
    me.pending.set(id, job)
    let { candidates } = job.req
    let reset = false
    const set = job.req.candidateSet
    if (set) {
      const from = me.sent.get(set) ?? 0
      if (from > candidates.length) reset = true // not an extension of what was sent: replace
      else candidates = candidates.slice(from)
      me.sent.set(set, job.req.candidates.length)
    }
    me.w.write(JSON.stringify({ id, ...job.req, candidates, candidatesReset: reset || undefined }) + '\n')
    arm(me)
  }

  /** The worker handles requests in order: the timeout runs for the one it is on (the oldest pending), not the queue. */
  const arm = (me: Proc) => {
    const first = me.pending.entries().next()
    if (first.done || first.value[1].timer) return
    const [id, job] = first.value
    job.timer = setTimeout(() => {
      if (me.pending.get(id) !== job) return
      me.pending.delete(id)
      job.reject(new Error(`CSS worker timed out after ${Math.round(timeoutMs / 1000)}s processing ${job.req.file} (a PostCSS plugin or Tailwind plugin/config that never finishes?); the worker was restarted`))
      recycle(me, 'retry')
    }, timeoutMs)
  }

  /** Stop a worker. Its pending requests: retried once on a new one (a timeout), or rejected (a restart, close). */
  const recycle = (me: Proc, then: 'retry' | 'restarted' | 'closed') => {
    if (proc === me) proc = null
    me.w.kill()
    const jobs = [...me.pending.values()]
    me.pending.clear()
    for (const j of jobs) {
      clearTimeout(j.timer)
      j.timer = undefined
      if (then === 'retry' && !j.retried && !closed) {
        j.retried = true
        send(j)
      } else j.reject(Object.assign(new Error('CSS worker restarted'), { restarted: then === 'restarted' }))
    }
  }

  return {
    process: (req) => new Promise<CssResult>((resolve, reject) => send({ req, resolve, reject, retried: false })),
    restart: () => void (proc && recycle(proc, 'restarted')),
    release(session) {
      if (!proc) return
      // its requests still queued are never replayed on another worker (a timeout recycling this one)
      for (const [id, j] of proc.pending) {
        if (j.req.session !== session || j.timer) continue
        proc.pending.delete(id)
        j.reject(new Error('CSS pipeline closed'))
      }
      for (const k of proc.sent.keys()) if (k.startsWith(session + ':')) proc.sent.delete(k)
      proc.w.write(JSON.stringify({ op: 'release', session }) + '\n')
    },
    close() {
      closed = true
      if (proc) recycle(proc, 'closed')
    },
  }
}
