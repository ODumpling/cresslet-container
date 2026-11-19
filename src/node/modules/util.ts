// node:util polyfill (subset).

const kCustom = Symbol.for('nodejs.util.inspect.custom')
const kPromisify = Symbol.for('nodejs.util.promisify.custom')

interface InspectOpts {
  depth?: number
  colors?: boolean
  compact?: boolean | number
  breakLength?: number
}

export function inspect(v: unknown, opts: InspectOpts | boolean = {}): string {
  const o: InspectOpts = typeof opts === 'boolean' ? { depth: 2 } : opts
  const seen = new Set<unknown>()
  const depth = o.depth ?? 2
  const fmt = (x: unknown, d: number, top = false): string => {
    if (x === null) return 'null'
    switch (typeof x) {
      case 'string':
        return top ? x : `'${x.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
      case 'number':
        return Object.is(x, -0) ? '-0' : String(x)
      case 'bigint':
        return `${x}n`
      case 'undefined':
        return 'undefined'
      case 'boolean':
        return String(x)
      case 'symbol':
        return x.toString()
      case 'function': {
        const name = (x as { name?: string }).name
        const isClass = /^class\s/.test(Function.prototype.toString.call(x))
        const keys = Object.keys(x)
        const base = isClass ? `[class ${name || '(anonymous)'}]` : `[Function: ${name || '(anonymous)'}]`
        return keys.length && d <= depth ? `${base} ${fmtObj(x as object, d, keys)}` : base
      }
    }
    const obj = x as Record<string | symbol, unknown>
    if (typeof obj[kCustom] === 'function') {
      const r = (obj[kCustom] as (d: number, o: InspectOpts, i: typeof inspect) => unknown)(depth - d, o, inspect)
      return typeof r === 'string' ? r : fmt(r, d)
    }
    if (seen.has(x)) return '[Circular *1]'
    if (x instanceof Error) return x.stack || `${x.name}: ${x.message}`
    if (x instanceof Date) return isNaN(x.getTime()) ? 'Invalid Date' : x.toISOString()
    if (x instanceof RegExp) return String(x)
    if (x instanceof Promise) return 'Promise { <pending> }'
    if (x instanceof WeakMap) return 'WeakMap { <items unknown> }'
    if (x instanceof WeakSet) return 'WeakSet { <items unknown> }'
    if (typeof globalThis.Buffer !== 'undefined' && globalThis.Buffer.isBuffer(x)) {
      const b = x as unknown as Uint8Array
      const hex = [...b.subarray(0, 50)].map((n) => n.toString(16).padStart(2, '0')).join(' ')
      return `<Buffer ${hex}${b.length > 50 ? ` ... ${b.length - 50} more bytes` : ''}>`
    }
    if (d > depth) return Array.isArray(x) ? '[Array]' : `[${ctorName(x) || 'Object'}]`
    seen.add(x)
    try {
      if (Array.isArray(x)) {
        const items = x.slice(0, 100).map((i) => fmt(i, d + 1))
        if (x.length > 100) items.push(`... ${x.length - 100} more items`)
        return wrap(items, '[', ']', d)
      }
      if (ArrayBuffer.isView(x)) {
        const arr = Array.from(x as unknown as ArrayLike<number>).slice(0, 100).map(String)
        return `${ctorName(x)}(${(x as unknown as ArrayLike<number>).length}) ${wrap(arr, '[', ']', d)}`
      }
      if (x instanceof Map) return `Map(${x.size}) ${wrap([...x].map(([k, v]) => `${fmt(k, d + 1)} => ${fmt(v, d + 1)}`), '{', '}', d)}`
      if (x instanceof Set) return `Set(${x.size}) ${wrap([...x].map((v) => fmt(v, d + 1)), '{', '}', d)}`
      const name = ctorName(x)
      const body = fmtObj(x as object, d, Object.keys(x))
      return name && name !== 'Object' ? `${name} ${body}` : body
    } finally {
      seen.delete(x)
    }
  }
  const fmtObj = (x: object, d: number, keys: string[]) => {
    const rec = x as Record<string, unknown>
    const items = keys.map((k) => {
      const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`
      const desc = Object.getOwnPropertyDescriptor(x, k)
      if (desc?.get) return `${key}: [Getter${desc.set ? '/Setter' : ''}]`
      return `${key}: ${fmt(rec[k], d + 1)}`
    })
    for (const sym of Object.getOwnPropertySymbols(x)) if (Object.getOwnPropertyDescriptor(x, sym)?.enumerable) items.push(`[${sym.toString()}]: ${fmt(rec[sym as unknown as string], d + 1)}`)
    return items.length ? wrap(items, '{', '}', d) : '{}'
  }
  const wrap = (items: string[], open: string, close: string, d: number) => {
    if (!items.length) return `${open}${close}`
    const one = `${open} ${items.join(', ')} ${close}`
    if (one.length <= (o.breakLength ?? 72) && !one.includes('\n')) return one
    const pad = '  '.repeat(d + 1)
    return `${open}\n${items.map((i) => pad + i).join(',\n')}\n${'  '.repeat(d)}${close}`
  }
  return fmt(v, 0, false)
}
inspect.custom = kCustom
inspect.defaultOptions = { depth: 2 }

