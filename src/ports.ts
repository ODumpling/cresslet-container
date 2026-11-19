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

export class PortTable {
  private ports = new Map<number, PortEntry>()
  constructor(
    public instanceId: string,
    private events: PortEvents,
  ) {}

  url(port: number): string {
    const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost'
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

  /** Answer a request bridged from the service worker. Streams the body back over `reply`. */
  async answer(m: SwRequest, reply: MessagePort): Promise<void> {
    const url = `http://localhost:${m.port}${m.path.startsWith('/') ? m.path : '/' + m.path}`
    const init: RequestInit = { method: m.method, headers: m.headers }
    if (m.body && m.method !== 'GET' && m.method !== 'HEAD') init.body = m.body
    let res: Response
    try {
      res = await this.dispatch(m.port, new Request(url, init))
    } catch (e) {
      res = new Response(String(e), { status: 500 })
    }
    reply.postMessage({ type: 'head', status: res.status, statusText: res.statusText, headers: [...res.headers] })
    if (!res.body) {
      reply.postMessage({ type: 'end' })
      return
    }
    const reader = res.body.getReader()
    let cancelled = false
    reply.onmessage = (ev) => {
      if (ev.data?.type === 'cancel') {
        cancelled = true
        reader.cancel().catch(() => {})
      }
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || cancelled) break
        const chunk = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value))
        const copy = chunk.slice() // never transfer buffers the handler may still own (e.g. VFS data)
        reply.postMessage({ type: 'chunk', data: copy }, [copy.buffer as ArrayBuffer])
      }
      reply.postMessage({ type: 'end' })
    } catch (e) {
      reply.postMessage({ type: 'error', message: String(e) })
    }
  }
}
