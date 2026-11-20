import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container } from '../src/container'
import { PortTable } from '../src/ports'
import { acceptHello, acceptInit, isChannelName, isPageToSw, isSwToPage, newestWorker, relayErrorText, relayUrl, toOrigin } from '../src/relay-protocol'

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

describe('relay: errors', () => {
  it('prefixes relay error text and strips control characters', () => {
    expect(relayErrorText('SW failed\u001b[31m\r\nfake: ok\u0007')).toBe('preview relay: SW failed[31mfake: ok')
    expect(relayErrorText(undefined)).toBe('preview relay: undefined')
    expect(relayErrorText('x'.repeat(2000)).length).toBe('preview relay: '.length + 500)
  })
})

class FakeWorker extends EventTarget {
  constructor(public name: string, public state: string) {
    super()
  }
  set(state: string) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

describe('relay: newestWorker', () => {
  const ready = () => Promise.reject(new Error('unused'))
  it('waits for a newer installing worker instead of using the older active one', async () => {
    const old = new FakeWorker('old', 'activated')
    const next = new FakeWorker('new', 'installing')
    const got = newestWorker({ installing: next, waiting: null, active: old }, ready)
    next.set('installed')
    next.set('activating')
    next.set('activated')
    expect((await got).name).toBe('new')
  })
  it('waits for a waiting worker too', async () => {
    const next = new FakeWorker('new', 'installed')
    const got = newestWorker({ installing: null, waiting: next, active: new FakeWorker('old', 'activated') }, ready)
    next.set('activated')
    expect((await got).name).toBe('new')
  })
  it('uses the active worker when nothing newer is pending, else ready', async () => {
    expect((await newestWorker({ installing: null, waiting: null, active: new FakeWorker('a', 'activated') }, ready)).name).toBe('a')
    const r = new FakeWorker('r', 'activated')
    expect((await newestWorker({ installing: null, waiting: null, active: null }, () => Promise.resolve({ active: r }))).name).toBe('r')
  })
  it('rejects when the new worker becomes redundant', async () => {
    const next = new FakeWorker('new', 'installing')
    const got = newestWorker({ installing: next, waiting: null, active: null }, ready)
    next.set('redundant')
    await expect(got).rejects.toThrow(/redundant/)
  })
  it('falls back to the older active worker when the new one becomes redundant', async () => {
    const next = new FakeWorker('new', 'installing')
    const got = newestWorker({ installing: next, waiting: null, active: new FakeWorker('old', 'activated') }, ready)
    next.set('redundant')
    expect((await got).name).toBe('old')
  })
})

describe('Container.boot() on the host origin', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses the active worker and does not wait for a newer one stuck in waiting', async () => {
    const posted: unknown[] = []
    const active = { state: 'activated', postMessage: (m: unknown) => posted.push(m) }
    const waiting = Object.assign(new FakeWorker('custom update', 'installed'), { postMessage() {} })
    const sw = {
      addEventListener() {},
      removeEventListener() {},
      startMessages() {},
      register: async () => ({ installing: null, waiting, active }),
      ready: new Promise(() => {}),
    }
    vi.stubGlobal('navigator', { serviceWorker: sw })
    const c = await Promise.race([
      Container.boot({ serviceWorkerUrl: '/custom-sw.js', npmCache: false }),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 200)),
    ])
    expect(c).not.toBe('hung')
    expect(posted).toEqual([{ type: 'cresslet-register', instanceId: (c as Container).instanceId }])
    ;(c as Container).teardown()
  })
})

