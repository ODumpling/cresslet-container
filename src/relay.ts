// cresslet-relay.js — runs in cresslet-relay.html, a hidden iframe the container creates on the preview origin when
// booted with `previewOrigin`. Registers cresslet-sw.js on the preview origin and bridges it to the host page over one
// MessagePort (see relay-protocol.ts). Previews are same-origin with this frame, so nothing here is trusted by the host:
// it only relays what the SW could ask of the owning page anyway.
import {
  acceptInit,
  BROADCAST,
  BROADCAST_CLOSE,
  isChannelName,
  isPageToSw,
  isSwToPage,
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
    if (isPageToSw(d)) (reg.active ?? active).postMessage({ type: d.type, instanceId: d.instanceId })
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

function serviceWorkers(): ServiceWorkerContainer | undefined {
  try {
    return navigator.serviceWorker // throws SecurityError where storage is blocked
  } catch {
    return undefined
  }
}

start()
