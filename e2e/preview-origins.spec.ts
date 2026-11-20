import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; previewUrl?: string }

// One origin per preview (`boot({ previewOrigins })`): the host is http://localhost:4401 (playwright webServer), and
// scripts/serve.mjs's preview listener on port 4402 answers any host name, so http://<id>-<port>.localhost:4402 works
// (browsers resolve *.localhost to loopback). Each <id>-<port>.localhost is a site of its own (localhost isn't a
// registrable domain), so previews are cross-site to the host and to each other.
// As in xorigin.spec.ts: re-enable third-party storage partitioning, which Playwright turns off (real Chrome has it).
const PW_DISABLED_FEATURES = 'AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,AvoidCorsURLLoaderRestartOnRedirect,TcpPortRandomizationWin,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,PreconnectToSearch,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion'
test.use({
  launchOptions: async ({ browserName, launchOptions }, use) =>
    use(
      browserName === 'chromium'
        ? {
            ...launchOptions,
            ignoreDefaultArgs: [`--disable-features=${PW_DISABLED_FEATURES}`],
            args: [`--disable-features=${PW_DISABLED_FEATURES.replace('ThirdPartyStoragePartitioning,', '')}`],
          }
        : launchOptions,
    ),
})
test.skip(({ browserName }) => browserName !== 'chromium', 'per-preview origins on *.localhost: Chromium is the supported target')

const HOST = 'http://localhost:4401'
const TEMPLATE = 'http://{id}-{port}.localhost:4402'
const SHARED = 'http://localhost:4402'

const page = (title: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>`

/** Boot a container on a blank host page, serve two plain previews on ports 3000 / 3001 and frame them as #a / #b. */
async function twoPreviews(p: Page, opts: { previewOrigins?: string; previewOrigin?: string }) {
  p.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await p.goto(`${HOST}/demo/blank.html`)
  const urls = await p.evaluate(
    async ([opts, a, b]) => {
      const { Container } = await import('/dist/cresslet-container.js')
      const c = await Container.boot(opts)
      ;(window as unknown as Win).container = c
      const ready = new Map<number, string>()
      const both = new Promise<void>((resolve) =>
        c.on('server-ready', (port: number, url: string) => (ready.set(port, url), ready.size === 2 && resolve())),
      )
      // each port also echoes WebSockets (as `<port>: <message>`) and logs the upgrades it gets
      const upgrades: number[] = ((window as unknown as { upgrades: number[] }).upgrades = [])
      const handler = (port: number, html: string) => (req: Request) => {
        if (req.headers.get('upgrade') !== 'websocket') return new Response(html, { headers: { 'content-type': 'text/html' } })
        upgrades.push(port)
        const { socket, response } = c.upgradeWebSocket(req)
        socket.onmessage = (e: MessageEvent) => e.data?.type === 'message' && socket.postMessage({ type: 'message', data: `${port}: ${e.data.data}` })
        return response
      }
      c.servePort(3000, handler(3000, a))
      c.servePort(3001, handler(3001, b))
      await both
      const load = (name: string, src: string) =>
        new Promise((resolve) => {
          const f = document.createElement('iframe')
          f.name = name
          f.src = src
          f.onload = resolve
          document.body.appendChild(f)
        })
      await Promise.all([load('a', ready.get(3000)!), load('b', ready.get(3001)!)])
      return { id: c.instanceId, a: ready.get(3000)!, b: ready.get(3001)! }
    },
    [opts, page('preview A'), page('preview B')] as const,
  )
  const a = p.frame({ name: 'a' })!
  const b = p.frame({ name: 'b' })!
  await expect(a.locator('h1')).toHaveText('preview A')
  await expect(b.locator('h1')).toHaveText('preview B')
  return { ...urls, frameA: a, frameB: b }
}

/** What frame `f` can script of its parent's frames: the URLs of the ones it can, and how many it can't. */
const reach = (f: Frame) =>
  f.evaluate(() => {
    const scriptable: string[] = []
    let blocked = 0
    for (let i = 0; i < parent.frames.length; i++) {
      try {
        scriptable.push(parent.frames[i].document.location.href.split('?')[0])
      } catch (e) {
        if ((e as Error).name !== 'SecurityError') throw e
        blocked++
      }
    }
    return { scriptable, blocked }
  })

test.describe.serial('per-preview origins', () => {
  let p: Page
  let id: string
  let a: Frame
  let b: Frame
  let urls: { a: string; b: string }
  const origin = (port: number) => `http://${id}-${port}.localhost:4402`

  test.beforeAll(async ({ browser }) => {
    p = await (await browser.newContext()).newPage()
    ;({ id, frameA: a, frameB: b, ...urls } = await twoPreviews(p, { previewOrigins: TEMPLATE }))
  })

  test('each preview is served from its own origin', async () => {
    expect(await p.evaluate(() => crossOriginIsolated)).toBe(true)
    expect(urls.a).toBe(`${origin(3000)}/__cresslet__/${id}/3000/`)
    expect(urls.b).toBe(`${origin(3001)}/__cresslet__/${id}/3001/`)
    expect(await a.evaluate(() => location.origin)).toBe(origin(3000))
    expect(await b.evaluate(() => location.origin)).toBe(origin(3001))
    expect(await p.evaluate(() => (window as unknown as Win).container.previewOrigins)).toBe(TEMPLATE)
  })

  test("previews can't read each other's storage", async () => {
    await a.evaluate(async () => {
      localStorage.setItem('secret', 'from A')
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('a-secrets', 1)
        req.onupgradeneeded = () => req.result.createObjectStore('kv')
        req.onsuccess = () => (req.result.close(), resolve())
        req.onerror = () => reject(req.error)
      })
      await (await caches.open('a-cache')).put('/secret', new Response('from A'))
    })
    expect(await a.evaluate(() => localStorage.getItem('secret'))).toBe('from A')
    const seen = await b.evaluate(async () => ({
      ls: localStorage.getItem('secret'),
      dbs: (await indexedDB.databases()).map((d) => d.name),
      caches: await caches.keys(),
    }))
    expect(seen.ls).toBeNull()
    expect(seen.dbs).not.toContain('a-secrets')
    expect(seen.caches).not.toContain('a-cache')
  })

  test("a preview can script only its own relay: not the other preview, its relay, or the workers' relay", async () => {
    // the host frames the workers relay ({port} 0), one relay per preview port, and the two previews
    expect(p.frames().map((f) => f.url().split('?')[0]).filter((u) => u.endsWith('/cresslet-relay.html')).sort()).toEqual(
      [0, 3000, 3001].map((port) => `${origin(port)}/cresslet-relay.html`),
    )
    expect(await reach(a)).toEqual({ scriptable: [`${origin(3000)}/cresslet-relay.html`, `${origin(3000)}/`], blocked: 3 })
    expect(await reach(b)).toEqual({ scriptable: [`${origin(3001)}/cresslet-relay.html`, `${origin(3001)}/`], blocked: 3 })
  })

  test("a preview's own relay and service worker won't reach another port (requests and WebSockets)", async () => {
    const got = await a.evaluate(async (id) => {
      // through this origin's service worker and relay (which the preview can script): refused by the container
      const viaRelay = await fetch(`/__cresslet__/${id}/3001/`)
      const own = await fetch(`/__cresslet__/${id}/3000/`)
      const socket = (path: string) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`ws://${location.host}${path}`)
          ws.onopen = () => ws.send('hi')
          ws.onmessage = (e) => (resolve(`message ${e.data}`), ws.close())
          ws.onclose = (e) => resolve(`closed ${e.code}`)
        })
      return {
        viaRelay: [viaRelay.status, await viaRelay.text()],
        own: [own.status, await own.text()],
        ownSocket: await socket('/live'),
        otherSocket: await socket(`/__cresslet__/${id}/3001/live`),
      }
    }, id)
    expect(got.viaRelay).toEqual([400, 'Cresslet: malformed preview request'])
    expect(got.own[0]).toBe(200)
    expect(got.own[1]).toContain('preview A')
    expect(got.ownSocket).toBe('message 3000: hi')
    expect(got.otherSocket).toMatch(/^closed /)
    // port 3001's handler never saw A's socket
    expect(await p.evaluate(() => (window as unknown as { upgrades: number[] }).upgrades)).toEqual([3000])
  })

  test('node runs on the workers origin, which no preview shares', async () => {
    const out = await p.evaluate(async () => {
      const proc = await (window as unknown as Win).container.spawn('node', ['-e', 'console.log(self.location.origin)'])
      let s = ''
      const piped = proc.output.pipeTo(new WritableStream({ write: (d) => void (s += d) }))
      await proc.exit
      await piped.catch(() => {})
      return s.trim()
    })
    expect(out).toBe(origin(0))
  })
})

