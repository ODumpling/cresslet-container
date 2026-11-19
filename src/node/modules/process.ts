// node:process polyfill (worker-global).
import { EventEmitter } from 'events'
import { post } from '../rpc'
import { setCwd } from '../../path'

type Listener = (...a: unknown[]) => void

class Stdin extends EventEmitter {
  isTTY = false
  fd = 0
  readable = true
  private buffered: string[] = []
  private ended = false
  private flowing = false
  private encoding: string | null = null
  setEncoding(e: string) {
    this.encoding = e
    return this
  }
  setRawMode() {
    return this
  }
  resume() {
    this.flowing = true
    this.flush()
    return this
  }
  pause() {
    this.flowing = false
    return this
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
  override on(ev: string | symbol, fn: Listener) {
    super.on(ev, fn)
    if (ev === 'data' || ev === 'readable') this.resume()
    return this
  }
  read(): string | null {
    return this.buffered.length ? this.buffered.splice(0).join('') : null
  }
  push(s: string) {
    this.buffered.push(s)
    this.flush()
  }
  end() {
    this.ended = true
    this.flush()
  }
  private flush() {
    if (!this.flowing) {
      if (this.buffered.length) this.emit('readable')
      return
    }
    while (this.buffered.length) {
      const s = this.buffered.shift()!
      this.emit('data', this.encoding ? s : globalThis.Buffer ? globalThis.Buffer.from(s) : s)
    }
    if (this.ended) {
      this.ended = false
      this.readable = false
      this.emit('end')
      this.emit('close')
    }
  }
  pipe<T extends { write(c: unknown): unknown; end?(): unknown }>(dest: T): T {
    this.on('data', (c) => dest.write(c))
    this.on('end', () => dest.end?.())
    return dest
  }
  async *[Symbol.asyncIterator]() {
    const q: unknown[] = []
    let done = false
    let wake: (() => void) | null = null
    this.on('data', (c) => (q.push(c), wake?.()))
    this.on('end', () => ((done = true), wake?.()))
    while (true) {
      if (q.length) yield q.shift()
      else if (done) return
      else await new Promise<void>((r) => (wake = r))
    }
  }
}

class Stdout extends EventEmitter {
  writable = true
  columns = 80
  rows = 24
  constructor(
    private kind: 'stdout' | 'stderr',
    public isTTY: boolean,
    public fd: number,
  ) {
    super()
  }
  write(chunk: unknown, enc?: unknown, cb?: unknown): boolean {
    const s = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk)
    post({ type: this.kind, data: s })
    const done = typeof enc === 'function' ? enc : cb
    if (typeof done === 'function') queueMicrotask(() => (done as () => void)())
    return true
  }
  end(chunk?: unknown) {
    if (chunk) this.write(chunk)
    return this
  }
  getColorDepth() {
    return this.isTTY ? 8 : 1
  }
  hasColors() {
    return this.isTTY
  }
  getWindowSize() {
    return [this.columns, this.rows]
  }
  cursorTo(x: number, _y?: number, cb?: () => void) {
    this.write(`\x1b[${x + 1}G`)
    cb?.()
    return true
  }
  moveCursor(dx: number, dy: number, cb?: () => void) {
    if (dx) this.write(dx > 0 ? `\x1b[${dx}C` : `\x1b[${-dx}D`)
    if (dy) this.write(dy > 0 ? `\x1b[${dy}B` : `\x1b[${-dy}A`)
    cb?.()
    return true
  }
  clearLine(_dir?: number, cb?: () => void) {
    this.write('\x1b[2K')
    cb?.()
    return true
  }
  clearScreenDown(cb?: () => void) {
    this.write('\x1b[J')
    cb?.()
    return true
  }
}

export class ExitSignal {
  constructor(public code: number) {}
}

const t0 = performance.now()

export interface NodeProcess extends EventEmitter {
  [k: string]: unknown
}

export function createProcess(opts: { argv: string[]; env: Record<string, string>; cwd: string; isTTY: boolean; columns: number; pid: number; exit: (code: number) => never }) {
  let cwd = opts.cwd
  const proc = new EventEmitter() as EventEmitter & Record<string, unknown>
  const stdout = new Stdout('stdout', opts.isTTY, 1)
  const stderr = new Stdout('stderr', opts.isTTY, 2)
  stdout.columns = stderr.columns = opts.columns
  const stdin = new Stdin()
  stdin.isTTY = opts.isTTY
  const hrtime = (prev?: [number, number]): [number, number] => {
    const t = performance.now() * 1e6
    let s = Math.floor(t / 1e9)
    let ns = Math.floor(t % 1e9)
    if (prev) {
      s -= prev[0]
      ns -= prev[1]
      if (ns < 0) (s--, (ns += 1e9))
    }
    return [s, ns]
  }
  hrtime.bigint = () => BigInt(Math.floor(performance.now() * 1e6))
  Object.assign(proc, {
    title: 'node',
    version: 'v22.12.0',
    versions: { node: '22.12.0', v8: '12.4.254', uv: '1.49.0', modules: '127' },
    arch: 'x64',
    platform: 'linux',
    release: { name: 'node' },
    argv: opts.argv,
    argv0: 'node',
    execArgv: [],
    execPath: '/usr/local/bin/node',
    env: opts.env,
    pid: opts.pid,
    ppid: 1,
    exitCode: undefined,
    stdout,
    stderr,
    stdin,
    browser: false,
    features: {},
    config: { variables: {} },
    cwd: () => cwd,
    chdir: (d: string) => {
      cwd = d.startsWith('/') ? d : `${cwd}/${d}`
    },
    umask: () => 0o22,
    getuid: () => 1000,
    getgid: () => 1000,
    geteuid: () => 1000,
    getegid: () => 1000,
    exit: (code?: number) => opts.exit(code ?? (proc.exitCode as number | undefined) ?? 0),
    abort: () => opts.exit(134),
    kill: () => true,
    nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
    hrtime,
    uptime: () => (performance.now() - t0) / 1000,
    memoryUsage: Object.assign(() => ({ rss: 5e7, heapTotal: 3e7, heapUsed: 2e7, external: 1e6, arrayBuffers: 1e5 }), { rss: () => 5e7 }),
    cpuUsage: () => ({ user: 0, system: 0 }),
    resourceUsage: () => ({}),
    emitWarning: (w: unknown) => {
      const msg = w instanceof Error ? w.message : String(w)
      stderr.write(`(node) Warning: ${msg}\n`)
    },
    binding: () => {
      throw new Error('process.binding is not supported')
    },
    setUncaughtExceptionCaptureCallback: () => {},
    hasUncaughtExceptionCaptureCallback: () => false,
    getActiveResourcesInfo: () => [],
  })
  setCwd(() => cwd)
  return proc
}
