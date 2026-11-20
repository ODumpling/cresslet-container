import { describe, expect, it } from 'vitest'
import { isolate, isRelayClient, isReserved, receiveResponse, RESERVED, XORIGIN_HEADERS } from '../src/sw-lib'
import { isSwRequest, PortTable, rejectRequest, type SwRequest } from '../src/ports'

const P = 'https://preview.example.net'

describe('sw: relay clients', () => {
  it('only nested frames at /cresslet-relay.html may own containers on a preview origin', () => {
    expect(isRelayClient({ url: `${P}/cresslet-relay.html?host=x`, frameType: 'nested' })).toBe(true)
    expect(isRelayClient({ url: `${P}/cresslet-relay.html`, frameType: 'top-level' })).toBe(false)
    expect(isRelayClient({ url: `${P}/cresslet-relay.html`, frameType: 'auxiliary' })).toBe(false)
    expect(isRelayClient({ url: `${P}/`, frameType: 'nested' })).toBe(false) // a preview
    expect(isRelayClient({ url: `${P}/__cresslet__/a/5173/cresslet-relay.html`, frameType: 'nested' })).toBe(false)
    expect(isRelayClient({ url: `${P}/cresslet-relay.html.x`, frameType: 'nested' })).toBe(false)
    expect(isRelayClient({ url: 'nope', frameType: 'nested' })).toBe(false)
  })
  it('reserves the relay assets for the network', () => {
    expect([...RESERVED].sort()).toEqual(['/cresslet-relay.html', '/cresslet-relay.js', '/cresslet-sw.js'])
  })
  it('bypasses the relay assets only on a preview origin (same-origin previews may have files named like them)', () => {
    for (const p of RESERVED) {
      expect(isReserved(p, true)).toBe(true)
      expect(isReserved(p, false)).toBe(false)
    }
    expect(isReserved('/src/main.tsx', true)).toBe(false)
  })
})

describe('sw: isolate', () => {
  const o = { xorigin: true, prefix: '/__cresslet__/a/5173' }
  it('always sends CORP cross-origin on a preview origin, overriding a handler', () => {
    expect(isolate([['cross-origin-resource-policy', 'same-origin']], o).get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(isolate([], o).get('cross-origin-resource-policy')).toBe('cross-origin')
  })
  it("keeps a handler's CORP on the host origin", () => {
    expect(isolate([['cross-origin-resource-policy', 'cross-origin']], { ...o, xorigin: false }).get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(isolate([], { ...o, xorigin: false }).get('cross-origin-resource-policy')).toBe('same-origin')
  })
  it('keeps root-relative redirects in the preview', () => {
    expect(isolate([['location', '/login']], o).get('location')).toBe('/__cresslet__/a/5173/login')
    expect(isolate([['location', '//x.example/']], o).get('location')).toBe('//x.example/')
  })
})

describe('sw: receiveResponse', () => {
  const opts = (deadlineMs = 2000) => ({ method: 'GET', headers: (raw: [string, string][]) => isolate(raw, { xorigin: true, prefix: '/p' }), errorHeaders: XORIGIN_HEADERS, deadlineMs })
  const closed = (port: MessagePort) => {
    const close = port.close.bind(port)
    let n = 0
    port.close = () => (n++, close())
    return () => n
  }

  it('streams head + chunks, then closes its port', async () => {
    const ch = new MessageChannel()
    const closes = closed(ch.port1)
    const res = receiveResponse(ch.port1, opts())
    ch.port2.postMessage({ type: 'head', status: 201, statusText: 'Created', headers: [['content-type', 'text/plain']] })
    ch.port2.postMessage({ type: 'chunk', data: new TextEncoder().encode('hi') })
    ch.port2.postMessage({ type: 'end' })
    const r = await res
    expect(r.status).toBe(201)
    expect(await r.text()).toBe('hi')
    expect(closes()).toBe(1)
    ch.port2.close()
  })

  it('answers a retryable 504 when no head arrives in time, cancels and closes', async () => {
    const ch = new MessageChannel()
    const closes = closed(ch.port1)
    const seen: unknown[] = []
    ch.port2.onmessage = (e) => seen.push(e.data)
    const r = await receiveResponse(ch.port1, opts(50))
    expect(r.status).toBe(504)
    expect(r.headers.get('retry-after')).toBe('1')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(await r.text()).toMatch(/did not answer/)
    expect(closes()).toBe(1)
    await new Promise((f) => setTimeout(f, 20))
    expect(seen).toEqual([{ type: 'cancel' }])
    ch.port2.close()
  })

  it('a 500 before the head carries the preview-origin headers', async () => {
    const ch = new MessageChannel()
    const res = receiveResponse(ch.port1, opts())
    ch.port2.postMessage({ type: 'error', message: 'boom' })
    const r = await res
    expect(r.status).toBe(500)
    expect(r.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('require-corp')
    ch.port2.close()
  })

  it('205 Reset Content gets a null body', async () => {
    const ch = new MessageChannel()
    const closes = closed(ch.port1)
    const res = receiveResponse(ch.port1, opts())
    ch.port2.postMessage({ type: 'head', status: 205, statusText: 'Reset Content', headers: [] })
    ch.port2.postMessage({ type: 'end' })
    const r = await res
    expect(r.status).toBe(205)
    expect(r.body).toBeNull()
    await new Promise((f) => setTimeout(f, 20))
    expect(closes()).toBe(1)
    ch.port2.close()
  })

  it('a malformed head resolves a 502, cancels and closes the port', async () => {
    for (const head of [
      { status: 200, statusText: 'OK', headers: [['bad name', 'x']] },
      { status: 200, statusText: 'OK', headers: [['a', 'b\r\nc']] },
      { status: 200, statusText: 'O\r\nK', headers: [] },
      { status: 200.5, statusText: 'OK', headers: [] },
      { status: 700, statusText: 'OK', headers: [] },
      { status: '200', statusText: 'OK', headers: [] },
    ]) {
      const ch = new MessageChannel()
      const closes = closed(ch.port1)
      const seen: unknown[] = []
      ch.port2.onmessage = (e) => seen.push(e.data)
      const res = receiveResponse(ch.port1, opts(5000))
      ch.port2.postMessage({ type: 'head', ...head })
      const r = await Promise.race([res, new Promise<'pending'>((f) => setTimeout(() => f('pending'), 200))])
      expect(r, JSON.stringify(head)).not.toBe('pending')
      expect((r as Response).status, JSON.stringify(head)).toBe(502)
      expect((r as Response).headers.get('cross-origin-resource-policy')).toBe('cross-origin')
      expect(closes(), JSON.stringify(head)).toBe(1)
      await new Promise((f) => setTimeout(f, 20))
      expect(seen).toEqual([{ type: 'cancel' }])
      ch.port2.close()
    }
  })

  it('cancelling the body tells the page and closes the port', async () => {
    const ch = new MessageChannel()
    const closes = closed(ch.port1)
    const seen: unknown[] = []
    ch.port2.onmessage = (e) => seen.push(e.data)
    const res = receiveResponse(ch.port1, opts())
    ch.port2.postMessage({ type: 'head', status: 200, statusText: 'OK', headers: [] })
    await (await res).body!.cancel()
    expect(closes()).toBe(1)
    await new Promise((f) => setTimeout(f, 20))
    expect(seen).toEqual([{ type: 'cancel' }])
    ch.port2.close()
  })
})

const req = (over: Partial<SwRequest> = {}): SwRequest => ({ type: 'cresslet-request', instanceId: 'abc', port: 5173, path: '/', method: 'GET', headers: [], body: null, ...over })

describe('ports: isSwRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isSwRequest(req())).toBe(true)
    expect(isSwRequest(req({ method: 'POST', body: new ArrayBuffer(2), headers: [['a', 'b']] }))).toBe(true)
    expect(isSwRequest(req({ method: 'X'.repeat(64) }))).toBe(true) // no length cap: any token is a valid method
  })
  it('rejects malformed fields', () => {
    for (const bad of [
      { port: 5173.5 },
      { port: 0 },
      { port: 70000 },
      { port: '5173' },
      { path: 'x' },
      { path: 1 },
      { method: 'GET /' },
      { method: '' },
      { headers: [['a']] },
      { headers: [['a', 1]] },
      { headers: 'a: b' },
      { body: 'x' },
      { instanceId: 1 },
      { type: 'cresslet-who' },
    ])
      expect(isSwRequest(req(bad as never)), JSON.stringify(bad)).toBe(false)
    expect(isSwRequest(null)).toBe(false)
  })
})