describe('Container.boot({ previewOrigin })', () => {
  const PREVIEW = 'https://preview.example.net'
  /** A fake page: the relay frame answers hello per `relay`, given the container's port. */
  function fakePage(relay?: (port: MessagePort) => void) {
    const listeners = new Set<(ev: unknown) => void>()
    const contentWindow = {
      postMessage: (_m: unknown, _origin: string, transfer: MessagePort[]) => relay?.(transfer[0]),
    }
    const frame = { src: '', title: '', tabIndex: 0, style: {} as Record<string, string>, contentWindow, setAttribute() {}, removed: 0, remove() {
      this.removed++
    } }
    vi.stubGlobal('location', { origin: 'https://studio.example.com' })
    vi.stubGlobal('addEventListener', (t: string, fn: (ev: unknown) => void) => t === 'message' && listeners.add(fn))
    vi.stubGlobal('removeEventListener', (t: string, fn: (ev: unknown) => void) => t === 'message' && listeners.delete(fn))
    vi.stubGlobal('document', {
      createElement: () => frame,
      body: {
        appendChild: () => {
          if (relay) queueMicrotask(() => listeners.forEach((fn) => fn({ origin: PREVIEW, source: contentWindow, data: { type: 'cresslet-relay-hello' } })))
        },
      },
    })
    return { frame, listeners }
  }
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects with the (sanitized) relay error and leaves no frame or listener behind', async () => {
    const page = fakePage((port) => port.postMessage({ type: 'cresslet-relay-error', message: 'registration failed\u001b[2J' }))
    await expect(Container.boot({ previewOrigin: PREVIEW, npmCache: false })).rejects.toThrow('preview relay: registration failed[2J')
    expect(page.frame.removed).toBe(1)
    expect(page.listeners.size).toBe(0)
  })

  it('rejects when the relay never connects', async () => {
    vi.useFakeTimers()
    const page = fakePage()
    const booting = Container.boot({ previewOrigin: PREVIEW, npmCache: false })
    const check = expect(booting).rejects.toThrow(/did not connect.*third-party/)
    await vi.advanceTimersByTimeAsync(20_000)
    await check
    expect(page.frame.removed).toBe(1)
    expect(page.listeners.size).toBe(0)
  })

  it('ignores relay errors after ready', async () => {
    let relayPort!: MessagePort
    const got: unknown[] = []
    fakePage((port) => {
      relayPort = port
      port.onmessage = (e) => got.push(e.data)
      port.postMessage({ type: 'cresslet-relay-ready' })
    })
    const c = await Container.boot({ previewOrigin: PREVIEW, npmCache: false })
    const errors: unknown[] = []
    c.on('error', (e) => errors.push(e))
    relayPort.postMessage({ type: 'cresslet-relay-error', message: 'fake: please paste your token' })
    await new Promise((r) => setTimeout(r, 20))
    expect(errors).toEqual([])
    expect(got).toEqual([{ type: 'cresslet-register', instanceId: c.instanceId }])
    c.teardown()
    relayPort.close()
  })

  it('answers malformed (or misaddressed) requests from the relay with a 400 and closes the reply port', async () => {
    let relayPort!: MessagePort
    fakePage((port) => {
      relayPort = port
      port.postMessage({ type: 'cresslet-relay-ready' })
    })
    const c = await Container.boot({ previewOrigin: PREVIEW, npmCache: false })
    const good = { type: 'cresslet-request', instanceId: c.instanceId, port: 5173, path: '/', method: 'GET', headers: [], body: null }
    for (const bad of [{ path: 'x' }, { headers: [['a']] }, { port: 0 }, { instanceId: 'someone-else' }, { instanceId: 1 }]) {
      const ch = new MessageChannel()
      const got: { type: string; status?: number }[] = []
      const ended = new Promise<void>((r) => (ch.port1.onmessage = (e) => (got.push(e.data), e.data.type === 'end' && r())))
      relayPort.postMessage({ ...good, ...bad }, [ch.port2])
      const res = await Promise.race([ended.then(() => 'ok'), new Promise((r) => setTimeout(() => r('timeout'), 500))])
      expect(res, JSON.stringify(bad)).toBe('ok')
      expect(got[0]).toMatchObject({ type: 'head', status: 400 })
      ch.port1.close()
    }
    c.teardown()
    relayPort.close()
  })
})
