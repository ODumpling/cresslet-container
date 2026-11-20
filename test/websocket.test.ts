import { describe, expect, it } from 'vitest'
import { isSwRequest, PortTable, upgradeWebSocket, websocketHeaders, type PortHandler, type SwRequest } from '../src/ports'
import { injectStrip, insertionPoint } from '../src/sw-lib'

const next = (p: MessagePort) => new Promise<MessageEvent>((resolve) => (p.onmessage = resolve))

/**
 * Open a preview WebSocket against `handler` the way the SW forwards one (reply port + the socket's server end).
 * Resolves with the first answer and the preview's end of the socket.
 */
async function open(handler: PortHandler, protocols: string[] = [], headers = websocketHeaders(protocols, 'http://preview.test')) {
  const table = new PortTable('abc', { open() {}, close() {} }, 'http://preview.test')
  table.open(3000, handler)
  const hs = new MessageChannel()
  const data = new MessageChannel()
  const m: SwRequest = { type: 'cresslet-request', instanceId: 'abc', port: 3000, path: '/ws?x=1', method: 'GET', headers, body: null, websocket: true }
  expect(isSwRequest(m)).toBe(true)
  const answer = next(hs.port1)
  void table.answer(m, hs.port2, data.port2)
  const e = await answer
  hs.port1.close()
  return { answer: e.data, client: data.port1 }
}