describe('ports: rejectRequest', () => {
  it('answers a 400 head + end and closes the reply port', () => {
    const sent: { type: string; status?: number }[] = []
    let closes = 0
    rejectRequest({ postMessage: (m: { type: string }) => sent.push(m), close: () => void closes++ } as unknown as MessagePort)
    expect(sent.map((m) => m.type)).toEqual(['head', 'chunk', 'end'])
    expect(sent[0].status).toBe(400)
    expect(closes).toBe(1)
  })
})

describe('ports: answer', () => {
  const fakeReply = () => {
    const sent: { type: string }[] = []
    let closes = 0
    const reply = { onmessage: null as ((ev: { data: unknown }) => void) | null, postMessage: (m: { type: string }) => sent.push(m), close: () => void closes++ }
    return { reply, sent, closes: () => closes }
  }
  const table = (handler: () => Response | Promise<Response>) => {
    const t = new PortTable('abc', { open() {}, close() {} })
    t.open(5173, handler)
    return t
  }

  it('closes the reply port and drops its listener when the response ends', async () => {
    const f = fakeReply()
    await table(() => new Response('ok')).answer(req(), f.reply as unknown as MessagePort)
    expect(f.sent.map((m) => m.type)).toEqual(['head', 'chunk', 'end'])
    expect(f.closes()).toBe(1)
    expect(f.reply.onmessage).toBeNull()
  })

  it('stops streaming, closes and drops the listener on cancel', async () => {
    const f = fakeReply()
    let cancelled = false
    const body = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => void (cancelled = true) })
    const done = table(() => new Response(body)).answer(req(), f.reply as unknown as MessagePort)
    await new Promise((r) => setTimeout(r, 10))
    f.reply.onmessage!({ data: { type: 'cancel' } })
    await done
    expect(cancelled).toBe(true)
    expect(f.sent.map((m) => m.type)).toEqual(['head'])
    expect(f.closes()).toBe(1)
    expect(f.reply.onmessage).toBeNull()
  })
})