test('for contrast: with one previewOrigin, previews share storage and can script each other', async ({ browser }) => {
  const p = await (await browser.newContext()).newPage()
  const { frameA: a, frameB: b } = await twoPreviews(p, { previewOrigin: SHARED })
  expect(await a.evaluate(() => location.origin)).toBe(SHARED)
  await a.evaluate(() => localStorage.setItem('secret', 'from A'))
  expect(await b.evaluate(() => localStorage.getItem('secret'))).toBe('from A')
  expect((await reach(a)).blocked).toBe(0)
})

test('the dev server (HMR, live updates) works on a per-preview origin', async ({ browser }) => {
  const p = await (await browser.newContext()).newPage()
  p.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await p.goto(`${HOST}/?previewOrigins=${encodeURIComponent(TEMPLATE)}`)
  const f = p.frameLocator('#frame')
  await expect(f.getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible({ timeout: 120_000 })
  const { id, url } = await p.evaluate(() => ({ id: (window as unknown as Win).container.instanceId, url: (window as unknown as Win).previewUrl! }))
  expect(url).toBe(`http://${id}-5173.localhost:4402/__cresslet__/${id}/5173/`)
  await f.getByRole('button', { name: 'count is 0' }).click()
  await expect(f.getByRole('button', { name: 'count is 1' })).toBeVisible()
  const app = await p.evaluate(() => (window as unknown as Win).container.fs.readFile('src/App.tsx', 'utf8'))
  await p.evaluate((s) => (window as unknown as Win).container.fs.writeFile('src/App.tsx', s), app.replace('Hello from Cresslet', 'Hot per-preview'))
  await expect(f.getByRole('heading', { name: 'Hot per-preview' })).toBeVisible()
  // fast refresh kept the state: the update came over this preview's own relay
  await expect(f.getByRole('button', { name: 'count is 1' })).toBeVisible()
})
