// Node-ish process running in a Web Worker: CommonJS loader over the main-thread VFS + builtin polyfills.
import { Buffer } from 'buffer'
import EventEmitterMod, { EventEmitter } from 'events'
import * as streamMod from 'readable-stream'
import { StringDecoder } from 'string_decoder'
import pathMod, { dirname } from '../path'
import type { MainToWorker, StartMsg } from './protocol'
import { activeRefs, handleAsyncResult, hasSync, nativeSetTimeout, post, ref, scheduleIdleCheck, setIdleHandler, setSab, syncCall } from './rpc'
import { createProcess, ExitSignal } from './modules/process'
import fsMod, { promises as fsPromises } from './modules/fs'
import utilMod, { format, inspect } from './modules/util'
import { containerFetch, handleHttpMessage, makeHttp } from './modules/http'
import {
  assert,
  asyncHooks,
  crypto,
  diagnosticsChannel,
  net,
  os,
  perfHooks,
  querystring,
  readline,
  tty,
  unsupportedModule,
  url,
  vm,
  workerThreads,
} from './modules/misc'

const g = globalThis as unknown as Record<string, unknown>
let exiting = false
let proc: ReturnType<typeof createProcess>

function exit(code: number): never {
  if (!exiting) {
    exiting = true
    proc.exitCode = code
    try {
      proc.emit('exit', code)
    } catch {
      /* ignore */
    }
    post({ type: 'exit', code: (proc.exitCode as number) ?? code })
  }
  throw new ExitSignal(code)
}

function printError(e: unknown) {
  if (e instanceof ExitSignal) return
  const err = e as Error
  const text = err && typeof err === 'object' && err.stack ? err.stack : inspect(e)
  post({ type: 'stderr', data: `${text.includes(String(err?.message)) || !err?.message ? text : `${err.name}: ${err.message}\n${text}`}\n` })
}

function fatal(e: unknown) {
  if (e instanceof ExitSignal || exiting) return
  if (proc?.listenerCount('uncaughtException')) {
    proc.emit('uncaughtException', e)
    return
  }
  printError(e)
  try {
    exit(1)
  } catch {
    /* ExitSignal */
  }
}

// ---------------- timers with liveness refs ----------------
const nSetTimeout = globalThis.setTimeout.bind(globalThis)
const nClearTimeout = globalThis.clearTimeout.bind(globalThis)
const nSetInterval = globalThis.setInterval.bind(globalThis)
const nClearInterval = globalThis.clearInterval.bind(globalThis)

class Timeout {
  private release: (() => void) | null
  private handle: number
  constructor(
    private fn: (...a: unknown[]) => void,
    private ms: number,
    private args: unknown[],
    private repeat: boolean,
  ) {
    this.release = ref()
    this.handle = this.start()
  }
  private start(): number {
    const run = () => {
      if (!this.repeat) this.done()
      try {
        this.fn(...this.args)
      } catch (e) {
        fatal(e)
      }
    }
    return (this.repeat ? nSetInterval(run, this.ms) : nSetTimeout(run, this.ms)) as unknown as number
  }
  private done() {
    this.release?.()
    this.release = null
  }
  clear() {
    ;(this.repeat ? nClearInterval : nClearTimeout)(this.handle)
    this.done()
  }
  ref() {
    if (!this.release) this.release = ref()
    return this
  }
  unref() {
    this.done()
    return this
  }
  hasRef() {
    return !!this.release
  }
  refresh() {
    ;(this.repeat ? nClearInterval : nClearTimeout)(this.handle)
    this.handle = this.start()
    return this
  }
  close() {
    this.clear()
    return this
  }
  [Symbol.toPrimitive]() {
    return this.handle
  }
}
const byHandle = new Map<number, Timeout>()
const timers = {
  setTimeout: (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const t = new Timeout(fn, ms, args, false)
    byHandle.set(+t, t)
    return t
  },
  setInterval: (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const t = new Timeout(fn, ms, args, true)
    byHandle.set(+t, t)
    return t
  },
  setImmediate: (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    const t = new Timeout(fn, 0, args, false)
    byHandle.set(+t, t)
    return t
  },
  clearTimeout: (t: unknown) => {
    if (t instanceof Timeout) t.clear()
    else if (typeof t === 'number') byHandle.get(t)?.clear()
  },
}
const timersPromises = {
  setTimeout: (ms = 0, v?: unknown, o?: { signal?: AbortSignal }) =>
    new Promise((res, rej) => {
      const t = timers.setTimeout(() => res(v), ms)
      o?.signal?.addEventListener('abort', () => (t.clear(), rej(o.signal!.reason)))
    }),
  setImmediate: (v?: unknown) => new Promise((res) => timers.setImmediate(() => res(v))),
  async *setInterval(ms = 0, v?: unknown) {
    for (;;) {
      await timersPromises.setTimeout(ms)
      yield v
    }
  },
  scheduler: { wait: (ms: number) => timersPromises.setTimeout(ms), yield: () => timersPromises.setImmediate() },
}

