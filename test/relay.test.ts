import { describe, expect, it } from 'vitest'
import { PortTable } from '../src/ports'
import { acceptHello, acceptInit, isChannelName, isPageToSw, isSwToPage, relayUrl, toOrigin } from '../src/relay-protocol'

const HOST = 'https://studio.example.com'
const parent = { name: 'parent' }
const port = {}
const init = (over: Partial<{ origin: string; source: unknown; data: unknown; ports: unknown[] }> = {}) => ({
  origin: HOST,
  source: parent,
  data: { type: 'cresslet-relay-init' },
  ports: [port],
  ...over,
})
const ctx = (over: Partial<{ host: string | null; ancestorOrigins: string[] | null }> = {}) => ({ host: HOST, parent, ancestorOrigins: [HOST], ...over })

describe('relay: acceptInit', () => {
  it('accepts the host named in its URL, from its parent', () => {
    expect(acceptInit(init(), ctx())).toBe(true)
    expect(acceptInit(init(), ctx({ ancestorOrigins: null }))).toBe(true) // Firefox: no ancestorOrigins
  })
  it('rejects another origin', () => {
    expect(acceptInit(init({ origin: 'https://evil.example' }), ctx())).toBe(false)
    expect(acceptInit(init({ origin: 'https://studio.example.com.evil.example' }), ctx())).toBe(false)
    expect(acceptInit(init({ origin: 'null' }), ctx())).toBe(false)
  })
  it('rejects a lying host param (real parent is another origin)', () => {
    expect(acceptInit(init(), ctx({ ancestorOrigins: ['https://evil.example'] }))).toBe(false)
  })
  it('rejects messages not sent by the parent window', () => {
    expect(acceptInit(init({ source: {} }), ctx())).toBe(false)
    expect(acceptInit(init({ source: null }), ctx())).toBe(false)
  })
  it('rejects without a host, wrong type, or without exactly one port', () => {
    expect(acceptInit(init(), ctx({ host: null }))).toBe(false)
    expect(acceptInit(init({ data: { type: 'cresslet-request' } }), ctx())).toBe(false)
    expect(acceptInit(init({ data: 'cresslet-relay-init' }), ctx())).toBe(false)
    expect(acceptInit(init({ data: null }), ctx())).toBe(false)
    expect(acceptInit(init({ ports: [] }), ctx())).toBe(false)
    expect(acceptInit(init({ ports: [port, port] }), ctx())).toBe(false)
  })
})

describe('container: acceptHello', () => {
  const relay = { name: 'relay' }
  const PREVIEW = 'https://preview.example.net'
  it('accepts only the relay window on the preview origin', () => {
    const ev = { origin: PREVIEW, source: relay, data: { type: 'cresslet-relay-hello' } }
    expect(acceptHello(ev, { previewOrigin: PREVIEW, relay })).toBe(true)
    expect(acceptHello({ ...ev, origin: HOST }, { previewOrigin: PREVIEW, relay })).toBe(false)
    expect(acceptHello({ ...ev, source: {} }, { previewOrigin: PREVIEW, relay })).toBe(false) // e.g. a preview frame
    expect(acceptHello({ ...ev, source: null }, { previewOrigin: PREVIEW, relay: null })).toBe(false)
    expect(acceptHello({ ...ev, data: { type: 'x' } }, { previewOrigin: PREVIEW, relay })).toBe(false)
  })
})

describe('relay: forwarded messages', () => {
  it('forwards only register/unregister with a sane instance id to the SW', () => {
    expect(isPageToSw({ type: 'cresslet-register', instanceId: 'abc123' })).toBe(true)
    expect(isPageToSw({ type: 'cresslet-unregister', instanceId: 'abc123' })).toBe(true)
    expect(isPageToSw({ type: 'cresslet-ping', instanceId: 'abc123' })).toBe(false)
    expect(isPageToSw({ type: 'cresslet-register', instanceId: '../x' })).toBe(false)
    expect(isPageToSw({ type: 'cresslet-register' })).toBe(false)
    expect(isPageToSw(null)).toBe(false)
  })
  it('forwards only who/request messages that carry one reply port to the host', () => {
    expect(isSwToPage({ type: 'cresslet-who', instanceId: 'a' }, [port])).toBe(true)
    expect(isSwToPage({ type: 'cresslet-request', instanceId: 'a' }, [port])).toBe(true)
    expect(isSwToPage({ type: 'cresslet-request', instanceId: 'a' }, [])).toBe(false)
    expect(isSwToPage({ type: 'cresslet-pong' }, [port])).toBe(false)
    expect(isSwToPage('cresslet-who', [port])).toBe(false)
  })
  it('re-broadcasts only on dev server channel names', () => {
    expect(isChannelName('cresslet:abc123:5173')).toBe(true)
    expect(isChannelName('other')).toBe(false)
    expect(isChannelName('cresslet:abc:5173:x')).toBe(false)
    expect(isChannelName(42)).toBe(false)
  })
})

describe('origins', () => {
  it('normalizes http(s) origins only', () => {
    expect(toOrigin('https://preview.example.com/')).toBe('https://preview.example.com')
    expect(toOrigin('http://127.0.0.1:4401/x?y')).toBe('http://127.0.0.1:4401')
    expect(toOrigin('javascript:alert(1)')).toBeNull()
    expect(toOrigin('data:text/html,x')).toBeNull()
    expect(toOrigin('not a url')).toBeNull()
    expect(toOrigin('')).toBeNull()
  })
  it('builds the relay URL with the encoded host origin', () => {
    expect(relayUrl('https://p.example', 'http://localhost:4400')).toBe('https://p.example/cresslet-relay.html?host=http%3A%2F%2Flocalhost%3A4400')
  })
})

describe('PortTable', () => {
  it('builds preview URLs on the preview origin when given one', () => {
    const events = { open() {}, close() {} }
    expect(new PortTable('abc', events, 'https://preview.example.net').url(5173)).toBe('https://preview.example.net/__cresslet__/abc/5173/')
    expect(new PortTable('abc', events).url(5173)).toBe('http://localhost/__cresslet__/abc/5173/') // no location in node
  })
})
