// node:child_process polyfill. Children are container commands (jsh builtins, `node`, `npm`, registered commands,
// files on PATH) that the host runs (../child.ts), with stdio piped back here as text. `shell` (and exec/execSync)
// lines go through jsh. *Sync calls block on the host over the SAB RPC. No fork/IPC, no detached children: they die
// with this process.
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { Readable, Writable } from 'readable-stream'
import { StringDecoder } from 'string_decoder'
import { resolve as resolvePath } from '../../path'
import { nativeClearTimeout, nativeSetTimeout, post, ref, syncCall } from '../rpc'
import type { ChildEvent, ChildSpec, ChildStdio, ChildSyncResult } from '../protocol'
import { unsupportedFn } from './misc'

const kCustom = Symbol.for('nodejs.util.promisify.custom')
const PID_BASE = 2000
type Proc = { env: Record<string, string | undefined>; cwd(): string; stdin: unknown; stdout: Stream; stderr: Stream }
type Stream = { write(c: unknown): unknown; on?: unknown; pipe?: unknown }
const proc = () => (globalThis as unknown as { process: Proc }).process

type StdioOpt = string | number | null | undefined | Stream
interface Options {
  cwd?: string | URL
  env?: Record<string, string | undefined>
  stdio?: StdioOpt | StdioOpt[]
  shell?: boolean | string
  timeout?: number
  killSignal?: string | number
  signal?: AbortSignal
  input?: string | ArrayBufferView
  encoding?: string | null
  [k: string]: unknown
}

const argErr = (msg: string) => Object.assign(new TypeError(msg), { code: 'ERR_INVALID_ARG_TYPE' })

/** Stdio as the host sees it, plus streams of this process to connect a piped fd to. */
function normStdio(stdio: Options['stdio']): { modes: [ChildStdio, ChildStdio, ChildStdio]; streams: (Stream | null)[] } {
  const list = Array.isArray(stdio) ? stdio : [stdio, stdio, stdio]
  const p = proc()
  const std = [p.stdin, p.stdout, p.stderr]
  const modes: ChildStdio[] = []
  const streams: (Stream | null)[] = []
  for (let i = 0; i < 3; i++) {
    const v = list[i]
    streams[i] = null
    if (v === 'inherit' || v === i || (v !== null && typeof v === 'object' && v === std[i])) modes[i] = 'inherit'
    else if (v === 'ignore' || v === 'ipc' || typeof v === 'number') modes[i] = 'ignore'
    else if (v && typeof v === 'object') (modes[i] = 'pipe'), (streams[i] = v)
    else modes[i] = 'pipe' // 'pipe', 'overlapped', null, undefined
  }
  return { modes: modes as [ChildStdio, ChildStdio, ChildStdio], streams }
}

function makeSpec(file: unknown, args: unknown[], opts: Options, modes: ChildSpec['stdio']): ChildSpec {
  if (typeof file !== 'string' || !file) throw argErr(`The "file" argument must be of type string and not empty. Received ${typeof file}`)
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.env ?? proc().env)) if (v !== undefined) env[k] = String(v)
  let cwd = opts.cwd === undefined || opts.cwd === null ? proc().cwd() : String(opts.cwd)
  if (cwd.startsWith('file:')) cwd = decodeURIComponent(new URL(cwd).pathname)
  cwd = resolvePath(proc().cwd(), cwd) // relative to this process's cwd now (after any chdir)
  const strArgs = args.map(String)
  if (opts.shell) return { file: [file, ...strArgs].join(' '), args: [], shell: true, cwd, env, stdio: modes }
  return { file, args: strArgs, shell: false, cwd, env, stdio: modes }
}

