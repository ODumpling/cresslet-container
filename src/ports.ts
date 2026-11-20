// Virtual port table + page side of the service-worker bridge.

export type PortHandler = (req: Request) => Promise<Response> | Response

export const PREVIEW_PREFIX = '/__cresslet__/'

interface PortEntry {
  handler: PortHandler
  owner: string
}

export interface PortEvents {
  open(port: number, url: string): void
  close(port: number, url: string): void
}

/** Message the SW posts to pages (with a MessagePort for the reply). */
export interface SwRequest {
  type: 'cresslet-request'
  instanceId: string
  port: number
  /** Path after the port prefix, incl. query. */
  path: string
  method: string
  headers: [string, string][]
  body: ArrayBuffer | null
  /** A preview's WebSocket (see preview-ws.js): comes with the socket's server end; answered with `open` or `refused`. */
  websocket?: boolean
}

const METHOD = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** An HTTP token, as WebSocket subprotocols must be. */
const TOKEN = METHOD

/** Headers of a WebSocket upgrade request (what a server would see; `Request` itself can't carry them). */
export function websocketHeaders(protocols: string[], origin: string): [string, string][] {
  const h: [string, string][] = [
    ['upgrade', 'websocket'],
    ['connection', 'Upgrade'],
    ['sec-websocket-version', '13'],
    ['origin', origin],
  ]
  if (protocols.length) h.push(['sec-websocket-protocol', protocols.join(', ')])
  return h
}

/** The subprotocols a forwarded upgrade offers, or null when they aren't distinct tokens. */
export function offeredProtocols(headers: [string, string][]): string[] | null {
  const raw = headers.filter(([k]) => k.toLowerCase() === 'sec-websocket-protocol').map(([, v]) => v).join(',')
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return list.every((p) => TOKEN.test(p)) && new Set(list).size === list.length ? list : null
}

/** A well-formed `cresslet-request` (checked before anything is dispatched to a port handler). */
export function isSwRequest(d: unknown): d is SwRequest {
  const m = d as Partial<Record<keyof SwRequest, unknown>> | null
  return (
    !!m &&
    typeof m === 'object' &&
    m.type === 'cresslet-request' &&
    typeof m.instanceId === 'string' &&
    typeof m.port === 'number' &&
    Number.isInteger(m.port) &&
    m.port > 0 &&
    m.port <= 65535 &&
    typeof m.path === 'string' &&
    m.path.startsWith('/') &&
    typeof m.method === 'string' &&
    METHOD.test(m.method) &&
    Array.isArray(m.headers) &&
    m.headers.every((h) => Array.isArray(h) && h.length === 2 && typeof h[0] === 'string' && typeof h[1] === 'string') &&
    (m.body === null || m.body === undefined || m.body instanceof ArrayBuffer) &&
    (m.websocket === undefined || m.websocket === true || m.websocket === false)
  )
}

/** Reply to a request that failed validation: 400, then close the reply port (the SW would otherwise wait for its deadline). */
export function rejectRequest(reply: MessagePort): void {
  const body = new TextEncoder().encode('Cresslet: malformed preview request')
  reply.postMessage({ type: 'head', status: 400, statusText: 'Bad Request', headers: [['content-type', 'text/plain']] })
  reply.postMessage({ type: 'chunk', data: body }, [body.buffer])
  reply.postMessage({ type: 'end' })
  reply.close()
}

/** What `Container.upgradeWebSocket` returns. */
export interface WebSocketUpgrade {
  /**
   * The server end of the preview's socket. Both ways: `{ type: 'message', data: string | ArrayBuffer }` and
   * `{ type: 'close', code?, reason? }` (whoever sends `close` is done with the port; whoever gets it closes the port). May be transferred (e.g. to a
   * project worker). If the handler refuses after all (or the preview gave up), the preview sends it `close`.
   */
  socket: MessagePort
  /** Return this from the port handler to accept the upgrade. Any other response refuses it. */
  response: Response
}

interface PendingUpgrade {
  protocols: string[]
  socket: MessagePort
  accepted?: { response: Response; protocol: string }
  /** The preview gave up (closed, timed out, navigated away) while the handler ran. */
  cancelled?: boolean
}

/** WebSocket upgrades from previews being dispatched, by the Request their port handler gets. */
const upgrades = new WeakMap<Request, PendingUpgrade>()

/** See `Container.upgradeWebSocket`. */
export function upgradeWebSocket(req: Request, opts: { protocol?: string } = {}): WebSocketUpgrade {
  const p = upgrades.get(req)
  if (!p) throw new TypeError('upgradeWebSocket: not a WebSocket upgrade request from a preview (or no longer pending)')
  if (p.accepted) throw new TypeError('upgradeWebSocket: this request was already upgraded')
  if (p.cancelled) throw new TypeError('upgradeWebSocket: the preview gave up on this WebSocket (closed it, or navigated away)')
  const protocol = opts.protocol ?? ''
  if (protocol && !p.protocols.includes(protocol)) throw new TypeError(`upgradeWebSocket: the preview did not offer subprotocol ${JSON.stringify(protocol)}`)
  // as browsers do: a socket that offers subprotocols fails unless the server picks one
  if (!protocol && p.protocols.length) throw new TypeError(`upgradeWebSocket: the preview offered subprotocols ${p.protocols.join(', ')}: pass one as { protocol }`)
  const response = new Response(null, { status: 200, statusText: 'Switching Protocols', headers: protocol ? { 'sec-websocket-protocol': protocol } : {} })
  p.accepted = { response, protocol }
  return { socket: p.socket, response }
}

