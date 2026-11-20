// Host side of `child_process`: a node process's children run as container commands (jsh builtins, `node`, `npm`,
// registered commands, files on PATH), the way jsh runs them, with their stdio piped back to the worker. Children
// die with their parent process. Spawn requests may come from the preview relay (untrusted), so they're validated.
import type { CommandContext, Writer } from '../process'
import { Channel, errorMessage } from '../process'
import { basename, dirname, resolve } from '../path'
import { Shell } from '../shell/jsh'
import type { ChildEvent, ChildSpec, ChildStdio, ChildSyncResult } from './protocol'

const STDIO = new Set<unknown>(['pipe', 'inherit', 'ignore'])
const BIN_DIRS = new Set(['/usr/local/bin', '/usr/bin', '/bin'])
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** A spawn request from the worker, or null when malformed. */
export function parseSpec(m: unknown): ChildSpec | null {
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  if (typeof o.file !== 'string' || !o.file || !isStrings(o.args) || typeof o.shell !== 'boolean') return null
  if (o.cwd !== undefined && typeof o.cwd !== 'string') return null
  if (o.env !== undefined && (!o.env || typeof o.env !== 'object' || !Object.values(o.env).every((v) => typeof v === 'string'))) return null
  if (!Array.isArray(o.stdio) || o.stdio.length !== 3 || !o.stdio.every((s) => STDIO.has(s))) return null
  return { file: o.file, args: o.args, shell: o.shell, cwd: o.cwd as string | undefined, env: o.env as Record<string, string> | undefined, stdio: o.stdio as ChildSpec['stdio'] }
}

interface IO {
  stdout: Writer
  stderr: Writer
  stdin: Channel
  signal: AbortSignal
}

interface Running {
  abort: AbortController
  stdin: Channel
  /** The signal it was killed with (it then exits with code null). */
  killed: string | null
}

export class ChildHost {
  private procs = new Map<number, Running>()
  private syncIds = 0
  private closed = false

  constructor(
    private ctx: CommandContext,
    private send: (e: ChildEvent) => void,
  ) {}

  /** Resolve what `spec` runs; null when there's no such command or cwd (Node's ENOENT). */
  private runner(spec: ChildSpec): ((io: IO) => Promise<number>) | null {
    const c = this.ctx.container
    const cwd = resolve(this.ctx.cwd, spec.cwd ?? '.')
    const env = spec.env ?? this.ctx.env
    if (!c.vfs.isDir(cwd)) return null
    const tty = (io: IO) => !!this.ctx.isTTY && io.stdout === this.ctx.stdout
    if (spec.shell) return (io) => new Shell(c, cwd, env).run(spec.file, { ...io, isTTY: tty(io) })
    let name = spec.file
    // `process.execPath` and friends: the built-in commands `which` reports under /usr/local/bin
    if (!c.which(name, cwd, env) && BIN_DIRS.has(dirname(name)) && c.which(basename(name), cwd, { PATH: '' })) name = basename(name)
    if (!c.which(name, cwd, env)) return null
    return (io) => c.exec(name, { args: spec.args, cwd, env, ...io, container: c, isTTY: tty(io) })
  }

  private writers(spec: ChildSpec, pipe: (fd: 1 | 2, s: string) => void): [Writer, Writer] {
    const w = (fd: 1 | 2): Writer => {
      const mode: ChildStdio = spec.stdio[fd]
      if (mode === 'inherit') return fd === 1 ? this.ctx.stdout : this.ctx.stderr
      if (mode === 'ignore') return { write() {} }
      return { write: (s) => void (s && pipe(fd, String(s))) }
    }
    return [w(1), w(2)]
  }

  private run(id: number, spec: ChildSpec, input: string | null, pipe: (fd: 1 | 2, s: string) => void): { done: Promise<number>; proc: Running } | null {
    const runner = this.closed ? null : this.runner(spec)
    if (!runner) return null
    const stdin = new Channel()
    if (input) stdin.push(input)
    if (spec.stdio[0] !== 'pipe' || input !== null) stdin.close()
    const proc: Running = { abort: new AbortController(), stdin, killed: null }
    this.procs.set(id, proc)
    const [stdout, stderr] = this.writers(spec, pipe)
    const done = (async () => {
      await Promise.resolve() // let the caller announce the spawn before the child writes anything
      try {
        return await runner({ stdout, stderr, stdin, signal: proc.abort.signal })
      } catch (e) {
        stderr.write(`${errorMessage(e)}\n`)
        return 1
      } finally {
        this.procs.delete(id)
        stdin.close()
      }
    })()
    return { done, proc }
  }

  /** `spawn`: events go back to the worker as `child` messages. */
  spawn(id: number, spec: ChildSpec): void {
    if (this.procs.has(id)) return
    const r = this.run(id, spec, null, (fd, data) => this.send({ type: 'child', id, ev: 'out', fd, data }))
    if (!r) return this.send({ type: 'child', id, ev: 'error', message: `spawn ${spec.file} ENOENT`, code: 'ENOENT' })
    this.send({ type: 'child', id, ev: 'spawn' })
    r.done.then((code) => this.send({ type: 'child', id, ev: 'exit', code: r.proc.killed ? null : code, signal: r.proc.killed }))
  }

  /** `spawnSync` / `execSync`: run to completion (the worker is blocked meanwhile), collecting piped output. */
  async spawnSync(spec: ChildSpec, input: string | null, timeout: number): Promise<ChildSyncResult> {
    const out = { 1: '', 2: '' }
    const id = --this.syncIds
    const r = this.run(id, spec, input ?? '', (fd, s) => void (out[fd] += s))
    if (!r) return { status: null, signal: null, stdout: '', stderr: '', error: { message: `spawnSync ${spec.file} ENOENT`, code: 'ENOENT' } }
    let timedOut = false
    const timer = timeout > 0 ? setTimeout(() => ((timedOut = true), this.kill(id, 'SIGTERM')), timeout) : null
    const code = await r.done
    if (timer) clearTimeout(timer)
    return {
      status: r.proc.killed ? null : code,
      signal: r.proc.killed,
      stdout: out[1],
      stderr: out[2],
      ...(timedOut ? { error: { message: `spawnSync ${spec.file} ETIMEDOUT`, code: 'ETIMEDOUT' } } : {}),
    }
  }

  stdin(id: number, data: string | null): void {
    const p = this.procs.get(id)
    if (!p) return
    if (data === null) p.stdin.close()
    else p.stdin.push(data)
  }

  kill(id: number, signal: string): void {
    const proc = this.procs.get(id)
    if (!proc || proc.killed) return
    proc.killed = signal
    proc.abort.abort()
  }

  /** The parent exited: its children go with it. */
  killAll(): void {
    this.closed = true
    for (const [id] of this.procs) this.kill(id, 'SIGKILL')
  }
}