// ---------------- builtin modules ----------------
const http = makeHttp('http:')
const https = makeHttp('https:')
const events = Object.assign(EventEmitterMod, { EventEmitter, once: EventEmitterMod.once, on: (EventEmitterMod as unknown as Record<string, unknown>).on })

const builtinFactories: Record<string, () => unknown> = {
  assert: () => assert,
  'assert/strict': () => assert,
  async_hooks: () => asyncHooks,
  buffer: () => ({ Buffer, constants: { MAX_LENGTH: 2 ** 31 - 1 }, kMaxLength: 2 ** 31 - 1, Blob, atob, btoa, File: globalThis.File }),
  child_process: () => unsupportedModule('child_process'),
  cluster: () => unsupportedModule('cluster', { isMaster: true, isPrimary: true, isWorker: false }),
  console: () => console,
  constants: () => ({ ...os.constants, ...(fsMod.constants as object) }),
  crypto: () => crypto,
  dgram: () => unsupportedModule('dgram'),
  diagnostics_channel: () => diagnosticsChannel,
  dns: () => unsupportedModule('dns', { promises: unsupportedModule('dns.promises') }),
  'dns/promises': () => unsupportedModule('dns.promises'),
  domain: () => ({ create: () => ({ run: (fn: () => unknown) => fn(), on() {}, add() {}, enter() {}, exit() {} }) }),
  events: () => events,
  fs: () => fsMod,
  'fs/promises': () => fsPromises,
  http: () => http,
  http2: () => unsupportedModule('http2'),
  https: () => https,
  inspector: () => unsupportedModule('inspector', { url: () => undefined }),
  module: () => moduleBuiltin,
  net: () => net,
  os: () => os,
  path: () => pathMod,
  'path/posix': () => pathMod,
  perf_hooks: () => perfHooks,
  process: () => proc,
  punycode: () => ({ toASCII: (s: string) => s, toUnicode: (s: string) => s }),
  querystring: () => querystring,
  readline: () => readline,
  'readline/promises': () => ({
    ...readline,
    createInterface: (...a: Parameters<typeof readline.createInterface>) => {
      const rl = readline.createInterface(...a)
      return Object.assign(rl, { question: (q: string) => rl.question(q) as Promise<string> })
    },
  }),
  repl: () => unsupportedModule('repl'),
  stream: () => streamMod,
  'stream/promises': () => (streamMod as unknown as { promises: unknown }).promises,
  'stream/web': () => ({ ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream }),
  string_decoder: () => ({ StringDecoder }),
  sys: () => utilMod,
  timers: () => ({ ...timers, clearInterval: timers.clearTimeout, clearImmediate: timers.clearTimeout, promises: timersPromises }),
  'timers/promises': () => timersPromises,
  tls: () => unsupportedModule('tls'),
  tty: () => tty,
  url: () => url,
  util: () => utilMod,
  'util/types': () => utilMod.types,
  v8: () => unsupportedModule('v8', { getHeapStatistics: () => ({ heap_size_limit: 4e9, total_heap_size: 1e8, used_heap_size: 5e7 }), serialize: (v: unknown) => Buffer.from(JSON.stringify(v)), deserialize: (b: Buffer) => JSON.parse(b.toString()) }),
  vm: () => vm,
  wasi: () => unsupportedModule('wasi'),
  worker_threads: () => workerThreads,
  zlib: () => unsupportedModule('zlib', { constants: {} }),
}
const builtinCache = new Map<string, unknown>()
const builtinModules = Object.keys(builtinFactories)