/** The URL a port handler sees for a forwarded request. */
const requestUrl = (m: SwRequest) => `http://localhost:${m.port}${m.path.startsWith('/') ? m.path : '/' + m.path}`

export class PortTable {
  private ports = new Map<number, PortEntry>()
  constructor(
    public instanceId: string,
    private events: PortEvents,
    /** Origin previews are served from, or one per port (`boot({ previewOrigins })`). Default: the page's own origin. */
    private previewOrigin?: string | ((port: number) => string),
  ) {}

  /** Origin previews (`port`'s, with per-preview origins: then `port` is required) are served from. */
  origin(port?: number): string {
    const o = this.previewOrigin
    if (typeof o === 'function') {
      if (port === undefined) throw new TypeError('ports.origin(port): previews have one origin per port (previewOrigins)')
      return o(port)
    }
    return o ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost')
  }

  url(port: number): string {
    return `${this.origin(port)}${PREVIEW_PREFIX}${this.instanceId}/${port}/`
  }

  open(port: number, handler: PortHandler, owner = 'user'): string {
    const existed = this.ports.has(port)
    this.ports.set(port, { handler, owner })
    const u = this.url(port)
    if (!existed) this.events.open(port, u)
    return u
  }

  close(port: number): void {
    if (this.ports.delete(port)) this.events.close(port, this.url(port))
  }

  has(port: number): boolean {
    return this.ports.has(port)
  }

  list(): number[] {
    return [...this.ports.keys()]
  }

  /** Lowest free port >= start. */
  free(start: number): number {
    let p = start
    while (this.ports.has(p)) p++
    return p
  }

  async dispatch(port: number, req: Request): Promise<Response> {
    const e = this.ports.get(port)
    if (!e) return new Response(`No server listening on port ${port}`, { status: 502, headers: { 'content-type': 'text/plain' } })
    try {
      return await e.handler(req)
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err)
      return new Response(`Internal error on port ${port}:\n${msg}`, { status: 500, headers: { 'content-type': 'text/plain' } })
    }
  }

  /** Answer a request bridged from the service worker. Streams the body back over `reply`, then closes it. */
  /** `socket`: a WebSocket request's server end (see `SwRequest.websocket`). */
  async answer(m: SwRequest, reply: MessagePort, socket?: MessagePort): Promise<void> {
    if (m.websocket) return socket ? this.answerSocket(m, reply, socket) : rejectRequest(reply)
    const url = requestUrl(m)
    let cancelled = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    reply.onmessage = (ev) => {
      if (ev.data?.type !== 'cancel') return
      cancelled = true
      reader?.cancel().catch(() => {})
    }
    const done = () => {
      reply.onmessage = null
      reply.close()
    }
    let res: Response
    try {
      const init: RequestInit = { method: m.method, headers: m.headers }
      if (m.body && m.method !== 'GET' && m.method !== 'HEAD') init.body = m.body
      res = await this.dispatch(m.port, new Request(url, init))
    } catch (e) {
      res = new Response(String(e), { status: 500 })
    }
    if (cancelled) {
      res.body?.cancel().catch(() => {})
      return done()
    }
    reply.postMessage({ type: 'head', status: res.status, statusText: res.statusText, headers: [...res.headers] })
    if (!res.body) {
      reply.postMessage({ type: 'end' })
      return done()
    }
    reader = res.body.getReader()
    try {
      for (;;) {
        const { done: eof, value } = await reader.read()
        if (eof || cancelled) break
        const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value))
        const copy = chunk.slice() // never transfer buffers the handler may still own (e.g. VFS data)
        reply.postMessage({ type: 'chunk', data: copy }, [copy.buffer as ArrayBuffer])
      }
      if (!cancelled) reply.postMessage({ type: 'end' })
    } catch (e) {
      if (!cancelled) reply.postMessage({ type: 'error', message: String(e) })
    }
    done()
  }

  /**
   * A preview's WebSocket: dispatch it as a GET with the upgrade headers (shadowing `req.headers`, since `Request` drops
   * `Upgrade`/`Sec-*`), then hand the preview its end of the socket (`open`) if the handler accepted, else `refused`.
   * The headers are made here, not taken from the message (the relay is scriptable by previews): only the offered
   * subprotocols come from the preview.
   */
  private async answerSocket(m: SwRequest, reply: MessagePort, socket: MessagePort): Promise<void> {
    const offered = offeredProtocols(m.headers)
    if (!offered) {
      reply.postMessage({ type: 'refused', status: 400 })
      socket.close()
      return reply.close()
    }
    const req = new Request(requestUrl(m))
    Object.defineProperty(req, 'headers', { value: new Headers(websocketHeaders(offered, this.origin(m.port))), enumerable: true })
    const pending: PendingUpgrade = { protocols: offered, socket }
    upgrades.set(req, pending)
    // also told over the socket, but Firefox drops that one when the page unloads before its receiver has started
    reply.onmessage = (e) => void (e.data?.type === 'cancel' && (pending.cancelled = true))
    let res = await this.dispatch(m.port, req)
    upgrades.delete(req)
    reply.onmessage = null
    if (!(res instanceof Response)) res = new Response(null, { status: 500 }) // a handler that returned nothing
    const a = pending.accepted
    if (a && res === a.response && !pending.cancelled) reply.postMessage({ type: 'open', protocol: a.protocol })
    else {
      // once the handler has it (kept or transferred), the preview tells that end with `close`
      if (!a) socket.close()
      res.body?.cancel().catch(() => {})
      reply.postMessage({ type: 'refused', status: res.status })
    }
    reply.close()
  }
}
