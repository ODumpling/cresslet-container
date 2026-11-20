// Pure helpers for cresslet-sw.js (kept out of sw.ts so they can be unit tested without a service worker global).

export const PREFIX = '/__cresslet__/'
/** Relay page path on a preview origin (see relay.ts). */
export const RELAY_PATH = '/cresslet-relay.html'
/** Always served by the network, never by a preview: keeps the host's `frame-ancestors` header on the relay. */
export const RESERVED = new Set([RELAY_PATH, '/cresslet-relay.js', '/cresslet-sw.js'])
/** Requests the SW leaves to the network: the relay assets, only on a preview origin (same-origin previews may serve files named like them). */
export const isReserved = (pathname: string, xorigin: boolean): boolean => xorigin && RESERVED.has(pathname)
/** How long a forwarded request may wait for the owning page's response head. */
export const HEAD_DEADLINE = 30_000

/**
 * On a preview origin only relay frames speak for a container: previews are same-origin windows too, but
 * `frame-ancestors` keeps them from framing the relay.
 */
export function isRelayClient(c: { url: string; frameType?: string }): boolean {
  try {
    return new URL(c.url).pathname === RELAY_PATH && c.frameType === 'nested'
  } catch {
    return false
  }
}

/** Headers every preview response gets on a preview origin (the host is cross-origin isolated and frames it). */
export const XORIGIN_HEADERS: Record<string, string> = { 'cross-origin-resource-policy': 'cross-origin', 'cross-origin-embedder-policy': 'require-corp' }

/** Response headers for a preview: COEP/CORP so isolated pages can load it, root-relative redirects kept in the preview. */
export function isolate(headers: [string, string][], o: { xorigin: boolean; prefix: string }): Headers {
  const h = new Headers(headers)
  if (!h.has('cross-origin-embedder-policy')) h.set('Cross-Origin-Embedder-Policy', 'require-corp')
  // cross-origin: the host frames previews from another origin, so a handler's `same-origin` (e.g. helmet) would blank them
  if (o.xorigin) h.set('Cross-Origin-Resource-Policy', 'cross-origin')
  else if (!h.has('cross-origin-resource-policy')) h.set('Cross-Origin-Resource-Policy', 'same-origin')
  const loc = h.get('location')
  if (loc && loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith(PREFIX)) h.set('location', o.prefix + loc)
  return h
}

/** Statuses a Response can't have a body for (101/103 are outside the forwarded 200-599 range). */
const NULL_BODY = new Set([204, 205, 304])

export interface ReceiveOptions {
  method: string
  /** Builds the preview response headers from the handler's. */
  headers: (raw: [string, string][]) => Headers
  /** Headers for responses the SW makes up itself (errors, deadline). */
  errorHeaders: Record<string, string>
  deadlineMs?: number
}

/**
 * Turn the owning page's reply (`head`, `chunk`*, `end` | `error` on `port`) into a Response. If no head arrives within
 * the deadline (e.g. the relay reloaded and lost the reply port) answer 504 instead of hanging; the request isn't replayed.
 * The port is closed once the response ends, fails, times out or is cancelled.
 */
export function receiveResponse(port: MessagePort, o: ReceiveOptions): Promise<Response> {
  return new Promise<Response>((resolve) => {
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
    let headed = false
    let done = false
    const finish = () => {
      done = true
      clearTimeout(timer)
      port.onmessage = null
      port.close()
    }
    const plain = (status: number, text: string, extra: Record<string, string> = {}) =>
      new Response(text, { status, headers: { 'content-type': 'text/plain', ...o.errorHeaders, ...extra } })
    const timer = setTimeout(() => {
      if (headed || done) return
      port.postMessage({ type: 'cancel' })
      finish()
      resolve(plain(504, `Cresslet preview did not answer within ${Math.round((o.deadlineMs ?? HEAD_DEADLINE) / 1000)}s (owning page busy or reloaded?); retry`, { 'retry-after': '1' }))
    }, o.deadlineMs ?? HEAD_DEADLINE)
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => void (ctrl = c),
      cancel: () => {
        if (done) return
        port.postMessage({ type: 'cancel' })
        finish()
      },
    })
    port.onmessage = (ev) => {
      const m = ev.data
      if (done || !m || typeof m !== 'object') return
      if (m.type === 'head' && !headed) {
        headed = true
        clearTimeout(timer)
        const status = m.status
        try {
          if (!Number.isInteger(status) || status < 200 || status > 599) throw new RangeError(`bad status ${status}`)
          const nullBody = NULL_BODY.has(status) || o.method === 'HEAD'
          const raw = Array.isArray(m.headers) ? m.headers : []
          resolve(new Response(nullBody ? null : stream, { status, statusText: typeof m.statusText === 'string' ? m.statusText : '', headers: o.headers(raw) }))
        } catch {
          // bad header pair, CR/LF in statusText, bad status...: never leave the request pending
          port.postMessage({ type: 'cancel' })
          finish()
          resolve(plain(502, 'Cresslet preview sent a malformed response head'))
        }
      } else if (m.type === 'chunk' && headed) {
        try {
          ctrl?.enqueue(new Uint8Array(m.data.buffer ?? m.data))
        } catch {
          /* cancelled */
        }
      } else if (m.type === 'end') {
        if (!headed) resolve(plain(502, 'Cresslet preview sent no response'))
        try {
          ctrl?.close()
        } catch {
          /* cancelled */
        }
        finish()
      } else if (m.type === 'error') {
        if (!headed) resolve(plain(500, String(m.message)))
        else ctrl?.error(new Error(String(m.message)))
        finish()
      }
    }
  })
}
