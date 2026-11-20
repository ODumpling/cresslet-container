// cresslet-sw.js — serves preview URLs /__cresslet__/<instanceId>/<port>/<path> by forwarding requests to the
// page that owns the container. Root-relative subresources from inside a preview (e.g. /src/main.tsx) are
// mapped back to their preview via the requesting client id (remembered per document, persisted in Cache
// Storage so SW restarts keep working), falling back to the Referer.
/// <reference lib="webworker" />
import { isolate, isRelayClient, isReserved, PREFIX, receiveResponse, XORIGIN_HEADERS } from './sw-lib'
declare const self: ServiceWorkerGlobalScope

/** Registered by cresslet-relay.html on a separate preview origin: previews are embedded cross-origin by the host. */
const XORIGIN = new URL(location.href).searchParams.get('xorigin') === '1'
const STORE = 'cresslet-sw-clients-v1'
interface Target {
  instanceId: string
  port: number
}

const clientMap = new Map<string, Target>()
const owners = new Map<string, string>() // instanceId -> window client id

const restoring: Promise<void> = (async () => {
  try {
    const cache = await caches.open(STORE)
    for (const req of await cache.keys()) {
      const id = decodeURIComponent(new URL(req.url).pathname.split('/').pop()!)
      const res = await cache.match(req)
      if (res) clientMap.set(id, await res.json())
    }
  } catch {
    /* Cache Storage unavailable */
  }
})()
let restored = false
restoring.then(() => (restored = true))

function remember(clientId: string, t: Target) {
  if (!clientId) return
  clientMap.set(clientId, t)
  caches
    .open(STORE)
    .then((c) => c.put(`/__cresslet_clients__/${encodeURIComponent(clientId)}`, new Response(JSON.stringify(t))))
    .catch(() => {})
}

function parse(pathname: string): (Target & { rest: string }) | null {
  if (!pathname.startsWith(PREFIX)) return null
  const m = /^\/__cresslet__\/([^/]+)\/(\d+)(\/.*)?$/.exec(pathname)
  if (!m) return null
  return { instanceId: m[1], port: Number(m[2]), rest: m[3] || '/' }
}

function parseReferrer(ref: string): Target | null {
  if (!ref) return null
  try {
    const u = new URL(ref)
    return u.origin === location.origin ? parse(u.pathname) : null
  } catch {
    return null
  }
}

const prefixOf = (t: Target) => `${PREFIX}${t.instanceId}/${t.port}`

self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      await self.clients.claim()
      // prune mappings for documents that no longer exist
      await restoring
      const alive = new Set((await self.clients.matchAll({ includeUncontrolled: true })).map((c) => c.id))
      const cache = await caches.open(STORE).catch(() => null)
      for (const id of [...clientMap.keys()]) {
        if (!alive.has(id)) {
          clientMap.delete(id)
          cache?.delete(`/__cresslet_clients__/${encodeURIComponent(id)}`)
        }
      }
    })(),
  )
})

/** Windows that may own a container: on a preview origin only relay frames (previews share the origin). */
const ownerCandidate = (c: Client) => !XORIGIN || isRelayClient(c)

self.addEventListener('message', (e) => {
  const d = e.data
  const src = e.source && 'id' in e.source ? (e.source as Client) : null
  if (d?.type === 'cresslet-ping') e.ports[0]?.postMessage({ type: 'cresslet-pong' })
  if (!src || typeof d?.instanceId !== 'string' || !ownerCandidate(src)) return
  if (d.type === 'cresslet-register') owners.set(d.instanceId, src.id)
  else if (d.type === 'cresslet-unregister' && (!XORIGIN || owners.get(d.instanceId) === src.id)) owners.delete(d.instanceId)
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (url.origin !== location.origin || isReserved(url.pathname, XORIGIN)) return
  const direct = parse(url.pathname)
  if (direct) {
    if (req.mode === 'navigate' && e.resultingClientId) remember(e.resultingClientId, direct)
    e.respondWith(
      forward(req, direct, direct.rest + url.search).then((res) =>
        req.mode === 'navigate' && (res.headers.get('content-type') ?? '').includes('text/html') ? injectStrip(res) : res,
      ),
    )
    return
  }
  const viaClient = e.clientId ? clientMap.get(e.clientId) : undefined
  if (viaClient) {
    e.respondWith(handleRelative(e, viaClient, url))
    return
  }
  const viaRef = parseReferrer(req.referrer)
  if (viaRef && (req.mode !== 'navigate' || req.destination === 'iframe' || req.destination === 'document')) {
    e.respondWith(handleRelative(e, viaRef, url))
    return
  }
  const nav = req.mode === 'navigate' && (req.destination === 'iframe' || req.destination === 'frame' || req.destination === 'document')
  if (!restored || nav) {
    e.respondWith(
      (async () => {
        await restoring
        const t = (e.clientId ? clientMap.get(e.clientId) : undefined) ?? (nav ? await navTarget(req) : undefined)
        return t ? handleRelative(e, t, url) : fetch(req)
      })(),
    )
  }
})

