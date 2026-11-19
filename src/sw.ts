// clover-sw.js — serves preview URLs /__clover__/<instanceId>/<port>/<path> by forwarding requests to the
// page that owns the container. Root-relative subresources from inside a preview (e.g. /src/main.tsx) are
// mapped back to their preview via the requesting client id (remembered per document, persisted in Cache
// Storage so SW restarts keep working), falling back to the Referer.
/// <reference lib="webworker" />
export {}
declare const self: ServiceWorkerGlobalScope

const PREFIX = '/__clover__/'
const STORE = 'clover-sw-clients-v1'
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
    .then((c) => c.put(`/__clover_clients__/${encodeURIComponent(clientId)}`, new Response(JSON.stringify(t))))
    .catch(() => {})
}

function parse(pathname: string): (Target & { rest: string }) | null {
  if (!pathname.startsWith(PREFIX)) return null
  const m = /^\/__clover__\/([^/]+)\/(\d+)(\/.*)?$/.exec(pathname)
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
          cache?.delete(`/__clover_clients__/${encodeURIComponent(id)}`)
        }
      }
    })(),
  )
})

self.addEventListener('message', (e) => {
  const d = e.data
  if (d?.type === 'clover-register' && e.source && 'id' in e.source) owners.set(d.instanceId, (e.source as Client).id)
  else if (d?.type === 'clover-unregister') owners.delete(d.instanceId)
  else if (d?.type === 'clover-ping') e.ports[0]?.postMessage({ type: 'clover-pong' })
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  const direct = parse(url.pathname)
  if (direct) {
    if (req.mode === 'navigate' && e.resultingClientId) remember(e.resultingClientId, direct)
    e.respondWith(forward(req, direct, direct.rest + url.search))
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
  if (!restored || (req.mode === 'navigate' && req.destination === 'iframe')) {
    e.respondWith(
      (async () => {
        await restoring
        let t = e.clientId ? clientMap.get(e.clientId) : undefined
        if (!t && req.mode === 'navigate' && req.referrer) {
          // an iframe navigating itself after history.pushState: its referrer is its own current URL
          for (const c of await self.clients.matchAll({ type: 'window' })) {
            if (c.url === req.referrer && clientMap.has(c.id)) t = clientMap.get(c.id)
          }
        }
        return t ? handleRelative(e, t, url) : fetch(req)
      })(),
    )
  }
})

async function handleRelative(e: FetchEvent, t: Target, url: URL): Promise<Response> {
  if (e.request.mode === 'navigate') return Response.redirect(prefixOf(t) + url.pathname + url.search + url.hash, 302)
  return forward(e.request, t, url.pathname + url.search)
}

async function findOwner(instanceId: string): Promise<Client | null> {
  const known = owners.get(instanceId)
  if (known) {
    const c = await self.clients.get(known)
    if (c) return c
    owners.delete(instanceId)
  }
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const answers = await Promise.all(
    all.map(
      (c) =>
        new Promise<Client | null>((resolve) => {
          const ch = new MessageChannel()
          const timer = setTimeout(() => resolve(null), 1500)
          ch.port1.onmessage = (ev) => {
            clearTimeout(timer)
            resolve(ev.data?.owns ? c : null)
          }
          c.postMessage({ type: 'clover-who', instanceId }, [ch.port2])
        }),
    ),
  )
  const owner = answers.find(Boolean) ?? null
  if (owner) owners.set(instanceId, owner.id)
  return owner
}

function isolate(headers: [string, string][], t: Target): Headers {
  const h = new Headers(headers)
  if (!h.has('cross-origin-embedder-policy')) h.set('Cross-Origin-Embedder-Policy', 'require-corp')
  if (!h.has('cross-origin-resource-policy')) h.set('Cross-Origin-Resource-Policy', 'same-origin')
  const loc = h.get('location')
  if (loc && loc.startsWith('/') && !loc.startsWith('//') && !loc.startsWith(PREFIX)) h.set('location', prefixOf(t) + loc)
  return h
}

async function forward(req: Request, t: Target, path: string): Promise<Response> {
  const client = await findOwner(t.instanceId)
  if (!client) return new Response(`Clover preview ${t.instanceId}:${t.port} is not running (owning page closed?)`, { status: 503, headers: { 'content-type': 'text/plain' } })
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
  const ch = new MessageChannel()
  const headers: [string, string][] = []
  req.headers.forEach((v, k) => headers.push([k, v]))
  client.postMessage({ type: 'clover-request', instanceId: t.instanceId, port: t.port, path, method: req.method, headers, body }, body ? [ch.port2, body] : [ch.port2])
  return new Promise<Response>((resolve) => {
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
    let headed = false
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => void (ctrl = c),
      cancel: () => ch.port1.postMessage({ type: 'cancel' }),
    })
    ch.port1.onmessage = (ev) => {
      const m = ev.data
      if (m.type === 'head') {
        headed = true
        const status = m.status >= 200 && m.status <= 599 ? m.status : 200
        const nullBody = status === 204 || status === 304 || req.method === 'HEAD'
        resolve(new Response(nullBody ? null : stream, { status, statusText: m.statusText, headers: isolate(m.headers, t) }))
      } else if (m.type === 'chunk') ctrl?.enqueue(new Uint8Array(m.data.buffer ?? m.data))
      else if (m.type === 'end') {
        try {
          ctrl?.close()
        } catch {
          /* cancelled */
        }
        ch.port1.close()
      } else if (m.type === 'error') {
        if (!headed) resolve(new Response(m.message, { status: 500 }))
        else ctrl?.error(new Error(m.message))
        ch.port1.close()
      }
    }
  })
}
