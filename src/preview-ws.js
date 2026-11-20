// Injected (minified, inline) into preview HTML by cresslet-sw.js, after the prefix-strip script. Service workers can't
// see WebSocket connections, so `window.WebSocket` is replaced: a socket to the preview's own host (ws: or wss:, any
// path, `/__cresslet__/<id>/<port>/…` or app-relative) is opened through the service worker instead. The SW forwards
// it to the owning container (over the relay with a `previewOrigin`) as a `cresslet-request` with `websocket: true`;
// the port's handler accepts it with `Container.upgradeWebSocket(req)` and gets the other end of this socket's
// MessagePort. Sockets to other hosts use the browser's WebSocket.
//
// The socket's data channel is made here: one end is sent with the request (the handler gets it from
// upgradeWebSocket), so this side can always tell the server end it's gone, even before the answer arrives.
// On the handshake port: { type: 'open', protocol }, or anything else (refused).
// On the data port, both ways: { type: 'message', data: string | ArrayBuffer }, { type: 'close', code?, reason? }
// (the sender of `close` is done with the port, its receiver closes it).
;(function () {
  var Native = window.WebSocket
  var sw = navigator.serviceWorker
  if (!Native || !sw) return
  var STATES = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }
  var TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
  // as long as the SW waits for a forwarded request's head (sw-lib.ts HEAD_DEADLINE)
  var DEADLINE = 30000
  var later = (fn) => setTimeout(fn, 0)
  // realm-independent: data may come from another frame
  var tag = (d) => Object.prototype.toString.call(d)
  var isBlob = (d) => tag(d) === '[object Blob]' || tag(d) === '[object File]'
  var bytes = (d) => (ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : tag(d) === '[object ArrayBuffer]' ? d.slice(0) : String(d))
  var fail = (what, msg) => new DOMException("Failed to construct 'WebSocket': " + msg, what)
  // open (and connecting) sockets, told the page is going away (1001) as a browser does on unload
  var live = new Set()
  addEventListener('pagehide', () => live.forEach((ws) => ws._goingAway()))

  class WebSocket extends EventTarget {
    constructor(url, protocols) {
      var u
      try {
        u = new URL(String(url), document.baseURI)
      } catch (e) {
        throw fail('SyntaxError', "The URL '" + url + "' is invalid.")
      }
      if (u.protocol === 'http:') u.protocol = 'ws:'
      else if (u.protocol === 'https:') u.protocol = 'wss:'
      if (u.host !== location.host || (u.protocol !== 'ws:' && u.protocol !== 'wss:')) return protocols === undefined ? new Native(url) : new Native(url, protocols)
      if (u.href.indexOf('#') >= 0) throw fail('SyntaxError', "The URL contains a fragment identifier ('" + u.hash + "'). Fragment identifiers are not allowed in WebSocket URLs.")
      super()
      var list = protocols === undefined ? [] : typeof protocols !== 'object' || protocols === null ? [String(protocols)] : Array.from(protocols, String)
      for (var i = 0; i < list.length; i++) {
        if (!TOKEN.test(list[i])) throw fail('SyntaxError', "The subprotocol '" + list[i] + "' is invalid.")
        if (list.indexOf(list[i]) !== i) throw fail('SyntaxError', "The subprotocol '" + list[i] + "' is duplicated.")
      }
      this.url = u.href
      this.protocol = ''
      this.extensions = ''
      this.binaryType = 'blob'
      this.bufferedAmount = 0
      this._state = 0
      this._queue = null
      this._done = false
      var ch = new MessageChannel() // handshake
      var data = new MessageChannel()
      this._port = data.port1
      this._handshake = ch.port1
      this._timer = setTimeout(() => this._fail(), DEADLINE)
      ch.port1.onmessage = (e) => {
        this._settle()
        var m = e.data
        var ok = m && m.type === 'open' && (list.length ? list.indexOf(m.protocol) >= 0 : m.protocol === '')
        if (!ok || this._state !== 0 || this._done) return this._fail() // refused, a bad answer, or too late
        this._state = 1
        this.protocol = m.protocol
        this._port.onmessage = (ev) => this._receive(ev.data)
        this.dispatchEvent(new Event('open'))
      }
      var ask = (w) => w.postMessage({ type: 'cresslet-ws', url: this.url, protocols: list }, [ch.port2, data.port2])
      live.add(this)
      if (sw.controller) ask(sw.controller)
      else sw.ready.then((r) => ask(r.active)).catch(() => this._fail())
    }

    get readyState() {
      return this._state
    }

    send(data) {
      if (this._state === 0) throw new DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", 'InvalidStateError')
      if (this._state !== 1) return
      var post = (d) => !this._done && this._port.postMessage({ type: 'message', data: d })
      var blob = isBlob(data)
      var d = blob ? data : bytes(data) // copied now: the caller may reuse its buffer
      // Blobs are read asynchronously: keep everything after one in order; one that can't be read fails the socket
      if (blob || this._queue)
        this._queue = (this._queue || Promise.resolve())
          .then(() => (blob ? d.arrayBuffer() : d))
          .then(post)
          .catch(() => this._fail(1011))
      else post(d)
    }

    close(code, reason) {
      if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999))
        throw new DOMException("Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. " + code + ' is neither.', 'InvalidAccessError')
      reason = reason === undefined ? '' : String(reason)
      if (new TextEncoder().encode(reason).length > 123) throw new DOMException("Failed to execute 'close' on 'WebSocket': The close reason must not be greater than 123 UTF-8 bytes.", 'SyntaxError')
      if (this._state > 1 || this._done) return
      if (this._state === 0) {
        // fails now, as a browser does (a late acceptance gets the close)
        this._state = 2
        return this._fail(1001)
      }
      this._state = 2
      var done = () => {
        if (this._done) return
        this._port.postMessage({ type: 'close', code: code, reason: reason })
        this._end(code === undefined ? 1005 : code, reason, true)
      }
      if (this._queue) this._queue.then(done)
      else done()
    }

    _goingAway() {
      if (this._done) return
      if (this._state === 0) return this._fail(1001)
      this._port.postMessage({ type: 'close', code: 1001, reason: '' })
      this._end(1001, '', true)
    }

    _receive(m) {
      if (!m || this._done) return
      if (m.type === 'message' && this._state === 1) {
        var d = m.data
        if (typeof d !== 'string') {
          if (tag(d) !== '[object ArrayBuffer]') d = bytes(d) // views (or whatever else) the server end posted
          if (typeof d === 'string') return
          if (this.binaryType !== 'arraybuffer') d = new Blob([d])
        }
        this.dispatchEvent(new MessageEvent('message', { data: d, origin: new URL(this.url).origin }))
      } else if (m.type === 'close') this._end(typeof m.code === 'number' ? m.code : 1005, typeof m.reason === 'string' ? m.reason : '', true, true)
    }

    _end(code, reason, clean, received) {
      if (this._done) return
      this._done = true
      live.delete(this)
      if (this._state < 2) this._state = 2 // CLOSING until the close event
      // the receiver of `close` closes the port: closing it right after posting can drop the message while the other
      // end is still being transferred (Firefox)
      if (this._port) this._port.onmessage = null
      if (received) this._port.close()
      later(() => {
        this._state = 3
        this.dispatchEvent(new CloseEvent('close', { code: code, reason: reason, wasClean: clean }))
      })
    }

    /** The handshake is over (answered or given up). */
    _settle() {
      clearTimeout(this._timer)
      this._handshake.onmessage = null
      this._handshake.close()
    }

    /**
     * Error, then close (1006). Tells the server end, wherever it is (or will be, if the handler still accepts): 1001 by
     * default (1006 is reserved: a WebSocketPair's close() would throw on it).
     */
    _fail(code) {
      if (this._done) return
      this._done = true
      live.delete(this)
      // still connecting: cancel (see ports.ts answerSocket), and leave closing the handshake to the host (Firefox can drop
      // a message posted right before close() while the other end is in transit)
      clearTimeout(this._timer)
      this._handshake.onmessage = null
      this._handshake.postMessage({ type: 'cancel' })
      this._port.onmessage = null
      this._port.postMessage({ type: 'close', code: code || 1001, reason: '' }) // its receiver closes the port
      later(() => {
        this._state = 3
        this.dispatchEvent(new Event('error'))
        this.dispatchEvent(new CloseEvent('close', { code: 1006, reason: '', wasClean: false }))
      })
    }

    static [Symbol.hasInstance](x) {
      return x instanceof Native || Function.prototype[Symbol.hasInstance].call(WebSocket, x)
    }
  }

  for (var k in STATES) {
    Object.defineProperty(WebSocket, k, { value: STATES[k], enumerable: true })
    Object.defineProperty(WebSocket.prototype, k, { value: STATES[k], enumerable: true })
  }
  // on<event> handlers, called in the order they were first set among the listeners (as event handler attributes are)
  ;['open', 'message', 'error', 'close'].forEach((t) => {
    Object.defineProperty(WebSocket.prototype, 'on' + t, {
      configurable: true,
      get() {
        return (this._on && this._on[t] && this._on[t].fn) || null
      },
      set(fn) {
        var on = this._on || (this._on = {})
        if (!on[t]) {
          on[t] = { fn: null }
          this.addEventListener(t, (e) => typeof on[t].fn === 'function' && on[t].fn.call(this, e))
        }
        on[t].fn = typeof fn === 'function' ? fn : null
      },
    })
  })
  window.WebSocket = WebSocket
})()