function builtinName(spec: string): string | null {
  const n = spec.startsWith('node:') ? spec.slice(5) : spec
  return n in builtinFactories ? n : null
}
function loadBuiltin(n: string): unknown {
  if (!builtinCache.has(n)) builtinCache.set(n, builtinFactories[n]())
  return builtinCache.get(n)
}

// ---------------- CommonJS loader ----------------
interface Mod {
  id: string
  filename: string
  path: string
  exports: unknown
  loaded: boolean
  parent: Mod | null
  children: Mod[]
  paths: string[]
  require: NodeRequire
}
type NodeRequire = ((spec: string) => unknown) & {
  resolve: ((spec: string, o?: { paths?: string[] }) => string) & { paths: (s: string) => string[] | null }
  cache: Record<string, Mod>
  main: Mod | undefined
  extensions: Record<string, unknown>
}

const cache: Record<string, Mod> = Object.create(null)
let mainModule: Mod | undefined

function nodePaths(dir: string): string[] {
  const out: string[] = []
  for (let d = dir; ; d = dirname(d)) {
    if (!d.endsWith('/node_modules')) out.push(`${d === '/' ? '' : d}/node_modules`)
    if (d === '/') break
  }
  return out
}

function resolveFrom(spec: string, dir: string): string | false {
  return syncCall<string | false>('resolve', spec, dir)
}

