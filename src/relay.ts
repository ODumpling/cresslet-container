// cresslet-relay.js — runs in cresslet-relay.html, a hidden iframe the container creates on the preview origin when
// booted with `previewOrigin`. Registers cresslet-sw.js on the preview origin and bridges it to the host page over one
// MessagePort (see relay-protocol.ts). Previews are same-origin with this frame, so nothing here is trusted by the host:
// it only relays what the SW could ask of the owning page anyway. With the host's node-worker.js source it also runs
// the container's `node` processes here, on the preview origin, so project server code can't reach host storage.
import { DEFAULT_SAB, HEADER, SyncReplier, type HostToRelayProc, type RelayProcToHost } from './node/protocol'
import {
  acceptInit,
  BROADCAST,
  BROADCAST_CLOSE,
  isChannelName,
  isPageToSw,
  isProcSpawn,
  isSwToPage,
  isWorkerScript,
  isWorkerSpawn,
  newestWorker,
  RELAY_ERROR,
  RELAY_HELLO,
  RELAY_READY,
  THIRD_PARTY_HINT,
  toOrigin,
} from './relay-protocol'

const host = toOrigin(new URLSearchParams(location.search).get('host'))
const SW_URL = '/cresslet-sw.js?xorigin=1'

let port: MessagePort | null = null
const channels = new Map<string, BroadcastChannel>()
let workerUrl: string | null = null

function start() {
  if (!host || window.parent === window) return
  addEventListener('message', onInit)
  window.parent.postMessage({ type: RELAY_HELLO }, host)
}

function onInit(ev: MessageEvent) {
  if (port) return
  if (!acceptInit(ev, { host, parent: window.parent, ancestorOrigins: location.ancestorOrigins })) return
  removeEventListener('message', onInit)
  port = ev.ports[0]
  void connect(port)
}

async function connect(p: MessagePort) {
  const sw = serviceWorkers()
  if (!sw) {
    p.postMessage({ type: RELAY_ERROR, message: `Service workers unavailable on ${location.origin} (${THIRD_PARTY_HINT})` })
    return
  }
  sw.addEventListener('message', (ev) => {
    const d = ev.data
    if (!isSwToPage(d, ev.ports)) return
    const transfer: Transferable[] = [ev.ports[0]]
    if (d.type === 'cresslet-request' && d.body instanceof ArrayBuffer) transfer.push(d.body)
    p.postMessage(d, transfer)
  })
  sw.startMessages()
  let reg: ServiceWorkerRegistration
  let active: ServiceWorker
  try {
    reg = await sw.register(SW_URL, { scope: '/' })
    // an older SW may still be active while this page's register() installs a new one: wait for the new one
    active = await newestWorker(reg, () => sw.ready)
  } catch (e) {
    p.postMessage({ type: RELAY_ERROR, message: `Service worker registration failed on ${location.origin}: ${e instanceof Error ? e.message : e} (${THIRD_PARTY_HINT})` })
    return
  }
  p.onmessage = (ev) => {
    const d = ev.data
    if (isProcSpawn(d, ev.ports)) spawn(ev.ports[0])
    else if (isWorkerSpawn(d, ev.ports)) spawnProjectWorker(ev.ports[0], d.source, d.name)
    else if (isWorkerScript(d)) {
      if (workerUrl) URL.revokeObjectURL(workerUrl)
      workerUrl = URL.createObjectURL(new Blob([d.source], { type: 'text/javascript' }))
    } else if (isPageToSw(d)) (reg.active ?? active).postMessage({ type: d.type, instanceId: d.instanceId })
    else if (d?.type === BROADCAST && isChannelName(d.channel)) {
      let bc = channels.get(d.channel)
      if (!bc) channels.set(d.channel, (bc = new BroadcastChannel(d.channel)))
      bc.postMessage(d.message)
    } else if (d?.type === BROADCAST_CLOSE && isChannelName(d.channel)) {
      channels.get(d.channel)?.close()
      channels.delete(d.channel)
    }
  }
  p.postMessage({ type: RELAY_READY })
}

/**
 * Run one `node` worker and proxy it to the host over `port`. This frame owns the worker's SharedArrayBuffer (it needs
 * `allow="cross-origin-isolated"`, which the container sets): sync results arrive as `sync-result` and are written
 * here, so the worker's blocking calls never wait on a cross-origin hop to reach the buffer.
 */
function spawn(port: MessagePort) {
  const fail = (message: string) => port.postMessage({ type: 'worker-error', message } satisfies RelayProcToHost)
  if (!workerUrl) return fail('no worker script')
  let worker: Worker
  try {
    worker = new Worker(workerUrl, { type: 'module', name: 'cresslet-node' })
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  const replier = typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated ? new SyncReplier(new SharedArrayBuffer(HEADER + DEFAULT_SAB)) : null
  worker.onmessage = (ev) => {
    const m = ev.data
    if (m?.type === 'sync-grow') {
      if (m.sab instanceof SharedArrayBuffer) replier?.grow(m.sab)
    } else port.postMessage(m, m?.type === 'http-chunk' && m.data instanceof Uint8Array ? [m.data.buffer] : [])
  }
  worker.onerror = (e) => {
    e.preventDefault()
    fail(e.message || 'worker error')
  }
  port.onmessage = (ev) => {
    const m = ev.data as HostToRelayProc | null
    if (!m || typeof m !== 'object') return
    if (m.type === 'sync-result') {
      if (m.payload instanceof Uint8Array) replier?.write(m.payload)
    } else if (m.type === 'terminate') {
      worker.terminate()
      port.close()
    } else if (m.type === 'start') worker.postMessage({ ...m, sab: replier?.sab ?? null })
    else worker.postMessage(m, m.type === 'http-request' && m.body instanceof ArrayBuffer ? [m.body] : [])
  }
}

/** Run a project worker (`Container.projectWorker`) from `source` and pipe its messages to the host over `port`. */
function spawnProjectWorker(port: MessagePort, source: string, name?: string) {
  const fail = (message: string) => port.postMessage({ t: 'error', message })
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  let worker: Worker
  try {
    worker = new Worker(url, { type: 'module', name })
  } catch (e) {
    URL.revokeObjectURL(url)
    return fail(e instanceof Error ? e.message : String(e))
  }
  // MessagePorts in a message must be transferred again on each hop
  const forward = (to: { postMessage(m: unknown, t: Transferable[]): void }, m: unknown, ports: readonly MessagePort[]) => {
    try {
      to.postMessage(m, [...ports])
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  }
  worker.onmessage = (ev) => forward(port, { t: 'msg', data: ev.data }, ev.ports)
  worker.onerror = (e) => {
    e.preventDefault()
    fail(e.message || 'worker error')
  }
  port.onmessage = (ev) => {
    const m = ev.data as { t?: unknown; data?: unknown } | null
    if (m?.t === 'msg') forward(worker, m.data, ev.ports)
    else if (m?.t === 'terminate') {
      worker.terminate()
      URL.revokeObjectURL(url)
      port.close()
    }
  }
}

function serviceWorkers(): ServiceWorkerContainer | undefined {
  try {
    return navigator.serviceWorker // throws SecurityError where storage is blocked
  } catch {
    return undefined
  }
}

start()
