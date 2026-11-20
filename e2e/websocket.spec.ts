import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; serverLogs: string[] }

// A preview's `new WebSocket()` reaches the app's server (a WebSocketPair app in a project worker, see
// fixtures/ws-app-worker.js) through the SW (and the relay with a previewOrigin), wired up the way a studio does it:
// dev server middleware → project worker → Container.upgradeWebSocket.
const HOST = 'http://localhost:4401'
// Playwright's Firefox can't drive cross-site frames of an isolated page (see xorigin.spec.ts): same-site there
const previewOrigin = (browserName: string) => (browserName === 'firefox' ? 'http://localhost:4402' : 'http://127.0.0.1:4402')

const APP = `
export default {
  async fetch(req) {
    const url = new URL(req.url)
    if (req.headers.get('upgrade') === 'websocket') {
      if (url.pathname !== '/ws' && url.pathname !== '/slow') return new Response('no socket here', { status: 404 })
      if (url.pathname === '/slow') {
        log('upgrading slowly')
        await new Promise((r) => setTimeout(r, 1500))
      }
      const [client, server] = Object.values(new WebSocketPair())
      server.accept()
      server.send('welcome ' + url.search)
      server.addEventListener('message', (e) => {
        if (e.data === 'bye') server.close(4000, 'bye yourself')
        else server.send(typeof e.data === 'string' ? 'echo ' + e.data : e.data)
      })
      server.addEventListener('close', (e) => log('server saw close ' + e.code + ' ' + e.reason))
      const offered = (req.headers.get('sec-websocket-protocol') ?? '').split(',').map((s) => s.trim())
      return new Response(null, { status: 101, webSocket: client, headers: offered.includes('chat') ? { 'sec-websocket-protocol': 'chat' } : {} })
    }
    return new Response('hello from the api')
  },
}
`

