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
}

const METHOD = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

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
    (m.body === null || m.body === undefined || m.body instanceof ArrayBuffer)
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

export class PortTable {
  private ports = new Map<number, PortEntry>()
  constructor(
    public instanceId: string,
    private events: PortEvents,
    /** Origin previews are served from. Default: the page's own origin. */
    private previewOrigin?: string,
  ) {}

  url(port: number): string {
    const origin = this.previewOrigin ?? (typeof location !== 'undefined' ? location.origin : 'http://localhost')
    return `${origin}${PREVIEW_PREFIX}${this.instanceId}/${port}/`
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
  async answer(m: SwRequest, reply: MessagePort): Promise<void> {
    const url = `http://localhost:${m.port}${m.path.startsWith('/') ? m.path : '/' + m.path}`
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
}
