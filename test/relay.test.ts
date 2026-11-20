import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container } from '../src/container'
import { PortTable } from '../src/ports'
import { acceptHello, acceptInit, expandOriginTemplate, isChannelName, isPageToSw, isProcSpawn, isSwToPage, isWorkerScript, newestWorker, originTemplateError, relayErrorText, relayUrl, toOrigin } from '../src/relay-protocol'
import { decodeResult, encodeResult, HEADER, STATE_DONE, STATE_GROW, SyncReplier } from '../src/node/protocol'
import { relayChannel } from '../src/node/channel'

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
    // a preview WebSocket also carries its socket's server end
    expect(isSwToPage({ type: 'cresslet-request', instanceId: 'a', websocket: true }, [port, port])).toBe(true)
    expect(isSwToPage({ type: 'cresslet-request', instanceId: 'a', websocket: true }, [port])).toBe(false)
    expect(isSwToPage({ type: 'cresslet-request', instanceId: 'a' }, [port, port])).toBe(false)
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

describe('relay: node processes', () => {
  it('spawns only with exactly one port, and takes only a string worker script', () => {
    expect(isProcSpawn({ type: 'cresslet-proc-spawn' }, [port])).toBe(true)
    expect(isProcSpawn({ type: 'cresslet-proc-spawn' }, [])).toBe(false)
    expect(isProcSpawn({ type: 'cresslet-proc-spawn' }, [port, port])).toBe(false)
    expect(isProcSpawn({ type: 'cresslet-register' }, [port])).toBe(false)
    expect(isWorkerScript({ type: 'cresslet-worker-script', source: 'x' })).toBe(true)
    expect(isWorkerScript({ type: 'cresslet-worker-script', source: 1 })).toBe(false)
    expect(isWorkerScript(null)).toBe(false)
  })

  it('SyncReplier writes small results in place and grows for big ones', () => {
    const r = new SyncReplier(new SharedArrayBuffer(HEADER + 16))
    const state = () => Atomics.load(new Int32Array(r.sab, 0, 2), 0)
    const read = () => decodeResult(new Uint8Array(r.sab, HEADER, Atomics.load(new Int32Array(r.sab, 0, 2), 1)).slice())
    r.write(encodeResult(true, 'hi'))
    expect(state()).toBe(STATE_DONE)
    expect(read()).toBe('hi')
    const big = encodeResult(true, 'x'.repeat(100))
    r.write(big)
    expect(state()).toBe(STATE_GROW)
    expect(Atomics.load(new Int32Array(r.sab, 0, 2), 1)).toBe(big.byteLength)
    r.grow(new SharedArrayBuffer(HEADER + big.byteLength))
    expect(state()).toBe(STATE_DONE)
    expect(read()).toBe('x'.repeat(100))
  })

  it('relayChannel ignores junk and sync-grow from the relay, and closes once', async () => {
    const { port1, port2 } = new MessageChannel()
    const onClose = vi.fn()
    const ch = relayChannel(port1, onClose)
    const got: unknown[] = []
    ch.onmessage = (m) => got.push(m)
    ch.onerror = (m) => got.push(`error: ${m}`)
    for (const m of [null, 1, { type: 2 }, { type: 'sync-grow', sab: null }, { type: 'stdout', data: 'ok' }, { type: 'worker-error', message: 'boom' }]) port2.postMessage(m)
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([{ type: 'stdout', data: 'ok' }, 'error: boom'])
    const sent: unknown[] = []
    port2.onmessage = (e) => sent.push(e.data)
    ch.reply(encodeResult(true, 1))
    ch.terminate()
    ch.terminate()
    ch.post({ type: 'stdin-end' })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent.map((m) => (m as { type: string }).type)).toEqual(['sync-result', 'terminate'])
    expect(onClose).toHaveBeenCalledTimes(1)
    port2.close()
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

  it('runs node workers in the relay: cross-origin-isolated frame, worker script sent once per connection', async () => {
    let relayPort!: MessagePort
    const got: { type: string; source?: string }[] = []
    const spawned: MessagePort[] = []
    const page = fakePage((port) => {
      relayPort = port
      port.onmessage = (e) => (got.push(e.data), e.ports[0] && spawned.push(e.ports[0]))
      port.postMessage({ type: 'cresslet-relay-ready' })
    })
    vi.stubGlobal('fetch', async () => new Response('/* node worker */'))
    const c = await Container.boot({ previewOrigin: PREVIEW, npmCache: false })
    expect((page.frame as { allow?: string }).allow).toBe('cross-origin-isolated')
    const a = await c.nodeChannel()
    const b = await c.nodeChannel()
    await new Promise((r) => setTimeout(r, 20))
    expect(got.map((m) => m.type)).toEqual(['cresslet-register', 'cresslet-worker-script', 'cresslet-proc-spawn', 'cresslet-proc-spawn'])
    expect(got[1].source).toBe('/* node worker */')
    expect(spawned).toHaveLength(2)
    a.terminate()
    b.terminate()
    c.teardown()
    relayPort.close()
    spawned.forEach((p) => p.close())
  })

  it('never runs workers on the host origin when previews (and so the relay) are disabled', async () => {
    vi.stubGlobal('fetch', async () => new Response('/* worker */'))
    const c = await Container.boot({ previewOrigin: PREVIEW, serviceWorkerUrl: false, npmCache: false })
    await expect(c.nodeChannel()).rejects.toThrow(/previews are disabled/)
    await expect(c.projectWorker('https://studio.example.com/w.js')).rejects.toThrow(/previews are disabled/)
    c.teardown()
  })

  it('a relay that reconnects after the deadline still runs later workers', async () => {
    const ports: MessagePort[] = []
    let registered: () => void
    const reRegistered = new Promise<void>((r) => (registered = r))
    const page = fakePage((port) => {
      ports.push(port)
      const n = ports.length
      port.onmessage = (e) => n === 2 && e.data?.type === 'cresslet-register' && registered()
      if (n === 1) port.postMessage({ type: 'cresslet-relay-ready' })
    })
    vi.stubGlobal('fetch', async () => new Response('/* node worker */'))
    const c = await Container.boot({ previewOrigin: PREVIEW, npmCache: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // the relay reloads and takes longer than the deadline to come back
    const hello = { origin: PREVIEW, source: page.frame.contentWindow, data: { type: 'cresslet-relay-hello' } }
    page.listeners.forEach((fn) => fn(hello))
    const late = c.nodeChannel()
    const lateResult = late.then(() => 'ok', (e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await lateResult).toMatch(/did not reconnect/)
    vi.useRealTimers()
    ports[1].postMessage({ type: 'cresslet-relay-ready' })
    await reRegistered
    const ch = await c.nodeChannel()
    ch.terminate()
    c.teardown()
    ports.forEach((p) => p.close())
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

describe('previewOrigins templates', () => {
  it('accepts origins with {id} and {port} in the host (or port)', () => {
    for (const t of ['https://{id}-{port}.preview.example.com', 'http://{id}-{port}.localhost:4402', 'https://{port}.{id}.preview.example/', 'https://p-{id}--x{port}.example'])
      expect(originTemplateError(t), t).toBeNull()
    expect(expandOriginTemplate('https://{id}-{port}.preview.example.com', 'abc123', 5173)).toBe('https://abc123-5173.preview.example.com')
    expect(relayUrl('https://a-0.p.example', HOST, { sw: false })).toBe(`https://a-0.p.example/cresslet-relay.html?host=${encodeURIComponent(HOST)}&sw=0`)
  })
  it('rejects templates that would share an origin, or are not bare origins', () => {
    for (const t of [
      'https://preview.example.com', // no placeholders
      'https://{id}.preview.example.com', // no {port}
      'https://{port}.preview.example.com', // no {id}
      'https://preview.example.com/{id}/{port}', // placeholders in the path: one origin
      'https://{id}.preview.example.com/?p={port}',
      'https://{id}.preview.example.com#{port}',
      'https://{port}:x@{id}.preview.example.com',
      'ftp://{id}-{port}.preview.example.com',
      'https://{id}-{port}.preview.example.com/x',
      'https://{id}{port}.preview.example.com', // abcdefg + 10 = abcdefg1 + 0
      'https://{id}x{port}.preview.example.com',
      'http://{id}.localhost:{port}', // the workers' origin would be on port 0
      'https://{id}-{port}-{port}.preview.example.com',
      'https://{id}-{port}.preview.example.com:99999',
      'https://{id}-{port}.pre view.example.com',
    ])
      expect(originTemplateError(t), t).not.toBeNull()
    expect(originTemplateError(5)).not.toBeNull()
  })
  it('PortTable gives each port its own origin', () => {
    const t = new PortTable('abc', { open() {}, close() {} }, (p) => `https://abc-${p}.preview.example`)
    expect(t.url(3000)).toBe('https://abc-3000.preview.example/__cresslet__/abc/3000/')
    expect(t.url(3001)).toBe('https://abc-3001.preview.example/__cresslet__/abc/3001/')
    expect(() => t.origin()).toThrow(/one origin per port/)
  })
})

describe('Container.boot({ previewOrigins })', () => {
  const TEMPLATE = 'https://{id}-{port}.preview.example.net'
  interface Frame {
    src: string
    allow?: string
    removed: number
    contentWindow: { postMessage(m: unknown, origin: string, transfer: MessagePort[]): void }
    remove(): void
    setAttribute(): void
    style: Record<string, string>
  }
  /** A fake page whose relay frames (one per origin) say hello; `relay(origin, port)` plays the relay. */
  function fakePage(relay: (origin: string, port: MessagePort, frame: Frame) => void) {
    const listeners = new Set<(ev: unknown) => void>()
    const frames: Frame[] = []
    vi.stubGlobal('location', { origin: HOST })
    vi.stubGlobal('addEventListener', (t: string, fn: (ev: unknown) => void) => t === 'message' && listeners.add(fn))
    vi.stubGlobal('removeEventListener', (t: string, fn: (ev: unknown) => void) => t === 'message' && listeners.delete(fn))
    vi.stubGlobal('document', {
      createElement: () => {
        const frame: Frame = {
          src: '',
          removed: 0,
          style: {},
          setAttribute() {},
          remove() {
            this.removed++
          },
          contentWindow: { postMessage: (_m, origin, transfer) => relay(origin, transfer[0], frame) },
        }
        frames.push(frame)
        return frame
      },
      body: {
        appendChild: (frame: Frame) =>
          queueMicrotask(() => listeners.forEach((fn) => fn({ origin: new URL(frame.src).origin, source: frame.contentWindow, data: { type: 'cresslet-relay-hello' } }))),
      },
    })
    return { frames, listeners }
  }
  afterEach(() => vi.unstubAllGlobals())
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

  it('rejects bad templates, and previewOrigin together with previewOrigins', async () => {
    await expect(Container.boot({ previewOrigins: 'https://preview.example.net/{id}/{port}', npmCache: false })).rejects.toThrow(/previewOrigins must be an http\(s\) origin|previewOrigins must put/)
    await expect(Container.boot({ previewOrigins: TEMPLATE, previewOrigin: 'https://p.example.net', npmCache: false })).rejects.toThrow(/not both/)
  })

  it('runs workers on the {port}=0 origin, frames one relay per preview port, and fires server-ready once it is up', async () => {
    const got = new Map<string, { type: string }[]>()
    const ports = new Map<string, MessagePort>()
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const page = fakePage((origin, port) => {
      ports.set(origin, port)
      got.set(origin, [])
      port.onmessage = (e) => got.get(origin)!.push(e.data)
      // the first preview relay takes a while (its service worker installs)
      if (origin.includes('-3000.')) void held.then(() => port.postMessage({ type: 'cresslet-relay-ready' }))
      else port.postMessage({ type: 'cresslet-relay-ready' })
    })
    vi.stubGlobal('fetch', async () => new Response('/* node worker */'))
    const c = await Container.boot({ previewOrigins: TEMPLATE, npmCache: false })
    const at = (p: number) => `https://${c.instanceId}-${p}.preview.example.net`
    expect(c.previewOrigins).toBe(TEMPLATE)
    expect(c.previewOrigin).toBeNull()
    expect(page.frames).toHaveLength(1)
    expect(page.frames[0].src).toBe(`${at(0)}/cresslet-relay.html?host=${encodeURIComponent(HOST)}&sw=0`)
    expect(page.frames[0].allow).toBe('cross-origin-isolated')
    const ch = await c.nodeChannel()
    await tick()
    // the workers relay runs workers, and no service worker: nothing is registered with it
    expect(got.get(at(0))!.map((m) => m.type)).toEqual(['cresslet-worker-script', 'cresslet-proc-spawn'])
    ch.terminate()

    const ready: [number, string][] = []
    c.on('server-ready', (p, url) => ready.push([p, url]))
    const a = c.servePort(3000, () => new Response('A'))
    const b = c.servePort(3001, () => new Response('B'))
    expect(a.url).toBe(`${at(3000)}/__cresslet__/${c.instanceId}/3000/`)
    await tick()
    expect(page.frames.map((f) => f.src.split('/cresslet-relay')[0])).toEqual([at(0), at(3000), at(3001)])
    expect(page.frames[1].allow).toBeUndefined()
    expect(ready).toEqual([[3001, b.url]]) // 3000's relay isn't up yet
    release()
    await tick()
    expect(ready).toEqual([[3001, b.url], [3000, a.url]])
    expect(got.get(at(3000))).toEqual([{ type: 'cresslet-register', instanceId: c.instanceId }])

    // dev server notifications go to that port's relay only
    c.previewChannel(`cresslet:${c.instanceId}:3001`).postMessage({ type: 'reload' })
    c.previewChannel(`cresslet:someone-else:3000`).postMessage({ type: 'reload' })
    await tick()
    expect(got.get(at(3001))!.at(-1)).toEqual({ type: 'cresslet-broadcast', channel: `cresslet:${c.instanceId}:3001`, message: { type: 'reload' } })
    expect(got.get(at(3000))!.map((m) => m.type)).toEqual(['cresslet-register'])

    // a preview's relay reaches its own port only
    const ask = async (relay: string, p: number) => {
      const r = new MessageChannel()
      const msgs: { type: string; status?: number; data?: Uint8Array }[] = []
      const ended = new Promise<void>((res) => (r.port1.onmessage = (e) => (msgs.push(e.data), e.data.type === 'end' && res())))
      ports.get(relay)!.postMessage({ type: 'cresslet-request', instanceId: c.instanceId, port: p, path: '/', method: 'GET', headers: [], body: null }, [r.port2])
      await ended
      r.port1.close()
      return [msgs[0].status, new TextDecoder().decode(msgs[1]?.data)]
    }
    expect(await ask(at(3000), 3000)).toEqual([200, 'A'])
    expect(await ask(at(3000), 3001)).toEqual([400, 'Cresslet: malformed preview request'])
    expect(await ask(at(3001), 3001)).toEqual([200, 'B'])

    const closed: number[] = []
    c.on('port', (p, ev) => ev === 'close' && closed.push(p))
    b.close()
    expect(closed).toEqual([3001])
    c.teardown()
    await tick()
    expect(got.get(at(3000))!.slice(-2)).toEqual([{ type: 'cresslet-unregister', instanceId: c.instanceId }, { type: 'cresslet-relay-dispose' }])
    expect(got.get(at(0))!.map((m) => m.type)).not.toContain('cresslet-relay-dispose')
    ports.forEach((p) => p.close())
  })

  it('announces only the latest opening of a port, once, and never port 0 (the workers origin)', async () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const page = fakePage((origin, port) => {
      if (origin.includes('-3000.')) void held.then(() => port.postMessage({ type: 'cresslet-relay-error', message: 'nope' }))
      else port.postMessage({ type: 'cresslet-relay-ready' })
    })
    const c = await Container.boot({ previewOrigins: TEMPLATE, npmCache: false })
    const events: unknown[] = []
    c.on('error', (e) => events.push(e))
    c.on('port', (p, ev) => events.push([p, ev]))
    c.servePort(0, () => new Response('x'))
    expect(events).toEqual([{ message: 'port 0: previews need a port from 1 to 65535' }])
    c.servePort(3000, () => new Response('A')).close()
    c.servePort(3000, () => new Response('A'))
    await tick()
    expect(page.frames).toHaveLength(2) // the workers relay and one for 3000, reused by the reopen
    release()
    await tick()
    expect(events.slice(1)).toEqual([{ message: 'port 3000: preview relay: nope' }])
    c.teardown()
  })

  it('torn down mid-setup: asks the relay to drop its service worker and waits for it before removing the frame', async () => {
    const got: unknown[] = []
    let relayPort!: MessagePort
    const page = fakePage((origin, port) => {
      if (origin.includes('-3000.')) {
        relayPort = port
        port.onmessage = (e) => got.push(e.data) // still registering: never ready
      } else port.postMessage({ type: 'cresslet-relay-ready' })
    })
    const c = await Container.boot({ previewOrigins: TEMPLATE, npmCache: false })
    c.servePort(3000, () => new Response('A'))
    await tick()
    c.teardown()
    await tick()
    expect(got).toEqual([{ type: 'cresslet-relay-dispose' }])
    expect(page.frames[1].removed).toBe(0)
    relayPort.postMessage({ type: 'cresslet-relay-disposed' })
    await tick()
    expect(page.frames[1].removed).toBe(1)
    relayPort.close()
  })

  it('reports a preview relay that fails, without server-ready, and retries on the next open', async () => {
    let fails = true
    fakePage((origin, port) => {
      if (origin.includes('-3000.') && fails) port.postMessage({ type: 'cresslet-relay-error', message: 'registration failed' })
      else port.postMessage({ type: 'cresslet-relay-ready' })
    })
    const c = await Container.boot({ previewOrigins: TEMPLATE, npmCache: false })
    const events: unknown[] = []
    c.on('error', (e) => events.push(e))
    c.on('server-ready', (p) => events.push(p))
    const s = c.servePort(3000, () => new Response('A'))
    await tick()
    expect(events).toEqual([{ message: 'port 3000: preview relay: registration failed' }])
    s.close()
    fails = false
    c.servePort(3000, () => new Response('A'))
    await tick()
    expect(events.at(-1)).toBe(3000)
    c.teardown()
  })
})