function ctorName(x: unknown): string {
  const p = Object.getPrototypeOf(x)
  if (p === null) return '[Object: null prototype]'
  return p?.constructor?.name ?? ''
}

export function format(f?: unknown, ...args: unknown[]): string {
  if (typeof f !== 'string') return [f, ...args].map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ')
  let i = 0
  let out = f.replace(/%([sdifjoOc%])/g, (m, c) => {
    if (c === '%') return '%'
    if (i >= args.length) return m
    const a = args[i++]
    switch (c) {
      case 's':
        return typeof a === 'string' ? a : typeof a === 'object' && a !== null ? inspect(a, { depth: 0 }) : String(a)
      case 'd':
      case 'i':
        return typeof a === 'bigint' ? `${a}n` : String(c === 'i' ? parseInt(String(a), 10) : Number(a))
      case 'f':
        return String(parseFloat(String(a)))
      case 'j':
        try {
          return JSON.stringify(a)
        } catch {
          return '[Circular]'
        }
      case 'c':
        return ''
      default:
        return inspect(a)
    }
  })
  for (; i < args.length; i++) out += ' ' + (typeof args[i] === 'string' ? args[i] : inspect(args[i]))
  return out
}

export function promisify<T extends (...a: never[]) => unknown>(fn: T): (...a: unknown[]) => Promise<unknown> {
  const custom = (fn as unknown as Record<symbol, unknown>)[kPromisify]
  if (typeof custom === 'function') return custom as (...a: unknown[]) => Promise<unknown>
  return function (this: unknown, ...args: unknown[]) {
    return new Promise((res, rej) => (fn as unknown as (...a: unknown[]) => void).call(this, ...args, (e: unknown, v: unknown) => (e ? rej(e) : res(v))))
  }
}
promisify.custom = kPromisify

export function callbackify(fn: (...a: unknown[]) => Promise<unknown>) {
  return (...args: unknown[]) => {
    const cb = args.pop() as (e: unknown, v?: unknown) => void
    fn(...args).then(
      (v) => cb(null, v),
      (e) => cb(e),
    )
  }
}

export function inherits(ctor: { prototype: object; super_?: unknown }, superCtor: { prototype: object }) {
  ctor.super_ = superCtor
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype)
}

