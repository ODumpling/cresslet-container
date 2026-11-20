// Host <-> preview-origin relay protocol (cresslet-relay.html). Pure helpers shared by the container and the relay
// script so the validation rules can be unit tested.
//
// Handshake: the relay (hidden iframe on the preview origin) posts HELLO to its parent, targeted at its `host` param.
// The container answers with INIT + a MessagePort, targeted at the preview origin. From then on everything goes over
// that port:
//   relay -> host: SW messages for the owning page (cresslet-who / cresslet-request, reply ports transferred; a
//                  preview WebSocket is a cresslet-request with `websocket: true` and the socket's server end as a
//                  second port),
//                  RELAY_READY / RELAY_ERROR
//   host -> relay: cresslet-register / cresslet-unregister (forwarded to the SW), BROADCAST / BROADCAST_CLOSE
//                  (re-posted on the preview origin's BroadcastChannel of that name), WORKER_SCRIPT (node-worker.js
//                  source, once per connection), PROC_SPAWN + a MessagePort (start a `node` worker on the preview
//                  origin; the relay proxies it over that port, see node/channel.ts), WORKER_SPAWN + a MessagePort
//                  (start a project worker from the given source, `Container.projectWorker`; messages go over the
//                  port wrapped as { t: 'msg', data }, plus { t: 'terminate' } / { t: 'error', message })

export const RELAY_HELLO = 'cresslet-relay-hello'
export const RELAY_INIT = 'cresslet-relay-init'
export const RELAY_READY = 'cresslet-relay-ready'
export const RELAY_ERROR = 'cresslet-relay-error'
export const BROADCAST = 'cresslet-broadcast'
export const BROADCAST_CLOSE = 'cresslet-broadcast-close'
export const WORKER_SCRIPT = 'cresslet-worker-script'
export const PROC_SPAWN = 'cresslet-proc-spawn'
export const WORKER_SPAWN = 'cresslet-worker-spawn'
/** host -> relay: the container is going away; unregister this origin's service worker (per-preview origins only). */
export const RELAY_DISPOSE = 'cresslet-relay-dispose'
/** relay -> host: done with RELAY_DISPOSE (the frame can go). */
export const RELAY_DISPOSED = 'cresslet-relay-disposed'

/** SW -> owning page messages the relay forwards. */
export const SW_TO_PAGE = new Set(['cresslet-who', 'cresslet-request'])
/** Host -> SW messages the relay forwards. */
export const PAGE_TO_SW = new Set(['cresslet-register', 'cresslet-unregister'])

const INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/
const CHANNEL = /^cresslet:[A-Za-z0-9_-]{1,64}:\d{1,5}$/

