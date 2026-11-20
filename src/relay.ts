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
  RELAY_ERROR,
  RELAY_HELLO,
  RELAY_READY,
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
  if (!('serviceWorker' in navigator)) {
    p.postMessage({ type: RELAY_ERROR, message: 'Service workers unavailable on the preview origin' })
    return
  }
  const sw = navigator.serviceWorker
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
    active = reg.active ?? (await waitActive(reg))
  } catch (e) {
    p.postMessage({ type: RELAY_ERROR, message: `Service worker registration failed on ${location.origin}: ${e instanceof Error ? e.message : e}` })
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

function waitActive(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  return new Promise((resolve, reject) => {
    const w = reg.installing ?? reg.waiting
    if (!w) return navigator.serviceWorker.ready.then((r) => resolve(r.active!), reject)
    const check = () => {
      if (w.state === 'activated') resolve(w)
      else if (w.state === 'redundant') reject(new Error('service worker became redundant'))
    }
    w.addEventListener('statechange', check)
    check()
  })
}

start()