async function boot(page: Page, origin: string | undefined): Promise<Frame> {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${HOST}/demo/blank.html`)
  const url = await page.evaluate(
    async ({ origin, app }) => {
      const { Container } = await import('/dist/cresslet-container.js')
      const c = await Container.boot(origin ? { previewOrigin: origin } : {})
      const w = window as unknown as Win
      w.container = c
      w.serverLogs = []
      await c.fs.writeFile('index.html', '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>ws app</h1></body></html>')
      const worker = await c.projectWorker('/e2e/fixtures/ws-app-worker.js', { name: 'cresslet-server' })
      let id = 0
      const waiting = new Map<number, (m: { status: number; headers: [string, string][]; body: string | null; protocol?: string }) => void>()
      await new Promise<void>((resolve) => {
        worker.onmessage = ({ data: m }) => {
          if (m.type === 'ready') resolve()
          else if (m.type === 'log') w.serverLogs.push(m.msg)
          else if (m.type === 'response') waiting.get(m.id)?.(m)
        }
        worker.postMessage({ type: 'init', code: app })
      })
      const server = await c.createDevServer({
        port: 3000,
        middleware: async (req) => {
          const path = new URL(req.url).pathname
          if (!/^\/(ws|slow|api|nope)/.test(path)) return undefined
          const i = ++id
          const res = await new Promise<Parameters<typeof waiting extends Map<number, infer F> ? F : never>[0]>((resolve) => {
            waiting.set(i, resolve)
            worker.postMessage({ type: 'request', id: i, url: req.url, method: req.method, headers: [...req.headers] })
          })
          waiting.delete(i)
          if (res.status !== 101) return new Response(res.body, { status: res.status, headers: res.headers })
          let upgrade
          try {
            upgrade = c.upgradeWebSocket(req, { protocol: res.protocol })
          } catch (e) {
            worker.postMessage({ type: 'socket', id: i }) // e.g. the preview went away meanwhile
            throw e
          }
          const { socket, response } = upgrade
          worker.postMessage({ type: 'socket', id: i }, [socket])
          return response
        },
      })
      const f = document.createElement('iframe')
      f.id = 'frame'
      f.src = server.url
      document.body.append(f)
      return server.url
    },
    { origin, app: APP },
  )
  await expect(page.frameLocator('#frame').getByRole('heading', { name: 'ws app' })).toBeVisible()
  const frame = (await (await page.$('#frame'))!.contentFrame())!
  expect(await frame.evaluate(() => location.origin)).toBe(new URL(url).origin)
  expect(await frame.evaluate(() => location.pathname)).toBe('/') // prefix stripped: sockets below use app paths
  return frame
}

for (const mode of ['previewOrigin', 'same origin'] as const)
  test.describe.serial(`preview WebSockets (${mode})`, () => {
    let page: Page
    let frame: Frame
    test.beforeAll(async ({ browser, browserName }) => {
      page = await (await browser.newContext()).newPage()
      frame = await boot(page, mode === 'previewOrigin' ? previewOrigin(browserName) : undefined)
    })
    test.afterAll(() => page.context().close())

    test('text and binary round-trip, subprotocol, server close', async () => {
      const got = await frame.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const events: unknown[] = []
            const ws = new WebSocket(`ws://${location.host}/ws?room=1`, ['chat', 'other'])
            ws.binaryType = 'arraybuffer'
            const opened = { readyState: ws.readyState, url: ws.url, isWebSocket: ws instanceof WebSocket }
            ws.onerror = () => reject(new Error('socket error'))
            ws.onopen = () => {
              events.push({ open: ws.protocol, readyState: ws.readyState })
              ws.send('hi')
              ws.send(new Uint8Array([1, 2, 3]))
              ws.send(new Blob(['from a blob']))
              ws.send('bye')
            }
            ws.onmessage = (e) => events.push(typeof e.data === 'string' ? e.data : [...new Uint8Array(e.data)])
            ws.addEventListener('close', (e) => resolve({ opened, events, close: { code: e.code, reason: e.reason, wasClean: e.wasClean, readyState: ws.readyState } }))
          }),
      )
      expect(got).toEqual({
        opened: { readyState: 0, url: expect.stringMatching(/^ws:\/\/[^/]+\/ws\?room=1$/), isWebSocket: true },
        events: [{ open: 'chat', readyState: 1 }, 'welcome ?room=1', 'echo hi', [1, 2, 3], [...new TextEncoder().encode('from a blob')]], // a Blob is a binary frame
        close: { code: 4000, reason: 'bye yourself', wasClean: true, readyState: 3 },
      })
    })

    test('client close reaches the server; blobs by default; plain HTTP still works alongside', async () => {
      const got = await frame.evaluate(
        () =>
          new Promise((resolve) => {
            const ws = new WebSocket('/ws') // relative URLs resolve like the browser's
            let seen: Blob
            ws.onopen = () => ws.send(new Uint8Array([104, 105]))
            ws.onmessage = (e) => {
              if (typeof e.data === 'string') return // the welcome
              seen = e.data
              ws.close(1000, 'done here')
              closing = ws.readyState
            }
            let closing = -1
            ws.onclose = async (c) => resolve({ isBlob: seen instanceof Blob, text: await seen.text(), closing, code: c.code, api: await (await fetch('/api/x')).text() })
          }),
      )
      expect(got).toEqual({ isBlob: true, text: 'hi', closing: 2, code: 1000, api: 'hello from the api' })
      await expect.poll(() => page.evaluate(() => (window as unknown as Win).serverLogs)).toContain('server saw close 1000 done here')
    })

    test('a refused upgrade fails like a browser socket (error, then close 1006); other hosts use the real WebSocket', async () => {
      const got = await frame.evaluate(
        () =>
          new Promise((resolve) => {
            const events: string[] = []
            const ws = new WebSocket(`ws://${location.host}/nope`)
            ws.onopen = () => events.push('open')
            ws.onerror = () => events.push('error')
            ws.onclose = (e) => {
              let sendThrows = ''
              try {
                new WebSocket('/ws').send('too early')
              } catch (x) {
                sendThrows = (x as DOMException).name
              }
              const native = new WebSocket('ws://127.0.0.1:9/')
              const isNative = /\[native code\]/.test(String(Object.getPrototypeOf(native).constructor))
              native.onerror = () => {}
              native.close()
              resolve({ events, code: e.code, wasClean: e.wasClean, sendThrows, isNative, nativeIsWebSocket: native instanceof WebSocket })
            }
          }),
      )
      expect(got).toEqual({ events: ['error'], code: 1006, wasClean: false, sendThrows: 'InvalidStateError', isNative: true, nativeIsWebSocket: true })
    })

    test('browser-like edges: bad URLs and subprotocols throw, binary data is copied at send(), close() while connecting fails at once', async () => {
      const got = await frame.evaluate(async () => {
        const errors: string[] = []
        for (const [u, p] of [['/ws#x'], ['/ws#'], ['/ws', ['a b']], ['/ws', ['a', 'a']]] as [string, string[]?][])
          try {
            new WebSocket(u, p)
          } catch (e) {
            errors.push((e as DOMException).name)
          }
        const copied = await new Promise((resolve) => {
          const ws = new WebSocket('/ws')
          ws.binaryType = 'arraybuffer'
          const seen: number[][] = []
          ws.onopen = () => {
            const a = new Uint8Array([1])
            ws.send(new Blob(['x'])) // queues what follows behind the Blob read
            ws.send(a)
            a[0] = 2
            // an ArrayBuffer from another frame (realm) is still binary
            const f = document.body.appendChild(document.createElement('iframe'))
            ws.send(new (f.contentWindow as unknown as typeof globalThis).Uint8Array([7]).buffer)
            f.remove()
          }
          ws.onmessage = (e) => {
            if (typeof e.data !== 'string') seen.push([...new Uint8Array(e.data)])
            if (seen.length === 3) (ws.close(), resolve(seen))
          }
        })
        const early = await new Promise((resolve) => {
          const ws = new WebSocket('/ws')
          const events: unknown[] = []
          ws.onerror = () => events.push('error')
          ws.onclose = (e) => resolve([...events, e.code, ws.readyState])
          ws.close()
        })
        return { errors, copied, early }
      })
      expect(got).toEqual({ errors: ['SyntaxError', 'SyntaxError', 'SyntaxError', 'SyntaxError'], copied: [[120], [1], [7]], early: ['error', 1006, 3] })
      // the acceptance that arrived after close() was closed on the server end
      await expect.poll(() => page.evaluate(() => (window as unknown as Win).serverLogs)).toContain('server saw close 1001 ')
    })

    test('reloading the preview closes its sockets on the server end (1001)', async () => {
      await frame.evaluate(() => new Promise<void>((resolve) => (new WebSocket('/ws').onopen = () => resolve())))
      await page.evaluate(() => ((window as unknown as Win).serverLogs = []))
      await frame.evaluate(() => location.reload())
      // this one, and any an earlier test left open
      await expect.poll(() => page.evaluate(() => (window as unknown as Win).serverLogs)).toContain('server saw close 1001 ')
      expect(new Set(await page.evaluate(() => (window as unknown as Win).serverLogs))).toEqual(new Set(['server saw close 1001 ']))
      await expect(page.frameLocator('#frame').getByRole('heading', { name: 'ws app' })).toBeVisible()
    })

    test('reloading while an upgrade is still pending closes the socket the server accepts anyway (1001)', async () => {
      frame = (await (await page.$('#frame'))!.contentFrame())!
      await page.evaluate(() => ((window as unknown as Win).serverLogs = []))
      await frame.evaluate(() => void new WebSocket('/slow'))
      await expect.poll(() => page.evaluate(() => (window as unknown as Win).serverLogs)).toEqual(['upgrading slowly'])
      await frame.evaluate(() => location.reload()) // before the server accepts
      await expect.poll(() => page.evaluate(() => (window as unknown as Win).serverLogs)).toEqual(['upgrading slowly', 'server saw close 1001 '])
    })
  })