/**
 * Previews strip their /__cresslet__/<id>/<port> prefix from location (see STRIP_SCRIPT), so a full navigation
 * inside a preview (link click, reload) arrives as a plain same-origin URL. Attribute it to the preview whose
 * document is being navigated: for frames, the mapped client whose URL is the referrer (link) or the URL itself
 * (reload); for top-level tabs, only reloads, and only when no unmapped (host) window shows the same URL.
 */
async function navTarget(req: Request): Promise<Target | undefined> {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const mapped = all.filter((c) => clientMap.has(c.id))
  if (!mapped.length) return undefined
  // some browsers report a client's URL from before history.replaceState; compare without the prefix
  const noHash = (x: string) => x.split('#')[0]
  const same = (clientUrl: string, u: string) => !!u && (noHash(clientUrl) === noHash(u) || noHash(stripPrefix(clientUrl)) === noHash(u))
  if (req.destination === 'document') {
    if (all.some((c) => !clientMap.has(c.id) && noHash(c.url) === noHash(req.url))) return undefined
    const c = mapped.find((c) => c.frameType === 'top-level' && same(c.url, req.url))
    return c && clientMap.get(c.id)
  }
  const c = mapped.find((c) => c.frameType !== 'top-level' && (same(c.url, req.referrer) || same(c.url, req.url)))
  return c && clientMap.get(c.id)
}

function stripPrefix(u: string): string {
  try {
    const url = new URL(u)
    const t = parse(url.pathname)
    return t ? url.origin + t.rest + url.search + url.hash : u
  } catch {
    return u
  }
}

/** Injected first into preview HTML: hide the preview prefix from the app (routers see "/"). */
const STRIP_SCRIPT = `<script>(function(){var l=location,m=/^\\/__cresslet__\\/[^/]+\\/\\d+/.exec(l.pathname);if(m)history.replaceState(history.state,'',(l.pathname.slice(m[0].length)||'/')+l.search+l.hash)})()</script>`

async function injectStrip(res: Response): Promise<Response> {
  const html = await res.text()
  const at = html.search(/<head[^>]*>/i)
  const body = at >= 0 ? html.replace(/<head[^>]*>/i, (h) => h + STRIP_SCRIPT) : STRIP_SCRIPT + html
  const headers = new Headers(res.headers)
  headers.delete('content-length')
  return new Response(body, { status: res.status, statusText: res.statusText, headers })
}

async function handleRelative(e: FetchEvent, t: Target, url: URL): Promise<Response> {
  if (e.request.mode !== 'navigate') return forward(e.request, t, url.pathname + url.search)
  // Serve the navigation in place (no redirect: WebKit blocks SW redirects under COEP); the new document
  // keeps its clean URL and is attributed to the preview by its client id.
  remember(e.resultingClientId, t)
  const res = await forward(e.request, t, url.pathname + url.search)
  return (res.headers.get('content-type') ?? '').includes('text/html') ? injectStrip(res) : res
}

async function findOwner(instanceId: string): Promise<Client | null> {
  const known = owners.get(instanceId)
  if (known) {
    const c = await self.clients.get(known)
    if (c) return c
    owners.delete(instanceId)
  }
  // also how ownership is recovered after an SW restart
  const all = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(ownerCandidate)
  const answers = await Promise.all(
    all.map(
      (c) =>
        new Promise<Client | null>((resolve) => {
          const ch = new MessageChannel()
          const settle = (owner: Client | null) => {
            clearTimeout(timer)
            ch.port1.onmessage = null
            ch.port1.close()
            resolve(owner)
          }
          const timer = setTimeout(() => settle(null), 1500)
          ch.port1.onmessage = (ev) => settle(ev.data?.owns === true ? c : null)
          c.postMessage({ type: 'cresslet-who', instanceId }, [ch.port2])
        }),
    ),
  )
  const owner = answers.find(Boolean) ?? null
  if (owner) owners.set(instanceId, owner.id)
  return owner
}

async function forward(req: Request, t: Target, path: string): Promise<Response> {
  const client = await findOwner(t.instanceId)
  if (!client)
    return new Response(`Cresslet preview ${t.instanceId}:${t.port} is not running (owning page closed?)`, {
      status: 503,
      headers: { 'content-type': 'text/plain', ...(XORIGIN && XORIGIN_HEADERS) },
    })
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const ch = new MessageChannel()
  const headers: [string, string][] = []
  req.headers.forEach((v, k) => headers.push([k, v]))
  client.postMessage({ type: 'cresslet-request', instanceId: t.instanceId, port: t.port, path, method: req.method, headers, body }, body ? [ch.port2, body] : [ch.port2])
  return receiveResponse(ch.port1, { method: req.method, headers: (raw) => isolate(raw, { xorigin: XORIGIN, prefix: prefixOf(t) }), errorHeaders: XORIGIN ? XORIGIN_HEADERS : {} })
}
