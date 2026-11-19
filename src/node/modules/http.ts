// node:http polyfill: createServer().listen(port) registers a virtual container port; requests arrive
// from the main thread (service worker bridge). http.request/get are implemented over fetch.
import { Buffer } from 'buffer'
import { EventEmitter } from 'events'
import { Readable, Writable } from 'readable-stream'
import { asyncCall, post, ref } from '../rpc'
import type { MainToWorker } from '../protocol'

export const STATUS_CODES: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable',
  409: 'Conflict', 410: 'Gone', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
}
export const METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'CONNECT', 'TRACE']

class FakeSocket extends EventEmitter {
  remoteAddress = '127.0.0.1'
  remotePort = 50000
  localAddress = '127.0.0.1'
  localPort: number
  encrypted = false
  readable = true
  writable = true
  constructor(port: number) {
    super()
    this.localPort = port
  }
  setTimeout() {
    return this
  }
  setNoDelay() {
    return this
  }
  setKeepAlive() {
    return this
  }
  destroy() {
    return this
  }
  end() {
    return this
  }
  write() {
    return true
  }
  address() {
    return { address: '127.0.0.1', family: 'IPv4', port: this.localPort }
  }
  ref() {
    return this
  }
  unref() {
    return this
  }
}

export class IncomingMessage extends Readable {
  method = 'GET'
  url = '/'
  headers: Record<string, string> = {}
  rawHeaders: string[] = []
  httpVersion = '1.1'
  httpVersionMajor = 1
  httpVersionMinor = 1
  statusCode?: number
  statusMessage?: string
  socket: FakeSocket
  connection: FakeSocket
  complete = false
  trailers = {}
  aborted = false
  constructor(socket?: FakeSocket) {
    super()
    this.socket = this.connection = socket ?? new FakeSocket(0)
  }
  _read() {}
  setTimeout() {
    return this
  }
}

export class OutgoingMessage extends Writable {
  protected _headers = new Map<string, [string, string | string[]]>()
  headersSent = false
  finished = false
  sendDate = true
  getHeader(n: string) {
    return this._headers.get(n.toLowerCase())?.[1]
  }
  setHeader(n: string, v: string | number | string[]) {
    this._headers.set(n.toLowerCase(), [n, Array.isArray(v) ? v.map(String) : String(v)])
    return this
  }
  appendHeader(n: string, v: string | string[]) {
    const cur = this.getHeader(n)
    const add = Array.isArray(v) ? v : [v]
    this.setHeader(n, cur === undefined ? add : [...(Array.isArray(cur) ? cur : [cur]), ...add])
    return this
  }
  hasHeader(n: string) {
    return this._headers.has(n.toLowerCase())
  }
  removeHeader(n: string) {
    this._headers.delete(n.toLowerCase())
  }
  getHeaders() {
    return Object.fromEntries([...this._headers].map(([k, [, v]]) => [k, v]))
  }
  getHeaderNames() {
    return [...this._headers.keys()]
  }
  flushHeaders() {}
  setTimeout() {
    return this
  }
}

export class ServerResponse extends OutgoingMessage {
  statusCode = 200
  statusMessage = ''
  req: IncomingMessage
  socket: FakeSocket
  connection: FakeSocket
  private id: number
  constructor(req: IncomingMessage, id: number) {
    super()
    this.req = req
    this.id = id
    this.socket = this.connection = req.socket
  }
  writeHead(status: number, msg?: string | Record<string, unknown> | unknown[], headers?: Record<string, unknown> | unknown[]) {
    this.statusCode = status
    if (typeof msg === 'string') this.statusMessage = msg
    else headers = msg
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) this.setHeader(String(headers[i]), headers[i + 1] as string)
    } else if (headers) for (const [k, v] of Object.entries(headers)) if (v !== undefined) this.setHeader(k, v as string)
    return this
  }
  writeContinue() {}
  writeEarlyHints() {}
  private sendHead() {
    if (this.headersSent) return
    this.headersSent = true
    const hdrs: [string, string][] = []
    for (const [, [name, v]] of this._headers) for (const x of Array.isArray(v) ? v : [v]) hdrs.push([name, x])
    if (this.sendDate && !this._headers.has('date')) hdrs.push(['Date', new Date().toUTCString()])
    post({ type: 'http-head', id: this.id, status: this.statusCode, statusText: this.statusMessage || STATUS_CODES[this.statusCode] || '', headers: hdrs })
  }
  _write(chunk: unknown, enc: BufferEncoding, cb: () => void) {
    this.sendHead()
    const b = typeof chunk === 'string' ? Buffer.from(chunk, enc) : Buffer.from(chunk as Uint8Array)
    if (b.byteLength && this.req.method !== 'HEAD') post({ type: 'http-chunk', id: this.id, data: new Uint8Array(b) })
    cb()
  }
  _final(cb: () => void) {
    this.sendHead()
    post({ type: 'http-end', id: this.id })
    this.finished = true
    cb()
  }
}