function makeRequire(mod: Mod): NodeRequire {
  const req = ((spec: string) => {
    if (typeof spec !== 'string') throw new TypeError(`The "id" argument must be of type string. Received ${inspect(spec)}`)
    const b = builtinName(spec)
    if (b) return loadBuiltin(b)
    if (spec.startsWith('node:')) throw Object.assign(new Error(`No such built-in module: ${spec}`), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' })
    const resolved = resolveFrom(spec, mod.path)
    if (resolved === false) return {}
    return loadFile(resolved, mod)
  }) as NodeRequire
  const resolve = ((spec: string, o?: { paths?: string[] }) => {
    const b = builtinName(spec)
    if (b) return spec
    for (const dir of o?.paths ?? [mod.path]) {
      try {
        const r = resolveFrom(spec, dir)
        if (r) return r
      } catch (e) {
        if (!o?.paths) throw e
      }
    }
    throw Object.assign(new Error(`Cannot find module '${spec}'`), { code: 'MODULE_NOT_FOUND' })
  }) as NodeRequire['resolve']
  resolve.paths = (s: string) => (builtinName(s) ? null : nodePaths(mod.path))
  req.resolve = resolve
  req.cache = cache
  req.main = mainModule
  req.extensions = { '.js': () => {}, '.json': () => {}, '.node': () => {} }
  return req
}

function createModule(filename: string, parent: Mod | null): Mod {
  const mod: Mod = { id: filename, filename, path: dirname(filename), exports: {}, loaded: false, parent, children: [], paths: nodePaths(dirname(filename)), require: null as unknown as NodeRequire }
  mod.require = makeRequire(mod)
  return mod
}

function loadFile(filename: string, parent: Mod | null): unknown {
  const cached = cache[filename]
  if (cached) return cached.exports
  if (filename.endsWith('.node')) throw new Error(`[clover] native addon '${filename}' cannot be loaded in the browser runtime`)
  const mod = createModule(filename, parent)
  parent?.children.push(mod)
  cache[filename] = mod
  try {
    const { code, format: fmt } = syncCall<{ code: string; format: 'cjs' | 'json' }>('load', filename)
    if (fmt === 'json') mod.exports = JSON.parse(code)
    else {
      const body = (code.startsWith('#!') ? '//' + code : code) + `\n//# sourceURL=${filename}`
      const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', '__clover_meta_url', body)
      fn.call(mod.exports, mod.exports, mod.require, mod, filename, mod.path, 'file://' + filename)
    }
    mod.loaded = true
  } catch (e) {
    delete cache[filename]
    throw e
  }
  return mod.exports
}

const moduleBuiltin = Object.assign(
  function Module() {},
  {
    builtinModules,
    isBuiltin: (s: string) => !!builtinName(s),
    createRequire: (from: string | URL) => {
      let f = String(from)
      if (f.startsWith('file://')) f = decodeURIComponent(new URL(f).pathname)
      const mod = createModule(f.endsWith('/') ? f + 'noop.js' : f, null)
      return mod.require
    },
    _cache: cache,
    _resolveFilename: (spec: string, parent: Mod | null) => (builtinName(spec) ? spec : resolveFrom(spec, parent?.path ?? (proc.cwd as () => string)())),
    _nodeModulePaths: nodePaths,
    _extensions: { '.js': () => {}, '.json': () => {} },
    wrap: (s: string) => `(function (exports, require, module, __filename, __dirname) { ${s}\n});`,
    register: () => {},
    syncBuiltinESMExports: () => {},
    findSourceMap: () => undefined,
    enableCompileCache: () => {},
  },
)

// ---------------- console ----------------
function installConsole() {
  const out = (s: string) => post({ type: 'stdout', data: s + '\n' })
  const err = (s: string) => post({ type: 'stderr', data: s + '\n' })
  let indent = ''
  const counts = new Map<string, number>()
  const times = new Map<string, number>()
  const c = console as unknown as Record<string, unknown>
  const ind = (s: string) => (indent ? s.replace(/^/gm, indent) : s)
  c.log = c.info = c.debug = (...a: unknown[]) => out(ind(format(...a)))
  c.error = c.warn = c.trace = (...a: unknown[]) => err(ind(format(...a)))
  c.dir = (o: unknown, opts?: object) => out(ind(inspect(o, opts as object)))
  c.table = (d: unknown) => out(ind(inspect(d)))
  c.group = (...a: unknown[]) => {
    if (a.length) out(ind(format(...a)))
    indent += '  '
  }
  c.groupEnd = () => void (indent = indent.slice(2))
  c.count = (l = 'default') => {
    const n = (counts.get(l) ?? 0) + 1
    counts.set(l, n)
    out(`${l}: ${n}`)
  }
  c.countReset = (l = 'default') => void counts.delete(l)
  c.time = (l = 'default') => void times.set(l, performance.now())
  c.timeEnd = c.timeLog = (l = 'default') => {
    const t = times.get(l)
    if (t !== undefined) out(`${l}: ${(performance.now() - t).toFixed(3)}ms`)
    if (c.timeEnd === c.timeLog) times.delete(l)
  }
  c.assert = (v: unknown, ...a: unknown[]) => {
    if (!v) err('Assertion failed' + (a.length ? ': ' + format(...a) : ''))
  }
}

// ---------------- boot ----------------
function start(m: StartMsg) {
  setSab(m.sab)
  proc = createProcess({ ...m, exit })
  g.process = proc
  g.global = globalThis
  g.Buffer = Buffer
  g.setTimeout = timers.setTimeout
  g.setInterval = timers.setInterval
  g.setImmediate = timers.setImmediate
  g.clearTimeout = g.clearInterval = g.clearImmediate = timers.clearTimeout
  g.fetch = (i: RequestInfo | URL, o?: RequestInit) => {
    const release = ref()
    return containerFetch(i, o).finally(release)
  }
  installConsole()

  // stdin keeps the process alive while someone is reading it
  const stdin = proc.stdin as EventEmitter & { resume(): unknown; pause(): unknown }
  let stdinRelease: (() => void) | null = null
  const origResume = stdin.resume.bind(stdin)
  const origPause = stdin.pause.bind(stdin)
  stdin.resume = () => {
    stdinRelease ??= ref()
    return origResume()
  }
  stdin.pause = () => {
    stdinRelease?.()
    stdinRelease = null
    return origPause()
  }
  stdin.on('end', () => (stdinRelease?.(), (stdinRelease = null)))

  setIdleHandler(() => {
    if (exiting) return
    try {
      if (proc.listenerCount('beforeExit')) {
        proc.emit('beforeExit', proc.exitCode ?? 0)
        // listeners may schedule more work; exit only if they did not
        nativeSetTimeout(() => {
          if (!exiting && activeRefs() <= 0) exit((proc.exitCode as number) ?? 0)
        }, 0)
      } else exit((proc.exitCode as number) ?? 0)
    } catch (e) {
      fatal(e)
    }
  })

  const entry = m.argv[1]
  const release = ref()
  try {
    if (!hasSync()) throw new Error('[clover] `node` requires a cross-origin isolated page (serve with COOP: same-origin + COEP: require-corp)')
    let resolved: string
    try {
      resolved = resolveFrom(entry.startsWith('/') ? entry : './' + entry, (proc.cwd as () => string)()) as string
    } catch (e) {
      if ((e as { code?: string }).code !== 'MODULE_NOT_FOUND') throw e
      throw Object.assign(new Error(`Cannot find module '${entry}'`), { code: 'MODULE_NOT_FOUND' })
    }
    const mod = createModule(resolved, null)
    mainModule = mod
    mod.require.main = mod
    cache[resolved] = mod
    const { code, format: fmt } = syncCall<{ code: string; format: string }>('load', resolved)
    if (fmt === 'json') mod.exports = JSON.parse(code)
    else {
      const body = (code.startsWith('#!') ? '//' + code : code) + `\n//# sourceURL=${resolved}`
      new Function('exports', 'require', 'module', '__filename', '__dirname', '__clover_meta_url', body).call(mod.exports, mod.exports, mod.require, mod, resolved, mod.path, 'file://' + resolved)
    }
    mod.loaded = true
  } catch (e) {
    fatal(e)
  } finally {
    release()
  }
}

self.addEventListener('error', (e) => {
  e.preventDefault()
  fatal(e.error ?? e.message)
})
self.addEventListener('unhandledrejection', (e) => {
  e.preventDefault()
  if (e.reason instanceof ExitSignal) return
  if (proc?.listenerCount('unhandledRejection')) proc.emit('unhandledRejection', e.reason, e.promise)
  else fatal(e.reason)
})

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const m = ev.data
  try {
    switch (m.type) {
      case 'start':
        start(m)
        break
      case 'stdin':
        ;(proc.stdin as unknown as { push(s: string): void }).push(m.data)
        break
      case 'stdin-end':
        ;(proc.stdin as unknown as { end(): void }).end()
        break
      case 'signal':
        if (proc.listenerCount(m.name)) proc.emit(m.name, m.name)
        else exit(130)
        break
      case 'async-result':
        handleAsyncResult(m)
        break
      case 'http-request':
      case 'http-abort':
        handleHttpMessage(m)
        break
    }
  } catch (e) {
    fatal(e)
  }
  // any ref changes during this task get re-evaluated
  scheduleIdleCheck()
}
