// Smaller node builtins: os, url, assert, querystring, crypto, readline, tty, net, timers, etc.
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { syncCall, ref } from '../rpc'
import { inspect, isDeepStrictEqual } from './util'

// ---------- os ----------
export const os = {
  EOL: '\n',
  platform: () => 'linux',
  type: () => 'Linux',
  arch: () => 'x64',
  release: () => '6.0.0-cresslet',
  version: () => '#1 SMP',
  machine: () => 'x86_64',
  hostname: () => 'cresslet',
  homedir: () => globalThis.process?.env?.HOME ?? '/home',
  tmpdir: () => '/tmp',
  userInfo: () => ({ username: 'cresslet', uid: 1000, gid: 1000, shell: '/bin/jsh', homedir: os.homedir() }),
  cpus: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({ model: 'virtual', speed: 2000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } })),
  availableParallelism: () => navigator.hardwareConcurrency || 4,
  totalmem: () => 8 * 1024 ** 3,
  freemem: () => 4 * 1024 ** 3,
  uptime: () => Math.floor(performance.now() / 1000),
  loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({ lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] }),
  endianness: () => 'LE',
  constants: { signals: { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }, errno: {} },
  devNull: '/dev/null',
}

// ---------- url ----------
export const url = {
  URL,
  URLSearchParams,
  fileURLToPath: (u: string | URL) => decodeURIComponent(new URL(String(u)).pathname),
  pathToFileURL: (p: string) => new URL('file://' + encodeURI(p.startsWith('/') ? p : `${globalThis.process.cwd()}/${p}`)),
  parse(s: string, parseQuery?: boolean) {
    let u: URL
    const hasProto = /^[a-z][a-z0-9+.-]*:/i.test(s)
    try {
      u = new URL(s, hasProto ? undefined : 'http://__relative__')
    } catch {
      return { href: s, path: s, pathname: s, search: null, query: null, hash: null }
    }
    const rel = !hasProto
    const search = u.search || null
    return {
      protocol: rel ? null : u.protocol,
      slashes: rel ? null : s.includes('//'),
      auth: u.username ? `${u.username}${u.password ? ':' + u.password : ''}` : null,
      host: rel ? null : u.host,
      port: rel ? null : u.port || null,
      hostname: rel ? null : u.hostname,
      hash: u.hash || null,
      search,
      query: parseQuery ? Object.fromEntries(u.searchParams) : search ? search.slice(1) : null,
      pathname: u.pathname,
      path: u.pathname + (u.search || ''),
      href: rel ? s : u.href,
    }
  },
  format(o: string | URL | Record<string, unknown>) {
    if (typeof o === 'string') return o
    if (o instanceof URL) return o.href
    const proto = (o.protocol as string) ?? ''
    const host = (o.host as string) ?? `${o.hostname ?? ''}${o.port ? ':' + o.port : ''}`
    let q = (o.search as string) ?? ''
    if (!q && o.query && typeof o.query === 'object') q = '?' + new URLSearchParams(o.query as Record<string, string>).toString()
    return `${proto}${proto || host ? '//' : ''}${host}${(o.pathname as string) ?? ''}${q}${(o.hash as string) ?? ''}`
  },
  resolve: (from: string, to: string) => new URL(to, new URL(from, 'resolve://')).href.replace(/^resolve:\/\//, ''),
  domainToASCII: (d: string) => d,
  domainToUnicode: (d: string) => d,
}

// ---------- querystring ----------
export const querystring = {
  parse(s: string, sep = '&', eq = '=') {
    const out: Record<string, string | string[]> = {}
    for (const part of (s || '').split(sep)) {
      if (!part) continue
      const i = part.indexOf(eq)
      const k = decode(i < 0 ? part : part.slice(0, i))
      const v = i < 0 ? '' : decode(part.slice(i + 1))
      const cur = out[k]
      out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v]
    }
    return out
  },
  stringify(o: Record<string, unknown>, sep = '&', eq = '=') {
    return Object.entries(o ?? {})
      .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${encodeURIComponent(k)}${eq}${encodeURIComponent(x == null ? '' : String(x))}`))
      .join(sep)
  },
  escape: encodeURIComponent,
  unescape: decodeURIComponent,
}
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}
;(querystring as Record<string, unknown>).decode = querystring.parse
;(querystring as Record<string, unknown>).encode = querystring.stringify

// ---------- assert ----------
export class AssertionError extends Error {
  code = 'ERR_ASSERTION'
  constructor(o: { message?: string; actual?: unknown; expected?: unknown; operator?: string }) {
    super(o.message ?? `${inspect(o.actual)} ${o.operator} ${inspect(o.expected)}`)
    this.name = 'AssertionError'
    Object.assign(this, { actual: o.actual, expected: o.expected, operator: o.operator })
  }
}
const fail = (actual: unknown, expected: unknown, message: unknown, operator: string): never => {
  if (message instanceof Error) throw message
  throw new AssertionError({ message: message as string | undefined, actual, expected, operator })
}
const looseEq = (a: unknown, b: unknown): boolean => {
  // eslint-disable-next-line eqeqeq
  if (a == b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => looseEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
function assertFn(v: unknown, msg?: unknown) {
  if (!v) fail(v, true, msg ?? 'The expression evaluated to a falsy value', '==')
}
const matchesErr = (e: unknown, exp: unknown) => {
  if (!exp) return true
  if (typeof exp === 'function') return (exp as { prototype?: unknown }).prototype !== undefined && e instanceof (exp as new () => unknown) ? true : (exp as (e: unknown) => boolean)(e) === true
  if (exp instanceof RegExp) return exp.test(String((e as Error)?.message ?? e))
  if (typeof exp === 'object') return Object.entries(exp as object).every(([k, v]) => (v instanceof RegExp ? v.test((e as Record<string, string>)[k]) : isDeepStrictEqual((e as Record<string, unknown>)[k], v)))
  return true
}
export const assert = Object.assign(assertFn, {
  ok: assertFn,
  AssertionError,
  fail: (msg?: string) => fail(undefined, undefined, msg ?? 'Failed', 'fail'),
  equal: (a: unknown, b: unknown, m?: unknown) => void (a == b || fail(a, b, m, '==')),
  notEqual: (a: unknown, b: unknown, m?: unknown) => void (a != b || fail(a, b, m, '!=')),
  strictEqual: (a: unknown, b: unknown, m?: unknown) => void (Object.is(a, b) || fail(a, b, m, 'strictEqual')),
  notStrictEqual: (a: unknown, b: unknown, m?: unknown) => void (!Object.is(a, b) || fail(a, b, m, 'notStrictEqual')),
  deepEqual: (a: unknown, b: unknown, m?: unknown) => void (looseEq(a, b) || fail(a, b, m, 'deepEqual')),
  notDeepEqual: (a: unknown, b: unknown, m?: unknown) => void (!looseEq(a, b) || fail(a, b, m, 'notDeepEqual')),
  deepStrictEqual: (a: unknown, b: unknown, m?: unknown) => void (isDeepStrictEqual(a, b) || fail(a, b, m, 'deepStrictEqual')),
  notDeepStrictEqual: (a: unknown, b: unknown, m?: unknown) => void (!isDeepStrictEqual(a, b) || fail(a, b, m, 'notDeepStrictEqual')),
  throws(fn: () => unknown, exp?: unknown, m?: unknown) {
    try {
      fn()
    } catch (e) {
      if (!matchesErr(e, exp)) throw e
      return
    }
    fail(undefined, exp, typeof exp === 'string' ? exp : m ?? 'Missing expected exception.', 'throws')
  },
  doesNotThrow(fn: () => unknown) {
    fn()
  },
  async rejects(p: Promise<unknown> | (() => Promise<unknown>), exp?: unknown, m?: unknown) {
    try {
      await (typeof p === 'function' ? p() : p)
    } catch (e) {
      if (!matchesErr(e, exp)) throw e
      return
    }
    fail(undefined, exp, m ?? 'Missing expected rejection.', 'rejects')
  },
  async doesNotReject(p: Promise<unknown> | (() => Promise<unknown>)) {
    await (typeof p === 'function' ? p() : p)
  },
  match: (s: string, re: RegExp, m?: unknown) => void (re.test(s) || fail(s, re, m, 'match')),
  doesNotMatch: (s: string, re: RegExp, m?: unknown) => void (!re.test(s) || fail(s, re, m, 'doesNotMatch')),
  ifError: (e: unknown) => {
    if (e != null) throw e
  },
})
;(assert as unknown as Record<string, unknown>).strict = assert

// ---------- crypto ----------
class Hash {
  private parts: Uint8Array[] = []
  constructor(
    private alg: string,
    private key?: Uint8Array,
  ) {}
  update(d: string | Uint8Array, enc?: BufferEncoding) {
    this.parts.push(typeof d === 'string' ? Buffer.from(d, enc ?? 'utf8') : d)
    return this
  }
  digest(enc?: BufferEncoding) {
    const data = Buffer.concat(this.parts)
    const out = Buffer.from(this.key ? syncCall<Uint8Array>('hmac', this.alg, this.key, data) : syncCall<Uint8Array>('hash', this.alg, data))
    return enc ? out.toString(enc) : out
  }
  copy() {
    const h = new Hash(this.alg, this.key)
    h.parts = [...this.parts]
    return h
  }
}
export const crypto = {
  webcrypto: globalThis.crypto,
  subtle: globalThis.crypto.subtle,
  getRandomValues: <T extends ArrayBufferView>(a: T) => globalThis.crypto.getRandomValues(a as unknown as Uint8Array) as unknown as T,
  randomUUID: () => globalThis.crypto.randomUUID(),
  randomBytes(n: number, cb?: (e: Error | null, b: Buffer) => void) {
    const b = Buffer.alloc(n)
    for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536)))
    if (cb) queueMicrotask(() => cb(null, b))
    return b
  },
  randomFillSync<T extends ArrayBufferView>(b: T) {
    globalThis.crypto.getRandomValues(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))
    return b
  },
  randomInt(min: number, max?: number) {
    if (max === undefined) [min, max] = [0, min]
    return min + Math.floor((globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * (max - min))
  },
  createHash: (alg: string) => new Hash(alg),
  createHmac: (alg: string, key: string | Uint8Array) => new Hash(alg, typeof key === 'string' ? Buffer.from(key) : key),
  getHashes: () => ['sha1', 'sha256', 'sha384', 'sha512'],
  timingSafeEqual: (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]),
  hash: (alg: string, data: string | Uint8Array, enc: BufferEncoding = 'hex') => new Hash(alg).update(data).digest(enc),
  createCipheriv: unsupportedFn('crypto.createCipheriv'),
  createDecipheriv: unsupportedFn('crypto.createDecipheriv'),
  pbkdf2Sync: unsupportedFn('crypto.pbkdf2Sync'),
  scryptSync: unsupportedFn('crypto.scryptSync'),
  generateKeyPairSync: unsupportedFn('crypto.generateKeyPairSync'),
  constants: {},
}

// ---------- readline ----------
class Interface extends EventEmitter {
  private buf = ''
  private release: () => void
  private pending: ((s: string) => void)[] = []
  closed = false
  terminal = false
  line = ''
  constructor(private opts: { input?: EventEmitter & { resume?(): void }; output?: { write(s: string): void }; prompt?: string }) {
    super()
    this.release = ref()
    const input = opts.input
    input?.on('data', (d: unknown) => {
      this.buf += String(d)
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        const p = this.pending.shift()
        if (p) p(line)
        else this.emit('line', line)
      }
    })
    input?.on('end', () => this.close())
    input?.resume?.()
  }
  setPrompt(p: string) {
    this.opts.prompt = p
  }
  getPrompt() {
    return this.opts.prompt ?? '> '
  }
  prompt() {
    this.opts.output?.write(this.getPrompt())
  }
  question(q: string, a?: unknown, b?: unknown) {
    const cb = (typeof a === 'function' ? a : b) as ((s: string) => void) | undefined
    this.opts.output?.write(q)
    if (cb) this.pending.push(cb)
    else return new Promise<string>((r) => this.pending.push(r))
  }
  write(s: string) {
    this.opts.output?.write(s)
  }
  pause() {
    return this
  }
  resume() {
    return this
  }
  close() {
    if (this.closed) return
    this.closed = true
    if (this.buf) this.emit('line', this.buf)
    this.emit('close')
    this.release()
  }
  async *[Symbol.asyncIterator]() {
    const q: string[] = []
    let wake: (() => void) | null = null
    this.on('line', (l) => (q.push(l), wake?.()))
    this.on('close', () => wake?.())
    while (true) {
      if (q.length) yield q.shift()!
      else if (this.closed) return
      else await new Promise<void>((r) => (wake = r))
    }
  }
}
export const readline = {
  createInterface: (input: unknown, output?: unknown) =>
    new Interface(input && typeof input === 'object' && 'input' in (input as object) ? (input as ConstructorParameters<typeof Interface>[0]) : { input: input as EventEmitter, output: output as { write(s: string): void } }),
  Interface,
  clearLine: (s: { write(x: string): void }, _d?: number, cb?: () => void) => (s.write('\x1b[2K'), cb?.(), true),
  cursorTo: (s: { write(x: string): void }, x: number, _y?: unknown, cb?: () => void) => (s.write(`\x1b[${x + 1}G`), cb?.(), true),
  moveCursor: (s: { write(x: string): void }, dx: number, dy: number, cb?: () => void) => {
    if (dx) s.write(dx > 0 ? `\x1b[${dx}C` : `\x1b[${-dx}D`)
    if (dy) s.write(dy > 0 ? `\x1b[${dy}B` : `\x1b[${-dy}A`)
    cb?.()
    return true
  },
  clearScreenDown: (s: { write(x: string): void }) => (s.write('\x1b[J'), true),
  emitKeypressEvents: () => {},
}

// ---------- net / tty / misc ----------
const isIPv4 = (s: string) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s)
const isIPv6 = (s: string) => s.includes(':') && /^[0-9a-f:.]+$/i.test(s)
export const net = {
  isIP: (s: string) => (isIPv4(s) ? 4 : isIPv6(s) ? 6 : 0),
  isIPv4,
  isIPv6,
  createServer: unsupportedFn('net.createServer'),
  createConnection: unsupportedFn('net.createConnection'),
  connect: unsupportedFn('net.connect'),
  Socket: class {
    constructor() {
      throw unsupported('net.Socket')
    }
  },
  Server: class {
    constructor() {
      throw unsupported('net.Server')
    }
  },
}
export const tty = { isatty: (fd: number) => !!(fd <= 2 && globalThis.process?.stdout?.isTTY), ReadStream: class {}, WriteStream: class {} }

export const asyncHooks = {
  AsyncLocalStorage: class<T> {
    private store: T | undefined
    getStore() {
      return this.store
    }
    run<R>(store: T, fn: (...a: unknown[]) => R, ...args: unknown[]): R {
      const prev = this.store
      this.store = store
      try {
        const r = fn(...args)
        if (r instanceof Promise) return r.finally(() => (this.store = prev)) as R
        this.store = prev
        return r
      } catch (e) {
        this.store = prev
        throw e
      }
    }
    enterWith(store: T) {
      this.store = store
    }
    exit<R>(fn: (...a: unknown[]) => R, ...a: unknown[]) {
      return fn(...a)
    }
    disable() {}
  },
  AsyncResource: class {
    constructor(public type: string) {}
    runInAsyncScope<R>(fn: (...a: unknown[]) => R, thisArg?: unknown, ...a: unknown[]) {
      return fn.apply(thisArg, a)
    }
    emitDestroy() {
      return this
    }
    bind<F>(fn: F) {
      return fn
    }
    static bind<F>(fn: F) {
      return fn
    }
  },
  createHook: () => ({ enable() {}, disable() {} }),
  executionAsyncId: () => 1,
  triggerAsyncId: () => 0,
}

export const vm = {
  runInThisContext: (code: string) => (0, eval)(code),
  runInNewContext: (code: string, ctx: Record<string, unknown> = {}) => new Function(...Object.keys(ctx), `return eval(${JSON.stringify(code)})`)(...Object.values(ctx)),
  createContext: (o: object = {}) => o,
  isContext: () => true,
  Script: class {
    constructor(private code: string) {}
    runInThisContext() {
      return (0, eval)(this.code)
    }
    runInNewContext(ctx: Record<string, unknown> = {}) {
      return vm.runInNewContext(this.code, ctx)
    }
    runInContext(ctx: Record<string, unknown> = {}) {
      return vm.runInNewContext(this.code, ctx)
    }
  },
}

export const workerThreads = { isMainThread: true, parentPort: null, workerData: null, threadId: 0, Worker: class { constructor() { throw unsupported('worker_threads.Worker') } }, MessageChannel, MessagePort, BroadcastChannel }

export const perfHooks = { performance: globalThis.performance, PerformanceObserver: class { observe() {} disconnect() {} }, monitorEventLoopDelay: () => ({ enable() {}, disable() {}, percentile: () => 0 }) }

export const diagnosticsChannel = {
  channel: () => ({ hasSubscribers: false, publish() {}, subscribe() {}, unsubscribe() {} }),
  hasSubscribers: () => false,
  subscribe() {},
  unsubscribe() {},
  tracingChannel: () => ({ hasSubscribers: false, traceSync: (fn: () => unknown) => fn(), tracePromise: (fn: () => unknown) => fn(), subscribe() {}, unsubscribe() {} }),
}

export function unsupported(what: string): Error {
  return Object.assign(new Error(`[cresslet] ${what} is not supported in the browser runtime`), { code: 'ERR_CRESSLET_UNSUPPORTED' })
}
export function unsupportedFn(what: string) {
  return () => {
    throw unsupported(what)
  }
}
/** Module whose every function export throws a clear error when called. */
export function unsupportedModule(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(extra, {
    get(t, k) {
      if (k in t) return t[k as string]
      if (k === '__esModule' || typeof k === 'symbol' || k === 'then' || k === 'default') return undefined
      return unsupportedFn(`${name}.${String(k)}`)
    },
  })
}