const servers = new Map<number, Server>()
const inflight = new Map<number, ServerResponse>()
let autoPort = 3000

export class Server extends EventEmitter {
  listening = false
  private port = 0
  private release: (() => void) | null = null
  timeout = 0
  keepAliveTimeout = 5000
  headersTimeout = 60000
  requestTimeout = 300000
  maxHeadersCount = null
  constructor(opts?: unknown, listener?: (req: IncomingMessage, res: ServerResponse) => void) {
    super()
    if (typeof opts === 'function') listener = opts as typeof listener
    if (listener) this.on('request', listener)
  }
  listen(...args: unknown[]) {
    const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as () => void) : undefined
    let port: number
    const first = args[0]
    if (first && typeof first === 'object') port = Number((first as { port?: number }).port ?? 0)
    else port = Number(first ?? 0)
    if (!port) {
      while (servers.has(autoPort)) autoPort++
      port = autoPort++
    }
    if (servers.has(port)) {
      queueMicrotask(() => this.emit('error', Object.assign(new Error(`listen EADDRINUSE: address already in use :::${port}`), { code: 'EADDRINUSE', port })))
      return this
    }
    this.port = port
    servers.set(port, this)
    this.release = ref()
    this.listening = true
    post({ type: 'listen', port })
    if (cb) this.once('listening', cb)
    queueMicrotask(() => this.emit('listening'))
    return this
  }
  address() {
    return this.listening ? { address: '::', family: 'IPv6', port: this.port } : null
  }
  close(cb?: (e?: Error) => void) {
    if (this.listening) {
      servers.delete(this.port)
      post({ type: 'unlisten', port: this.port })
      this.listening = false
      this.release?.()
      queueMicrotask(() => this.emit('close'))
    }
    if (cb) queueMicrotask(() => cb())
    return this
  }
  closeAllConnections() {}
  closeIdleConnections() {}
  setTimeout() {
    return this
  }
  ref() {
    return this
  }
  unref() {
    this.release?.()
    return this
  }
  /** @internal */
  _handle(m: Extract<MainToWorker, { type: 'http-request' }>) {
    const sock = new FakeSocket(this.port)
    const req = new IncomingMessage(sock)
    req.method = m.method
    req.url = m.url
    for (const [k, v] of m.headers) {
      const key = k.toLowerCase()
      req.rawHeaders.push(k, v)
      req.headers[key] = key in req.headers ? `${req.headers[key]}, ${v}` : v
    }
    req.headers.host ??= `localhost:${this.port}`
    const res = new ServerResponse(req, m.id)
    inflight.set(m.id, res)
    res.on('finish', () => {
      inflight.delete(m.id)
      res.emit('close')
    })
    this.emit('connection', sock)
    this.emit('request', req, res)
    if (m.body && m.body.byteLength) req.push(Buffer.from(m.body))
    req.push(null)
    req.complete = true
  }
}

export function handleHttpMessage(m: MainToWorker): void {
  if (m.type === 'http-request') {
    const s = servers.get(m.port)
    if (!s) {
      post({ type: 'http-head', id: m.id, status: 502, statusText: 'Bad Gateway', headers: [] })
      post({ type: 'http-end', id: m.id })
      return
    }
    try {
      s._handle(m)
    } catch (e) {
      post({ type: 'http-head', id: m.id, status: 500, statusText: 'Internal Server Error', headers: [['content-type', 'text/plain']] })
      post({ type: 'http-chunk', id: m.id, data: new TextEncoder().encode(String((e as Error)?.stack ?? e)) })
      post({ type: 'http-end', id: m.id })
    }
  } else if (m.type === 'http-abort') {
    const res = inflight.get(m.id)
    res?.req.emit('aborted')
    res?.emit('close')
    inflight.delete(m.id)
  }
}