/** (file, args?, options?, callback?) with any of the middle ones left out, as Node accepts. */
function normArgs(a: unknown[]): { args: unknown[]; opts: Options; cb?: (...r: unknown[]) => void } {
  let i = 0
  let args: unknown[] = []
  let opts: Options = {}
  if (Array.isArray(a[i])) args = a[i++] as unknown[]
  else if (a[i] === undefined || a[i] === null) i++
  if (a[i] && typeof a[i] === 'object') opts = a[i++] as Options
  else if (a[i] === undefined || a[i] === null) i++
  const cb = typeof a[i] === 'function' ? (a[i] as (...r: unknown[]) => void) : typeof a[a.length - 1] === 'function' ? (a[a.length - 1] as (...r: unknown[]) => void) : undefined
  return { args, opts, cb }
}

const SIGNALS: Record<number, string> = { 1: 'SIGHUP', 2: 'SIGINT', 9: 'SIGKILL', 15: 'SIGTERM' }
const sigName = (s: unknown) => (typeof s === 'number' ? (SIGNALS[s] ?? 'SIGTERM') : typeof s === 'string' && s ? s : 'SIGTERM')
const children = new Map<number, ChildProcess>()
let nextId = 0

export class ChildProcess extends EventEmitter {
  pid: number | undefined
  stdin: Writable | null = null
  stdout: Readable | null = null
  stderr: Readable | null = null
  stdio: [Writable | null, Readable | null, Readable | null, null, null]
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  connected = false
  spawnfile: string
  spawnargs: string[]
  private release: (() => void) | null
  private ended = false

  /** @internal */
  constructor(
    private id: number,
    spec: ChildSpec,
    file: string,
    args: string[],
  ) {
    super()
    this.pid = PID_BASE + id
    this.spawnfile = file
    this.spawnargs = [file, ...args]
    this.release = ref()
    if (spec.stdio[0] === 'pipe') {
      const dec = new StringDecoder('utf8') // a character split across writes stays whole
      let eof = false
      const end = () => {
        if (eof) return
        eof = true
        const rest = dec.end()
        if (rest) post({ type: 'child-stdin', id, data: rest })
        post({ type: 'child-stdin', id, data: null })
      }
      this.stdin = new Writable({
        write: (chunk: unknown, _enc: string, cb: () => void) => {
          const data = typeof chunk === 'string' ? chunk : dec.write(chunk as Buffer)
          if (data) post({ type: 'child-stdin', id, data })
          cb()
        },
        final: (cb: () => void) => (end(), cb()),
        destroy: (err: Error | null, cb: (e: Error | null) => void) => (end(), cb(err)),
      })
    }
    if (spec.stdio[1] === 'pipe') this.stdout = new Readable({ read() {} })
    if (spec.stdio[2] === 'pipe') this.stderr = new Readable({ read() {} })
    this.stdio = [this.stdin, this.stdout, this.stderr, null, null]
  }

  kill(signal: string | number = 'SIGTERM'): boolean {
    if (this.ended || this.exitCode !== null || this.signalCode !== null) return false
    if (signal === 0) return true // only checks that it's alive
    post({ type: 'child-kill', id: this.id, signal: sigName(signal) })
    this.killed = true
    return true
  }
  ref(): void {
    if (!this.ended) this.release ??= ref()
  }
  unref(): void {
    this.release?.()
    this.release = null
  }
  disconnect(): void {}
  send(): boolean {
    return false
  }

  /** @internal */
  handle(m: ChildEvent): void {
    switch (m.ev) {
      case 'spawn':
        this.emit('spawn')
        break
      case 'out':
        ;(m.fd === 1 ? this.stdout : this.stderr)?.push(Buffer.from(m.data))
        break
      case 'error': {
        this.pid = undefined
        const syscall = `spawn ${this.spawnfile}`
        this.emit('error', Object.assign(new Error(m.message), { code: m.code, errno: -2, syscall, path: this.spawnfile, spawnargs: this.spawnargs.slice(1) }))
        this.close(-2, null)
        break
      }
      case 'exit':
        this.exitCode = m.code
        this.signalCode = m.signal
        this.emit('exit', m.code, m.signal)
        this.close(m.code, m.signal)
        break
    }
  }

