// Host <-> preview-origin relay protocol (cresslet-relay.html). Pure helpers shared by the container and the relay
// script so the validation rules can be unit tested.
//
// Handshake: the relay (hidden iframe on the preview origin) posts HELLO to its parent, targeted at its `host` param.
// The container answers with INIT + a MessagePort, targeted at the preview origin. From then on everything goes over
// that port:
//   relay -> host: SW messages for the owning page (cresslet-who / cresslet-request, reply ports transferred),
//                  RELAY_READY / RELAY_ERROR
//   host -> relay: cresslet-register / cresslet-unregister (forwarded to the SW), BROADCAST / BROADCAST_CLOSE
//                  (re-posted on the preview origin's BroadcastChannel of that name)

export const RELAY_HELLO = 'cresslet-relay-hello'
export const RELAY_INIT = 'cresslet-relay-init'
export const RELAY_READY = 'cresslet-relay-ready'
export const RELAY_ERROR = 'cresslet-relay-error'
export const BROADCAST = 'cresslet-broadcast'
export const BROADCAST_CLOSE = 'cresslet-broadcast-close'

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

export function relayUrl(previewOrigin: string, hostOrigin: string): string {
  return `${previewOrigin}/cresslet-relay.html?host=${encodeURIComponent(hostOrigin)}`
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

/** Relay side: a SW -> page message worth forwarding (always carries exactly one reply port). */
export function isSwToPage(d: unknown, ports: readonly unknown[]): boolean {
  const m = d as { type?: unknown } | null
  return !!m && typeof m === 'object' && typeof m.type === 'string' && SW_TO_PAGE.has(m.type) && ports.length === 1
}

export function isChannelName(s: unknown): s is string {
  return typeof s === 'string' && CHANNEL.test(s)
}