export function deprecate<T extends (...a: unknown[]) => unknown>(fn: T, msg?: string): T {
  let warned = false
  return function (this: unknown, ...a: unknown[]) {
    if (!warned && msg) {
      warned = true
      globalThis.process?.emitWarning?.(`DeprecationWarning: ${msg}`)
    }
    return fn.apply(this, a)
  } as T
}

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (a instanceof Date) return a.getTime() === (b as Date).getTime()
  if (a instanceof Map) return a.size === (b as Map<unknown, unknown>).size && [...a].every(([k, v]) => isDeepStrictEqual(v, (b as Map<unknown, unknown>).get(k)))
  if (a instanceof Set) return a.size === (b as Set<unknown>).size && [...a].every((v) => (b as Set<unknown>).has(v))
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => isDeepStrictEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const tag = (x: unknown) => Object.prototype.toString.call(x).slice(8, -1)
export const types = {
  isPromise: (x: unknown) => x instanceof Promise,
  isRegExp: (x: unknown) => x instanceof RegExp,
  isDate: (x: unknown) => x instanceof Date,
  isMap: (x: unknown) => x instanceof Map,
  isSet: (x: unknown) => x instanceof Set,
  isNativeError: (x: unknown) => x instanceof Error,
  isTypedArray: (x: unknown) => ArrayBuffer.isView(x) && !(x instanceof DataView),
  isUint8Array: (x: unknown) => x instanceof Uint8Array,
  isArrayBuffer: (x: unknown) => x instanceof ArrayBuffer,
  isAnyArrayBuffer: (x: unknown) => x instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer),
  isArrayBufferView: (x: unknown) => ArrayBuffer.isView(x),
  isAsyncFunction: (x: unknown) => tag(x) === 'AsyncFunction',
  isGeneratorFunction: (x: unknown) => tag(x) === 'GeneratorFunction' || tag(x) === 'AsyncGeneratorFunction',
  isGeneratorObject: (x: unknown) => tag(x) === 'Generator',
  isBoxedPrimitive: (x: unknown) => x instanceof Number || x instanceof String || x instanceof Boolean,
  isProxy: () => false,
  isWeakMap: (x: unknown) => x instanceof WeakMap,
  isWeakSet: (x: unknown) => x instanceof WeakSet,
  isDataView: (x: unknown) => x instanceof DataView,
  isKeyObject: () => false,
  isCryptoKey: () => false,
}

export function debuglog(section: string) {
  const enabled = new RegExp(`\\b${section}\\b`, 'i').test(globalThis.process?.env?.NODE_DEBUG ?? '')
  const fn = (...a: unknown[]) => enabled && globalThis.process.stderr.write(`${section.toUpperCase()}: ${format(...a)}\n`)
  fn.enabled = enabled
  return fn
}

export const stripVTControlCharacters = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

const STYLES: Record<string, [number, number]> = { bold: [1, 22], dim: [2, 22], italic: [3, 23], underline: [4, 24], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], white: [37, 39], gray: [90, 39], grey: [90, 39] }
export function styleText(f: string | string[], text: string) {
  for (const s of Array.isArray(f) ? f : [f]) {
    const c = STYLES[s]
    if (c) text = `\x1b[${c[0]}m${text}\x1b[${c[1]}m`
  }
  return text
}

const util = {
  inspect,
  format,
  formatWithOptions: (_o: unknown, ...a: unknown[]) => format(...a),
  promisify,
  callbackify,
  inherits,
  deprecate,
  isDeepStrictEqual,
  types,
  debuglog,
  debug: debuglog,
  stripVTControlCharacters,
  styleText,
  TextEncoder,
  TextDecoder,
  isArray: Array.isArray,
  isError: (x: unknown) => x instanceof Error,
  isFunction: (x: unknown) => typeof x === 'function',
  isString: (x: unknown) => typeof x === 'string',
  isNumber: (x: unknown) => typeof x === 'number',
  isObject: (x: unknown) => x !== null && typeof x === 'object',
  isPrimitive: (x: unknown) => x === null || (typeof x !== 'object' && typeof x !== 'function'),
  isUndefined: (x: unknown) => x === undefined,
  isNullOrUndefined: (x: unknown) => x == null,
  isRegExp: types.isRegExp,
  isDate: types.isDate,
  toUSVString: (s: string) => s,
  aborted: (signal: AbortSignal) => new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true })),
}
export default util