  /**
   * End stdio, then 'close' once stdout/stderr have ended. As in Node, streams are resumed after exit (output nobody
   * reads is discarded, a paused reader gets the rest); only a 'readable' listener (e.g. `for await`) reads at its pace.
   */
  private close(code: number | null, signal: string | null): void {
    this.ended = true
    children.delete(this.id)
    this.stdin?.destroy()
    const outs = [this.stdout, this.stderr].filter((s): s is Readable => !!s)
    const ended = outs.map((s) => new Promise<void>((r) => (s.readableEnded || s.destroyed ? r() : (s.once('end', r), s.once('close', r)))))
    for (const s of outs) {
      s.push(null)
      if (!s._readableState?.readableListening) s.resume()
      else s.read(0) // emits 'end' if nothing is left buffered
    }
    Promise.all(ended).then(() =>
      nativeSetTimeout(() => {
        this.emit('close', code, signal)
        this.unref()
      }, 0),
    )
  }
}

export function handleChildMessage(m: ChildEvent): void {
  children.get(m.id)?.handle(m)
}

function start(file: unknown, args: unknown[], opts: Options): ChildProcess {
  const { modes, streams } = normStdio(opts.stdio)
  const spec = makeSpec(file, args, opts, modes)
  const id = ++nextId
  const cp = new ChildProcess(id, spec, file as string, spec.args)
  children.set(id, cp)
  post({ type: 'child-spawn', id, ...spec })
  if (streams[0]) (streams[0] as unknown as Readable).pipe(cp.stdin!)
  if (streams[1]) cp.stdout!.pipe(streams[1] as unknown as Writable)
  if (streams[2]) cp.stderr!.pipe(streams[2] as unknown as Writable)
  const killSignal = sigName(opts.killSignal)
  if (typeof opts.timeout === 'number' && opts.timeout > 0) {
    const t = nativeSetTimeout(() => cp.kill(killSignal), opts.timeout)
    cp.once('close', () => nativeClearTimeout(t))
  }
  const signal = opts.signal
  if (signal) {
    const onAbort = () => {
      if (cp.kill(killSignal)) cp.emit('error', Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR', cause: signal.reason }))
    }
    if (signal.aborted) queueMicrotask(onAbort)
    else {
      signal.addEventListener('abort', onAbort, { once: true })
      cp.once('close', () => signal.removeEventListener('abort', onAbort))
    }
  }
  return cp
}

export function spawn(file: unknown, ...rest: unknown[]): ChildProcess {
  const { args, opts } = normArgs(rest)
  return start(file, args, opts)
}

type ExecCallback = (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void

/** exec / execFile: collect output, call back on close with Node's "Command failed" error for non-zero exits. */
function collect(cp: ChildProcess, cmd: string, opts: Options, cb?: ExecCallback): ChildProcess {
  const out: Buffer[] = []
  const err: Buffer[] = []
  cp.stdout?.on('data', (c: Buffer) => out.push(c))
  cp.stderr?.on('data', (c: Buffer) => err.push(c))
  const enc = opts.encoding === undefined ? 'utf8' : opts.encoding
  const text = (b: Buffer[]) => (enc && enc !== 'buffer' && Buffer.isEncoding(enc) ? Buffer.concat(b).toString(enc as BufferEncoding) : Buffer.concat(b))
  let called = false
  const done = (e: Error | null) => {
    if (called || !cb) return
    called = true
    cb(e, text(out), text(err))
  }
  cp.once('error', (e: Error) => done(Object.assign(e, { cmd })))
  cp.once('close', (code: number | null, signal: string | null) => {
    if (code === 0 && !signal) return done(null)
    const stderr = Buffer.concat(err).toString()
    done(Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), { code, killed: cp.killed, signal, cmd }))
  })
  return cp
}

function withPromise(fn: (...a: unknown[]) => ChildProcess) {
  return (...a: unknown[]) => {
    let child!: ChildProcess
    const p = new Promise((resolve, reject) => {
      child = fn(...a, (e: Error | null, stdout: unknown, stderr: unknown) => (e ? reject(Object.assign(e, { stdout, stderr })) : resolve({ stdout, stderr })))
    })
    return Object.assign(p, { child })
  }
}