describe('preview WebSockets (port side)', () => {
  it('dispatches a GET with the upgrade headers visible, and answers open once accepted', async () => {
    let seen: { method: string; url: string; upgrade: string | null; headers: [string, string][] } | null = null
    let server!: MessagePort
    const { answer, client } = await open((req) => {
      seen = { method: req.method, url: req.url, upgrade: req.headers.get('upgrade'), headers: [...req.headers] }
      const { socket, response } = upgradeWebSocket(req)
      server = socket
      socket.postMessage({ type: 'message', data: 'early' }) // queued until the preview listens
      return response
    })
    expect(seen).toMatchObject({ method: 'GET', url: 'http://localhost:3000/ws?x=1', upgrade: 'websocket' })
    expect(seen!.headers).toContainEqual(['origin', 'http://preview.test'])
    expect(answer).toEqual({ type: 'open', protocol: '' })
    expect((await next(client)).data).toEqual({ type: 'message', data: 'early' })
    client.postMessage({ type: 'message', data: 'hi' })
    expect((await next(server)).data).toEqual({ type: 'message', data: 'hi' })
    client.close()
    server.close()
  })

  it('selects one of the offered subprotocols, and rejects one that was not offered (or none)', async () => {
    const ok = await open((req) => upgradeWebSocket(req, { protocol: 'b' }).response, ['a', 'b'])
    expect(ok.answer).toEqual({ type: 'open', protocol: 'b' })
    ok.client.close()
    let err = ''
    const r = await open((req) => {
      try {
        return upgradeWebSocket(req, { protocol: 'c' }).response
      } catch (x) {
        err = String(x)
        return new Response('no', { status: 400 })
      }
    }, ['a'])
    expect(err).toMatch(/did not offer subprotocol "c"/)
    expect(r.answer).toEqual({ type: 'refused', status: 400 })
    // as in browsers, offering subprotocols means the server must pick one
    expect((await open((req) => upgradeWebSocket(req).response, ['a'])).answer).toEqual({ type: 'refused', status: 500 })
  })

  it('makes the upgrade headers itself: only the offered subprotocols come from the (untrusted) forwarded message', async () => {
    let seen: [string, string][] = []
    const forged: [string, string][] = [['origin', 'https://trusted.example'], ['cookie', 'a=b'], ['sec-websocket-protocol', 'chat']]
    const e = await open((req) => ((seen = [...req.headers]), upgradeWebSocket(req, { protocol: 'chat' }).response), [], forged)
    e.client.close()
    expect(seen).toEqual(websocketHeaders(['chat'], 'http://preview.test').sort())
    let called = false
    for (const bad of ['a b', 'a, a', 'x\ny'])
      expect((await open(() => ((called = true), new Response()), [], [['sec-websocket-protocol', bad]])).answer).toEqual({ type: 'refused', status: 400 })
    expect(called).toBe(false)
  })

  it('refuses when the handler returns anything but the upgrade response (or throws)', async () => {
    expect((await open(() => new Response('nope', { status: 404 }))).answer).toEqual({ type: 'refused', status: 404 })
    let server!: MessagePort
    const e = await open((req) => {
      server = upgradeWebSocket(req).socket
      const { port1 } = new MessageChannel()
      port1.postMessage(null, [server]) // transferred elsewhere (e.g. a worker) before changing its mind
      return new Response('changed my mind', { status: 403 })
    })
    expect(e.answer).toEqual({ type: 'refused', status: 403 })
    expect((await open(() => Promise.reject(new Error('boom')))).answer).toEqual({ type: 'refused', status: 500 })
  })

  it('a handler that keeps the socket and refuses still gets the preview\'s close on it', async () => {
    let server!: MessagePort
    const e = await open((req) => {
      server = upgradeWebSocket(req).socket
      return new Response('no', { status: 403 })
    })
    expect(e.answer).toEqual({ type: 'refused', status: 403 })
    const got = next(server)
    e.client.postMessage({ type: 'close', code: 1001, reason: '' }) // what the shim sends on refusal
    expect((await got).data).toEqual({ type: 'close', code: 1001, reason: '' })
    server.close()
  })

  it('refuses, and upgradeWebSocket throws, once the preview cancelled while the handler ran', async () => {
    const table = new PortTable('abc', { open() {}, close() {} })
    let go!: () => void
    let err = ''
    table.open(3000, async (req) => {
      await new Promise<void>((r) => (go = r))
      try {
        return upgradeWebSocket(req).response
      } catch (x) {
        err = String(x)
        throw x
      }
    })
    const hs = new MessageChannel()
    const data = new MessageChannel()
    const answer = next(hs.port1)
    void table.answer({ type: 'cresslet-request', instanceId: 'abc', port: 3000, path: '/ws', method: 'GET', headers: [], body: null, websocket: true }, hs.port2, data.port2)
    hs.port1.postMessage({ type: 'cancel' }) // the preview closed / navigated away
    await new Promise((r) => setTimeout(r, 10))
    go()
    expect((await answer).data).toEqual({ type: 'refused', status: 500 })
    expect(err).toMatch(/gave up/)
    hs.port1.close()
    data.port1.close()
  })

  it('only upgrades pending preview WebSocket requests, once', async () => {
    expect(() => upgradeWebSocket(new Request('http://localhost/ws', { headers: { upgrade: 'websocket' } }))).toThrow(/not a WebSocket upgrade/)
    let kept!: Request
    let twice = ''
    const e = await open((req) => {
      kept = req
      const r = upgradeWebSocket(req).response
      try {
        upgradeWebSocket(req)
      } catch (x) {
        twice = String(x)
      }
      return r
    })
    e.client.close()
    expect(twice).toMatch(/already upgraded/)
    expect(() => upgradeWebSocket(kept)).toThrow(/no longer pending/)
  })

  it('needs the socket port, and validates the websocket flag', async () => {
    const table = new PortTable('abc', { open() {}, close() {} })
    let called = false
    table.open(3000, () => ((called = true), new Response()))
    const hs = new MessageChannel()
    const answer = next(hs.port1)
    void table.answer({ type: 'cresslet-request', instanceId: 'abc', port: 3000, path: '/ws', method: 'GET', headers: [], body: null, websocket: true }, hs.port2)
    expect((await answer).data).toMatchObject({ type: 'head', status: 400 })
    hs.port1.close()
    expect(called).toBe(false)
    const m = { type: 'cresslet-request', instanceId: 'a', port: 1, path: '/', method: 'GET', headers: [], body: null }
    expect(isSwRequest({ ...m, websocket: 'yes' })).toBe(false)
    expect(isSwRequest({ ...m, websocket: false })).toBe(true)
  })

  it('injects ahead of app scripts: after <head> (not <header>, not in a comment), else after the doctype', () => {
    const cases: [string, string][] = [
      ['<html><head lang="en"><script>app()</script></head></html>', '<html><head lang="en">|<script>app()'],
      ['<!doctype html><title>App</title><header>App</header><script>app()</script>', '<!doctype html>|<title>'],
      ['<!-- <head> --><!DOCTYPE html><html><head><script>app()</script>', '<!-- <head> --><!DOCTYPE html><html><head>|<script>'],
      ['<script>window.early = 1</script><header>x</header>', '|<script>window.early'],
      ['<!doctype html><script>const fragment = "<head>"</script>', '<!doctype html>|<script>const'],
      ['<!doctype html>\n<html lang="en">\n<head data-rule="a > b">\n<script>app()', '<head data-rule="a > b">|\n<script>'],
      ['\uFEFF<!DOCTYPE html><html><body><script>app()', '<!DOCTYPE html><html>|<body>'],
    ]
    for (const [html, want] of cases) {
      const at = insertionPoint(html)
      expect(html.slice(0, at) + '|' + html.slice(at)).toContain(want)
    }
  })

  it('preview HTML gets the WebSocket shim after the prefix-strip script', async () => {
    const r = await injectStrip(new Response('<html><head></head><body>x</body></html>', { headers: { 'content-type': 'text/html' } }))
    const html = await r.text()
    expect(html.indexOf('history.replaceState')).toBeLessThan(html.indexOf("type: 'cresslet-ws'"))
    expect(html).toMatch(/<\/script><script>[^]*window\.WebSocket = WebSocket[^]*<\/script><\/head>/)
  })
})