export function createServer(opts?: unknown, listener?: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Server(opts, listener)
}

/** Whether a URL targets a container-local port. */
export function localPort(u: URL): number | null {
  if (!['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)) return null
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
  return port
}

/** fetch() that routes localhost:<port> to container ports. */
export async function containerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init)
  const u = new URL(req.url)
  const port = localPort(u)
  if (port !== null) {
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
    const r = await asyncCall<{ status: number; statusText: string; headers: [string, string][]; body: Uint8Array }>('fetch-local', port, req.method, req.url, [...req.headers], body)
    return new Response(r.status === 204 || r.status === 304 ? null : (r.body as BlobPart), { status: r.status, statusText: r.statusText, headers: r.headers })
  }
  return nativeFetch(req)
}
const nativeFetch = globalThis.fetch.bind(globalThis)

export class ClientRequest extends OutgoingMessage {
  private chunks: Uint8Array[] = []
  private aborter = new AbortController()
  constructor(
    private url: URL,
    private opts: { method?: string; headers?: Record<string, string> },
    cb?: (res: IncomingMessage) => void,
  ) {
    super()
    if (cb) this.once('response', cb)
    for (const [k, v] of Object.entries(opts.headers ?? {})) this.setHeader(k, v)
  }
  _write(chunk: unknown, enc: BufferEncoding, cb: () => void) {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, enc) : (chunk as Uint8Array))
    cb()
  }
  _final(cb: () => void) {
    const release = ref()
    const method = (this.opts.method ?? 'GET').toUpperCase()
    const headers: [string, string][] = []
    for (const [, [n, v]] of this._headers) for (const x of Array.isArray(v) ? v : [v]) headers.push([n, x])
    const body = method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(this.chunks)
    containerFetch(this.url.href, { method, headers, body, signal: this.aborter.signal })
      .then(async (r) => {
        const res = new IncomingMessage()
        res.statusCode = r.status
        res.statusMessage = r.statusText
        r.headers.forEach((v, k) => {
          res.headers[k] = v
          res.rawHeaders.push(k, v)
        })
        this.emit('response', res)
        const reader = r.body?.getReader()
        if (reader)
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.push(Buffer.from(value))
          }
        res.push(null)
      })
      .catch((e) => this.emit('error', e))
      .finally(release)
    cb()
  }
  abort() {
    this.aborter.abort()
  }
  destroy(e?: Error) {
    this.aborter.abort()
    return super.destroy(e)
  }
  setNoDelay() {}
  setSocketKeepAlive() {}
}

function normalizeArgs(proto: string, a: unknown, b?: unknown, c?: unknown): [URL, { method?: string; headers?: Record<string, string> }, ((r: IncomingMessage) => void) | undefined] {
  let url: URL
  let opts: Record<string, unknown> = {}
  let cb: ((r: IncomingMessage) => void) | undefined
  if (typeof a === 'string' || a instanceof URL) {
    url = new URL(String(a))
    if (typeof b === 'function') cb = b as typeof cb
    else {
      opts = (b as Record<string, unknown>) ?? {}
      cb = c as typeof cb
    }
  } else {
    opts = (a as Record<string, unknown>) ?? {}
    cb = b as typeof cb
    const host = (opts.hostname ?? opts.host ?? 'localhost') as string
    url = new URL(`${proto}//${host}${opts.port ? ':' + opts.port : ''}${(opts.path as string) ?? '/'}`)
  }
  return [url, opts as { method?: string; headers?: Record<string, string> }, cb]
}

export function makeHttp(proto: 'http:' | 'https:') {
  const request = (a: unknown, b?: unknown, c?: unknown) => {
    const [u, o, cb] = normalizeArgs(proto, a, b, c)
    return new ClientRequest(u, o, cb)
  }
  const get = (a: unknown, b?: unknown, c?: unknown) => {
    const r = request(a, b, c)
    r.end()
    return r
  }
  class Agent {
    constructor(public options?: unknown) {}
    destroy() {}
  }
  return {
    createServer,
    Server,
    IncomingMessage,
    ServerResponse,
    OutgoingMessage,
    ClientRequest,
    Agent,
    globalAgent: new Agent(),
    request,
    get,
    STATUS_CODES,
    METHODS,
    maxHeaderSize: 16384,
    validateHeaderName: () => {},
    validateHeaderValue: () => {},
  }
}