export function exec(command: unknown, ...rest: unknown[]): ChildProcess {
  const { opts, cb } = normArgs([null, ...rest])
  return collect(start(command, [], { ...opts, shell: opts.shell ?? true }), String(command), opts, cb as ExecCallback)
}
;(exec as unknown as Record<symbol, unknown>)[kCustom] = withPromise(exec as (...a: unknown[]) => ChildProcess)

export function execFile(file: unknown, ...rest: unknown[]): ChildProcess {
  const { args, opts, cb } = normArgs(rest)
  return collect(start(file, args, opts), [file, ...args].join(' '), opts, cb as ExecCallback)
}
;(execFile as unknown as Record<symbol, unknown>)[kCustom] = withPromise(execFile as (...a: unknown[]) => ChildProcess)

interface SyncResult {
  pid: number
  output: [null, string | Buffer | null, string | Buffer | null]
  stdout: string | Buffer | null
  stderr: string | Buffer | null
  status: number | null
  signal: string | null
  error?: Error
}

function runSync(file: unknown, args: unknown[], opts: Options): SyncResult {
  const { modes } = normStdio(opts.stdio)
  const spec = makeSpec(file, args, opts, modes)
  const raw = opts.input
  const input = raw === undefined || raw === null ? null : typeof raw === 'string' ? raw : Buffer.from(raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength).toString()
  const r = syncCall<ChildSyncResult>('spawnSync', spec, input, typeof opts.timeout === 'number' ? opts.timeout : 0)
  const enc = opts.encoding
  const conv = (s: string, fd: 1 | 2) => (modes[fd] !== 'pipe' ? null : enc && enc !== 'buffer' && Buffer.isEncoding(enc) ? Buffer.from(s).toString(enc as BufferEncoding) : Buffer.from(s))
  const stdout = conv(r.stdout, 1)
  const stderr = conv(r.stderr, 2)
  const res: SyncResult = { pid: PID_BASE + ++nextId, output: [null, stdout, stderr], stdout, stderr, status: r.status, signal: r.signal }
  if (r.error) {
    const syscall = `spawnSync ${file}`
    res.error = Object.assign(new Error(r.error.message), { code: r.error.code, errno: r.error.code === 'ENOENT' ? -2 : -110, syscall, path: file, spawnargs: spec.args })
    if (r.error.code === 'ENOENT') res.pid = 0
  }
  return res
}

export function spawnSync(file: unknown, ...rest: unknown[]): SyncResult {
  const { args, opts } = normArgs(rest)
  return runSync(file, args, opts)
}

/** execSync / execFileSync: stderr also goes to this process's stderr unless `stdio` is given; throws on failure. */
function checkSync(r: SyncResult, cmd: string, opts: Options): string | Buffer | null {
  if (opts.stdio === undefined && r.stderr && r.stderr.length) proc().stderr.write(r.stderr)
  if (r.error) throw Object.assign(r.error, { status: r.status, signal: r.signal, output: r.output, pid: r.pid, stdout: r.stdout, stderr: r.stderr })
  if (r.status !== 0) {
    const stderr = r.stderr ? r.stderr.toString() : ''
    throw Object.assign(new Error(`Command failed: ${cmd}${stderr ? `\n${stderr}` : ''}`), { status: r.status, signal: r.signal, output: r.output, pid: r.pid, stdout: r.stdout, stderr: r.stderr })
  }
  return r.stdout
}

export function execSync(command: unknown, opts: Options = {}): string | Buffer | null {
  return checkSync(runSync(command, [], { ...opts, shell: opts.shell ?? true }), String(command), opts)
}

export function execFileSync(file: unknown, ...rest: unknown[]): string | Buffer | null {
  const { args, opts } = normArgs(rest)
  return checkSync(runSync(file, args, opts), [file, ...args].join(' '), opts)
}

export default {
  ChildProcess,
  spawn,
  spawnSync,
  exec,
  execSync,
  execFile,
  execFileSync,
  fork: unsupportedFn('child_process.fork'),
}
