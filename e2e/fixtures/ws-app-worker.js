// A project worker (`Container.projectWorker`) running a Workers-style app server, as a studio would: the app answers
// `Upgrade: websocket` with a `WebSocketPair` and `new Response(null, { status: 101, webSocket })`. Browsers have
// neither (and `Response` rejects 101), so this worker provides minimal ones and glues the pair's client end to the
// preview socket's MessagePort it gets from `Container.upgradeWebSocket`.
//   in:  { type: 'init', code }                       → out: { type: 'ready' }
//   in:  { type: 'request', id, url, method, headers } → out: { type: 'response', id, status, headers, body, protocol }
//   in:  { type: 'socket', id } + the socket port       (after a 101: connect it; no port: the preview gave up)
//   out: { type: 'log', msg }

class PairSocket extends EventTarget {
  peer = null
  readyState = 1
  #accepted = false
  #queue = []
  accept() {
    this.#accepted = true
    for (const e of this.#queue.splice(0)) this.dispatchEvent(e)
  }
  deliver(e) {
    if (this.#accepted) this.dispatchEvent(e)
    else this.#queue.push(e)
  }
  send(data) {
    if (this.readyState === 1) this.peer.deliver(new MessageEvent('message', { data }))
  }
  close(code, reason = '') {
    if (this.readyState === 3) return
    this.readyState = this.peer.readyState = 3
    this.peer.deliver(new CloseEvent('close', { code: code ?? 1005, reason, wasClean: true }))
  }
}
globalThis.WebSocketPair = class {
  constructor() {
    const a = new PairSocket()
    const b = new PairSocket()
    a.peer = b
    b.peer = a
    this[0] = a
    this[1] = b
  }
}
const NativeResponse = Response
globalThis.Response = class Response extends NativeResponse {
  constructor(body, init) {
    if (init?.status !== 101) return super(body, init)
    super(null, { ...init, status: 200 })
    Object.defineProperty(this, 'status', { value: 101 })
    this.webSocket = init.webSocket
  }
}
globalThis.log = (msg) => postMessage({ type: 'log', msg })

let app
const sockets = new Map() // request id -> the pair's client end, until its port arrives

onmessage = async ({ data: m, ports }) => {
  if (m.type === 'init') {
    app = (await import(URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' })))).default
    postMessage({ type: 'ready' })
  } else if (m.type === 'request') {
    const req = new Request(m.url, { method: m.method })
    Object.defineProperty(req, 'headers', { value: new Headers(m.headers) }) // `Request` drops Upgrade / Sec-*
    const res = await app.fetch(req)
    if (res.status === 101) sockets.set(m.id, res.webSocket)
    const body = res.status === 101 ? null : await res.text()
    postMessage({ type: 'response', id: m.id, status: res.status, headers: [...res.headers], body, protocol: res.headers.get('sec-websocket-protocol') ?? undefined })
  } else if (m.type === 'socket') {
    const client = sockets.get(m.id)
    sockets.delete(m.id)
    const port = ports[0]
    if (!port) return client.close(1001, '') // the app's server end hears it's gone
    client.addEventListener('message', (e) => port.postMessage({ type: 'message', data: e.data }))
    client.addEventListener('close', (e) => port.postMessage({ type: 'close', code: e.code, reason: e.reason })) // the preview closes the port
    port.onmessage = ({ data: d }) => {
      if (d.type === 'message') client.send(d.data)
      else if (d.type === 'close') (client.close(d.code, d.reason), port.close())
    }
    client.accept()
  }
}