/** Origin of a URL-ish string, or null when it isn't an http(s) origin. */
export function toOrigin(s: string | null | undefined): string | null {
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** `sw: false`: a relay that only runs workers (no service worker on its origin; see `previewOrigins`). */
export function relayUrl(previewOrigin: string, hostOrigin: string, opts: { sw?: boolean } = {}): string {
  return `${previewOrigin}/cresslet-relay.html?host=${encodeURIComponent(hostOrigin)}${opts.sw === false ? '&sw=0' : ''}`
}

/** `boot({ previewOrigins })`: the origin for one preview port (`port` 0: where the container's workers run). */
export function expandOriginTemplate(template: string, instanceId: string, port: number): string {
  return template.replaceAll('{id}', instanceId).replaceAll('{port}', String(port))
}

/**
 * Check a `previewOrigins` template: `{id}` and `{port}` once each in an ASCII host name (letters, digits, `-`, `.`),
 * apart (a `-` or `.` between them, e.g. `{id}-{port}`, so no two containers or ports share an origin: ids are letters
 * and digits), not in the last label (which mustn't be numeric: IPv4), and an http(s) origin with no path once they're
 * filled in. Returns the error, or null.
 */
export function originTemplateError(template: unknown): string | null {
  if (typeof template !== 'string') return 'must be a string'
  const m = /^https?:\/\/([^/?#@:\\]+)(:\d{1,5})?\/?$/i.exec(template)
  if (!m) return 'must be an http(s) origin (scheme, host name, optional port; no path)'
  const host = m[1]
  const once = (s: string) => host.split(s).length === 2
  if (!once('{id}') || !once('{port}')) return 'must contain {id} and {port} once each, in the host name'
  // plain ASCII only: URL parsing would turn e.g. `%31` or `①` into a digit, and so a separator into nothing
  if (!/^[a-z0-9.-]*$/i.test(host.replace('{id}', '').replace('{port}', ''))) return 'may only use ASCII letters, digits, "-" and "." in its host name (besides {id} and {port})'
  const i = host.indexOf('{id}')
  const j = host.indexOf('{port}')
  // a last label with a placeholder could come out all digits (ids can be), and then parse as an IPv4 address
  const last = host.replace(/\.$/, '').split('.').pop()!
  if (last.includes('{') || /^(\d+|0x[0-9a-f]*)$/i.test(last)) return 'must end its host name in a fixed, non-numeric label (e.g. .com)'
  if (!/[^a-z0-9]/i.test(i < j ? host.slice(i + 4, j) : host.slice(j + 6, i))) return 'must separate {id} and {port} with something other than a letter or digit (e.g. {id}-{port})'
  for (const [id, port] of [['a0', 1], ['zz9zz9zz', 65535], ['zz9zz9zz', 0]] as const) {
    const s = expandOriginTemplate(template, id, port)
    if (toOrigin(s) === null) return `must be an http(s) origin once {id} and {port} are filled in (${s} isn't)`
  }
  return null
}

/**
 * Relay side: accept an INIT only from the host named in the relay's own URL, sent by its parent window, and (where
 * the browser exposes it) only when the parent really is that origin.
 */
export function acceptInit(
  ev: { origin: string; source: unknown; data: unknown; ports: readonly unknown[] },
  ctx: { host: string | null; parent: unknown; ancestorOrigins?: ArrayLike<string> | null },
): boolean {
  if (!ctx.host || ev.origin !== ctx.host) return false
  if (ev.source !== ctx.parent) return false
  const ao = ctx.ancestorOrigins
  if (ao && ao.length && ao[0] !== ctx.host) return false
  const d = ev.data as { type?: unknown } | null
  return !!d && typeof d === 'object' && d.type === RELAY_INIT && ev.ports.length === 1
}

/** Host side: accept a relay HELLO only from the relay iframe's window on the preview origin. */
export function acceptHello(ev: { origin: string; source: unknown; data: unknown }, ctx: { previewOrigin: string; relay: unknown }): boolean {
  if (ev.origin !== ctx.previewOrigin || !ctx.relay || ev.source !== ctx.relay) return false
  const d = ev.data as { type?: unknown } | null
  return !!d && typeof d === 'object' && d.type === RELAY_HELLO
}

/** Relay side: a host -> SW message worth forwarding. */
export function isPageToSw(d: unknown): d is { type: string; instanceId: string } {
  const m = d as { type?: unknown; instanceId?: unknown } | null
  return !!m && typeof m === 'object' && typeof m.type === 'string' && PAGE_TO_SW.has(m.type) && typeof m.instanceId === 'string' && INSTANCE_ID.test(m.instanceId)
}

/** Relay side: a SW -> page message worth forwarding (one reply port; a WebSocket request also carries its socket). */
export function isSwToPage(d: unknown, ports: readonly unknown[]): boolean {
  const m = d as { type?: unknown; websocket?: unknown } | null
  if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !SW_TO_PAGE.has(m.type)) return false
  return ports.length === (m.type === 'cresslet-request' && m.websocket === true ? 2 : 1)
}

/** Relay side: the node worker script to run processes with. */
export function isWorkerScript(d: unknown): d is { type: string; source: string } {
  const m = d as { type?: unknown; source?: unknown } | null
  return !!m && typeof m === 'object' && m.type === WORKER_SCRIPT && typeof m.source === 'string'
}

/** Relay side: start a process, talking to the host over the one transferred port. */
export function isProcSpawn(d: unknown, ports: readonly unknown[]): boolean {
  const m = d as { type?: unknown } | null
  return !!m && typeof m === 'object' && m.type === PROC_SPAWN && ports.length === 1
}

/** Relay side: start a project worker from `source`, talking to the host over the one transferred port. */
export function isWorkerSpawn(d: unknown, ports: readonly unknown[]): d is { type: string; source: string; name?: string } {
  const m = d as { type?: unknown; source?: unknown; name?: unknown } | null
  return !!m && typeof m === 'object' && m.type === WORKER_SPAWN && typeof m.source === 'string' && (m.name === undefined || typeof m.name === 'string') && ports.length === 1
}

export function isChannelName(s: unknown): s is string {
  return typeof s === 'string' && CHANNEL.test(s)
}

/** Shown with relay setup errors: cross-site preview origins need third-party service workers/storage. */
export const THIRD_PARTY_HINT = 'if the preview origin is cross-site, this browser may block third-party service workers/storage'

/** Host side: the text of a RELAY_ERROR (relay frames are scriptable by previews): prefixed, no control chars, capped. */
export function relayErrorText(message: unknown): string {
  // eslint-disable-next-line no-control-regex
  return `preview relay: ${String(message).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 500)}`
}

interface WorkerLike {
  state: string
  addEventListener(type: 'statechange', fn: () => void): void
  removeEventListener(type: 'statechange', fn: () => void): void
}

/**
 * The worker to talk to after `register()`: a newer one installing/waiting (skipWaiting + claim make it take over) wins
 * over an older active one (which is the fallback if the newer one turns redundant); otherwise the active one, or
 * whatever `ready` brings.
 */
export function newestWorker<W extends WorkerLike>(
  reg: { installing: W | null; waiting: W | null; active: W | null },
  ready: () => Promise<{ active: W | null }>,
): Promise<W> {
  const w = reg.installing ?? reg.waiting
  if (!w) return reg.active ? Promise.resolve(reg.active) : ready().then((r) => r.active!)
  return new Promise((resolve, reject) => {
    const check = () => {
      if (w.state === 'activated') resolve(w)
      else if (w.state === 'redundant') {
        const a = reg.active
        if (a && a !== w && a.state !== 'redundant') resolve(a)
        else reject(new Error('service worker became redundant'))
      }
      else return
      w.removeEventListener('statechange', check)
    }
    w.addEventListener('statechange', check)
    check()
  })
}
