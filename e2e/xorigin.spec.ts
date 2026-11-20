import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; previewUrl?: string; __marker?: number }

// Previews on a separate origin (`boot({ previewOrigin })`): the demo host is http://localhost:4401 (playwright
// webServer), scripts/serve.mjs serves the preview origin on port 4402. 127.0.0.1 is cross-site to localhost; for the
// top-level tab test the preview origin must be same-site with the host (see README), so it uses localhost:4402.
// Playwright launches Chromium with third-party storage partitioning disabled (microsoft/playwright#32230); real Chrome
// partitions, so re-enable it here. `storage is partitioned` below fails if Playwright's flags change and this stops working.
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

const HOST = 'http://localhost:4401'
const CROSS_SITE = 'http://127.0.0.1:4402'
const SAME_SITE = 'http://localhost:4402'
/**
 * Playwright's Firefox can't attach to cross-site iframes of a cross-origin-isolated page (they show up with an empty
 * URL), so its frame-driven tests use the same-site preview origin; `cross-site previews render ...` covers Firefox
 * cross-site through postMessage instead.
 */
const drivable = (browserName: string) => (browserName === 'firefox' ? SAME_SITE : CROSS_SITE)

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

async function bootDemo(page: Page, previewOrigin: string) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  // what the preview must not see
  await page.goto(`${HOST}/demo/blank.html`)
  await page.evaluate(() => {
    localStorage.setItem('cresslet-secret', 'host-token')
    document.cookie = 'cresslet_secret=host-cookie; path=/'
  })
  await page.goto(`${HOST}/?previewOrigin=${encodeURIComponent(previewOrigin)}`)
  await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible({ timeout: 120_000 })
  return (await (await page.$('#frame'))!.contentFrame())!
}

test('storage is partitioned (as in real browsers)', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', "checks the Chromium flag override above (Playwright's WebKit doesn't partition localStorage)")
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${HOST}/demo/blank.html`)
  await page.evaluate(
    (src) =>
      new Promise((resolve) => {
        const f = document.createElement('iframe')
        f.name = 'embedded'
        f.src = src
        f.onload = resolve
        document.body.appendChild(f)
      }),
    `${CROSS_SITE}/blank.html`,
  )
  await page.frame({ name: 'embedded' })!.evaluate(() => localStorage.setItem('cresslet-partition', 'third-party'))
  const top = await ctx.newPage()
  await top.goto(`${CROSS_SITE}/blank.html`)
  expect(await top.evaluate(() => localStorage.getItem('cresslet-partition'))).toBeNull()
})

test('cross-site previews render and see none of the host storage (reported via postMessage)', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.addInitScript(() => {
    const w = window as unknown as { __reports: unknown[] }
    w.__reports = []
    addEventListener('message', (e) => e.data?.cresslet_report && w.__reports.push({ origin: e.origin, ...e.data.cresslet_report }))
  })
  await page.goto(`${HOST}/demo/blank.html`)
  await page.evaluate(() => {
    localStorage.setItem('cresslet-secret', 'host-token')
    document.cookie = 'cresslet_secret=host-cookie; path=/'
  })
  await page.goto(`${HOST}/?previewOrigin=${encodeURIComponent(CROSS_SITE)}`)
  await page.waitForFunction(() => (window as unknown as Win).previewUrl, null, { timeout: 120_000 })
  await write(
    page,
    'src/App.tsx',
    `export default function App() {\n  parent.postMessage({ cresslet_report: { origin: location.origin, ls: localStorage.getItem('cresslet-secret'), cookie: document.cookie } }, '*')\n  return <h1>report</h1>\n}\n`,
  )
  await expect.poll(() => page.evaluate(() => (window as unknown as { __reports: unknown[] }).__reports[0])).toEqual({ origin: CROSS_SITE, ls: null, cookie: '' })
})

test.describe.serial('cross-origin previews', () => {
  let page: Page
  let frame: Frame
  let origin: string
  const marked = () => frame.evaluate(() => (window as unknown as Win).__marker === 1)

  test.beforeAll(async ({ browser, browserName }) => {
    origin = drivable(browserName)
    page = await (await browser.newContext()).newPage()
    frame = await bootDemo(page, origin)
  })

  test('a React preview renders from the preview origin', async () => {
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
    expect((await page.evaluate(() => (window as unknown as Win).previewUrl))!.startsWith(`${origin}/__cresslet__/`)).toBe(true)
    expect(await frame.evaluate(() => location.origin)).toBe(origin)
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('heading')).toHaveCSS('color', 'rgb(31, 136, 61)')
    await f.getByRole('button', { name: 'count is 0' }).click()
    await f.getByRole('button', { name: 'count is 1' }).click()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
  })

  test("the preview can't read the host's storage", async () => {
    expect(await page.evaluate(() => localStorage.getItem('cresslet-secret'))).toBe('host-token')
    const seen = await frame.evaluate(() => {
      let parentStorage: string
      try {
        parentStorage = String((parent as Window).localStorage.getItem('cresslet-secret'))
      } catch (e) {
        parentStorage = `blocked: ${(e as Error).name}`
      }
      return { own: localStorage.getItem('cresslet-secret'), parentStorage, cookie: document.cookie }
    })
    expect(seen.own).toBeNull()
    expect(seen.parentStorage).toMatch(/^blocked/)
    // cookies ignore ports: only a different host keeps them apart
    if (new URL(origin).hostname !== new URL(HOST).hostname) expect(seen.cookie).not.toContain('host-cookie')
  })

  test('CSS edit hot-swaps cross-origin', async () => {
    const h1 = page.frameLocator('#frame').getByRole('heading')
    const css = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/index.css', 'utf8'))
    await write(page, 'src/index.css', css.replace('#1f883d', 'rgb(200, 0, 0)'))
    await expect(h1).toHaveCSS('color', 'rgb(200, 0, 0)')
    expect(await marked()).toBe(true)
  })

  test('component edit is fast-refreshed cross-origin and keeps state', async () => {
    const f = page.frameLocator('#frame')
    const app = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/App.tsx', 'utf8'))
    await write(page, 'src/App.tsx', app.replace('Hello from Cresslet', 'Hot cross-origin'))
    await expect(f.getByRole('heading', { name: 'Hot cross-origin' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('errors reach the overlay and a full reload works cross-origin', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', 'export default function App() { return <h1>broken</h2> }\n')
    await expect(f.locator('cresslet-error-overlay pre')).toContainText('App.tsx')
    const main = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/main.tsx', 'utf8'))
    await write(page, 'src/App.tsx', 'export default function App() { return <h1>Reloaded</h1> }\n')
    await write(page, 'src/main.tsx', main + '\n// touched\n')
    await expect(f.getByRole('heading', { name: 'Reloaded' })).toBeVisible()
    await expect.poll(marked).toBe(false)
  })
})

test('the relay ignores an init from another origin', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${HOST}/demo/blank.html`)
  // host frames the relay (as the container does) and an unrelated other-origin page next to it
  await page.evaluate(
    ([relay, other]) =>
      Promise.all(
        [relay, other].map(
          (src, i) =>
            new Promise((resolve) => {
              const f = document.createElement('iframe')
              f.name = i ? 'other' : 'relay'
              f.src = src
              f.onload = resolve
              document.body.appendChild(f)
            }),
        ),
      ),
    [`${CROSS_SITE}/cresslet-relay.html?host=${encodeURIComponent(HOST)}`, `${SAME_SITE}/blank.html`] as const,
  )
  const other = page.frame({ name: 'other' })!
  expect(await other.evaluate(() => location.origin)).toBe(SAME_SITE)
  // the other-origin sibling sends a well-formed init: no answer
  const hijacked = await other.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const ch = new MessageChannel()
        ch.port1.onmessage = (e) => resolve(e.data)
        ;(parent as Window).frames[0].postMessage({ type: 'cresslet-relay-init' }, '*', [ch.port2])
        setTimeout(() => resolve('no answer'), 3000)
      }),
  )
  expect(hijacked).toBe('no answer')
  // the host's own init is still accepted
  const own = await page.evaluate(
    (origin) =>
      new Promise<unknown>((resolve) => {
        const ch = new MessageChannel()
        ch.port1.onmessage = (e) => resolve(e.data)
        window.frames[0].postMessage({ type: 'cresslet-relay-init' }, origin, [ch.port2])
        setTimeout(() => resolve('no answer'), 15_000)
      }),
    CROSS_SITE,
  )
  expect(own).toEqual({ type: 'cresslet-relay-ready' })
})

test('a preview opened top-level in a new tab keeps working while the host is open', async ({ browser, browserName }) => {
  // WebKit keys service worker registrations (and BroadcastChannel) by top-level origin, so a top-level tab never shares
  // the relay's service worker; Chromium and Firefox partition by site, hence the same-site preview origin.
  test.skip(browserName === 'webkit', 'WebKit partitions service workers by top-level origin')
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await bootDemo(page, SAME_SITE)
  const url = await page.evaluate(() => (window as unknown as Win).previewUrl!)
  expect(url.startsWith(`${SAME_SITE}/__cresslet__/`)).toBe(true)
  const tab = await ctx.newPage()
  await tab.goto(url)
  await expect(tab.getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible()
  expect(await tab.evaluate(() => localStorage.getItem('cresslet-secret'))).toBeNull()
  // live updates reach the tab too (BroadcastChannel on the preview origin)
  const app = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/App.tsx', 'utf8'))
  await write(page, 'src/App.tsx', app.replace('Hello from Cresslet', 'Edited in host'))
  await expect(tab.getByRole('heading', { name: 'Edited in host' })).toBeVisible()
})

test.describe.serial('preview origin trust boundary', () => {
  let page: Page
  let frame: Frame

  test.beforeAll(async ({ browser, browserName }) => {
    page = await (await browser.newContext()).newPage()
    frame = await bootDemo(page, drivable(browserName))
  })

  test('relay assets always come from the network, never from a preview', async () => {
    // the preview frame is a mapped client: without the reservation its root-relative fetches go to the dev server
    const got = await frame.evaluate(() =>
      Promise.all(
        ['/cresslet-relay.html', '/cresslet-relay.js', '/cresslet-sw.js'].map(async (p) => {
          const r = await fetch(p)
          return { p, csp: r.headers.get('content-security-policy'), type: r.headers.get('content-type') ?? '' }
        }),
      ),
    )
    expect(got[0].csp).toContain('frame-ancestors')
    expect(got[0].type).toContain('text/html')
    expect(got[1].type).toContain('javascript')
    expect(got[2].type).toContain('javascript')
  })

  test("a preview can't claim or drop its container's service worker mapping", async () => {
    const { id, url } = await page.evaluate(() => ({ id: (window as unknown as Win).container.instanceId, url: (window as unknown as Win).previewUrl! }))
    const body = await frame.evaluate(
      async ({ id, url }) => {
        const sw = navigator.serviceWorker
        // answer as if this preview window owned the container
        sw.addEventListener('message', (e) => {
          const d = e.data
          if (d?.type === 'cresslet-who') e.ports[0]?.postMessage({ owns: true })
          else if (d?.type === 'cresslet-request') {
            const p = e.ports[0]
            p.postMessage({ type: 'head', status: 200, statusText: 'OK', headers: [['content-type', 'text/plain']] })
            p.postMessage({ type: 'chunk', data: new TextEncoder().encode('hijacked') })
            p.postMessage({ type: 'end' })
          }
        })
        sw.startMessages()
        sw.controller!.postMessage({ type: 'cresslet-unregister', instanceId: id })
        sw.controller!.postMessage({ type: 'cresslet-register', instanceId: id })
        await new Promise((r) => setTimeout(r, 300))
        return (await fetch(url)).text()
      },
      { id, url },
    )
    expect(body).not.toBe('hijacked')
    expect(body).toContain('<')
    await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible()
  })
})

// ---------------- node on the preview origin ----------------
// A studio keeps its projects in IndexedDB on the host origin. Project server code (`node`, npm bins, the CSS worker)
// must not be able to read it: with `previewOrigin`, node workers run in the relay, on the preview origin.

/** Boot a bare container on a blank host page that keeps a "studio" database and cache with a secret in them. */
async function bootBlank(page: Page, previewOrigin?: string) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto(`${HOST}/demo/blank.html`)
  await page.evaluate(async (previewOrigin) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('studio', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('files')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const tx = req.result.transaction('files', 'readwrite')
        tx.objectStore('files').put('API_KEY=host-secret', '.env.cresslet')
        tx.oncomplete = () => (req.result.close(), resolve())
      }
    })
    await (await caches.open('studio-cache')).put('/secret', new Response('host-secret'))
    const { Container } = await import('/dist/cresslet-container.js')
    ;(window as unknown as Win).container = await Container.boot(previewOrigin ? { previewOrigin } : {})
  }, previewOrigin)
}

/** Run a shell command line in the page's container; returns exit code + merged output. */
const sh = (page: Page, line: string) =>
  page.evaluate(async (line) => {
    const p = await (window as unknown as Win).container.spawn('jsh', ['-c', line])
    let out = ''
    const piped = p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    await piped.catch(() => {})
    return { code, out }
  }, line)

/** What project code can see of the studio's storage (module: `module.exports = probe`). */
const PROBE = `module.exports = async function probe() {
  const keepAlive = setInterval(() => {}, 1000) // IndexedDB requests don't hold a node process open
  const idb = await new Promise((resolve) => {
    const req = indexedDB.open('studio')
    req.onerror = () => resolve({ error: String(req.error) })
    req.onsuccess = () => {
      const db = req.result
      const stores = [...db.objectStoreNames]
      if (!stores.includes('files')) return db.close(), resolve({ stores })
      const get = db.transaction('files').objectStore('files').get('.env.cresslet')
      get.onsuccess = () => (db.close(), resolve({ stores, env: get.result }))
    }
  })
  const cache = (await caches.has('studio-cache')) ? await (await (await caches.open('studio-cache')).match(origin + '/secret'))?.text() : null
  clearInterval(keepAlive)
  return { origin: globalThis.origin, isolated: crossOriginIsolated, idb, cache }
}
`

const NODE_SCRIPT = `const fs = require('fs')
const probe = require('./probe')
fs.writeFileSync('/tmp/big.bin', Buffer.alloc(6 * 1024 * 1024, 7)) // bigger than the default sync buffer
const big = fs.readFileSync('/tmp/big.bin')
probe().then((r) => console.log(JSON.stringify({ ...r, sync: fs.readFileSync('probe.js', 'utf8').length > 0, big: big.length, last: big[big.length - 1] })))
`

const lastJson = (out: string) => {
  try {
    return JSON.parse(out.trim().split('\n').pop()!)
  } catch {
    throw new Error(`no JSON in: ${out}`)
  }
}

test('without previewOrigin, node can read the host IndexedDB and Cache Storage (the gap this closes)', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await bootBlank(page)
  await write(page, 'probe.js', PROBE)
  await write(page, 'main.js', NODE_SCRIPT)
  const r = await sh(page, 'node main.js')
  expect(r.code, r.out).toBe(0)
  expect(lastJson(r.out)).toMatchObject({ origin: HOST, idb: { stores: ['files'], env: 'API_KEY=host-secret' }, cache: 'host-secret' })
})

test.describe.serial('node on the preview origin', () => {
  let page: Page
  let origin: string

  test.beforeAll(async ({ browser, browserName }) => {
    origin = drivable(browserName)
    page = await (await browser.newContext()).newPage()
    await bootBlank(page, origin)
    await write(page, 'probe.js', PROBE)
  })

  test("a node script runs on the preview origin, with sync fs, and can't read the host's storage", async () => {
    await write(page, 'main.js', NODE_SCRIPT)
    const r = await sh(page, 'node main.js')
    expect(r.code, r.out).toBe(0)
    expect(lastJson(r.out)).toEqual({ origin, isolated: true, idb: { stores: [] }, cache: null, sync: true, big: 6 * 1024 * 1024, last: 7 })
    // the host still has it
    expect(await page.evaluate(async () => (await (await caches.match('/secret'))?.text()) ?? null)).toBe('host-secret')
  })

  test('node -e, TypeScript, stdin and exit codes work through the relay', async () => {
    expect(await sh(page, `node -e "console.log(require('path').join('a', 'b'), origin)"`)).toEqual({ code: 0, out: `a/b ${origin}\n` })
    await write(page, 'add.ts', 'const add = (a: number, b: number): number => a + b\nconsole.log(add(2, 3))\nprocess.exit(3)\n')
    expect(await sh(page, 'node add.ts')).toEqual({ code: 3, out: '5\n' })
    await write(page, 'up.js', "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()))\n")
    expect(await sh(page, 'echo hello | node up.js')).toEqual({ code: 0, out: 'HELLO\n' })
  })

  test('a node http server answers preview requests, from the preview origin', async () => {
    await write(
      page,
      'server.js',
      `const http = require('http')\nconst probe = require('./probe')\nhttp.createServer(async (req, res) => {\n  res.setHeader('content-type', 'text/html')\n  res.end('<pre id=out>' + JSON.stringify({ url: req.url, server: await probe() }) + '</pre>')\n}).listen(3000)\n`,
    )
    const url = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const c = (window as unknown as Win).container
          const off = c.on('server-ready', (port, url) => port === 3000 && (off(), resolve(url)))
          void c.spawn('node', ['server.js'])
        }),
    )
    expect(url.startsWith(`${origin}/__cresslet__/`)).toBe(true)
    await page.evaluate((src) => {
      const f = document.createElement('iframe')
      f.name = 'srv'
      f.src = src
      document.body.append(f)
    }, `${url}api/hello?x=1`)
    const text = () => page.frame({ name: 'srv' })?.evaluate(() => document.getElementById('out')?.textContent ?? '').catch(() => '') ?? ''
    await expect.poll(text, { timeout: 30_000 }).not.toBe('')
    expect(JSON.parse(await text())).toEqual({ url: '/api/hello?x=1', server: { origin, isolated: true, idb: { stores: [] }, cache: null } })
  })

  test('reloading the relay ends the node processes it ran', async () => {
    await write(page, 'forever.js', 'setInterval(() => {}, 1000)\n')
    const exited = await page.evaluate(async () => {
      const p = await (window as unknown as Win).container.spawn('node', ['forever.js'])
      let out = ''
      void p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
      await new Promise((r) => setTimeout(r, 500))
      const relay = document.querySelector<HTMLIFrameElement>('iframe[title="cresslet preview relay"]')!
      relay.src = relay.src
      const code = await Promise.race([p.exit, new Promise((r) => setTimeout(() => r('still running'), 20_000))])
      return { code, out }
    })
    expect(exited).toEqual({ code: 1, out: 'node: worker error: preview relay restarted\n' })
    // and new ones run in the reconnected relay
    expect(await sh(page, 'node -e "console.log(origin)"')).toEqual({ code: 0, out: `${origin}\n` })
  })
})

test('the CSS worker (Tailwind v4 + a PostCSS plugin) runs on the preview origin and the preview gets its styles', async ({ browser, browserName }) => {
  const origin = drivable(browserName)
  const page = await (await browser.newContext()).newPage()
  await bootBlank(page, origin)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'tw', private: true, type: 'module', dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, devDependencies: { tailwindcss: '^4.1.0', postcss: '^8.5.0' } }),
    // a project plugin that writes down where it ran
    'postcss.config.js': "export default { plugins: [{ postcssPlugin: 'where', Once(root, { Rule, Declaration }) { root.append(new Rule({ selector: 'h1::after' }).append(new Declaration({ prop: 'content', value: JSON.stringify(String(globalThis.origin)) }))) } }] }\n",
    'index.html': '<!doctype html>\n<html><head><meta charset="utf-8" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport './index.css'\n\ncreateRoot(document.getElementById('root')!).render(<h1 className=\"text-brand\">Tailwind</h1>)\n",
    'src/index.css': '@import "tailwindcss";\n\n@theme {\n  --color-brand: rgb(10, 120, 30);\n}\n',
  }
  for (const [p, s] of Object.entries(files)) await write(page, p, s)
  const r = await sh(page, 'npm install')
  expect(r.code, r.out).toBe(0)
  await page.evaluate(async () => {
    const server = await (window as unknown as Win).container.createDevServer()
    const f = document.createElement('iframe')
    f.id = 'frame'
    f.src = server.url
    document.body.append(f)
  })
  const h1 = page.frameLocator('#frame').getByRole('heading', { name: 'Tailwind' })
  await expect(h1).toHaveCSS('color', 'rgb(10, 120, 30)')
  expect(await h1.evaluate((el) => getComputedStyle(el, '::after').content)).toBe(JSON.stringify(origin))
})

for (const mode of ['previewOrigin', 'same origin'] as const)
  test(`a project worker (Container.projectWorker) runs on the ${mode === 'previewOrigin' ? 'preview origin' : "page's origin without previewOrigin"}`, async ({ browser }) => {
    const page = await (await browser.newContext()).newPage()
    await bootBlank(page, mode === 'previewOrigin' ? CROSS_SITE : undefined)
    const got = await page.evaluate(async () => {
      const w = await (window as unknown as Win).container.projectWorker('/e2e/fixtures/project-worker.js', { name: 'server' })
      const reply = await new Promise((resolve, reject) => {
        w.onmessage = (e) => resolve(e.data)
        w.onerror = (e) => reject(new Error(e.message))
        const body = new Uint8Array(1000).buffer
        w.postMessage({ code: 'export default (n) => n * 2', n: 21, body }, [body])
      })
      // MessagePorts pass through both ways
      const ports = await new Promise((resolve) => {
        const ch = new MessageChannel()
        ch.port1.onmessage = (e) => {
          e.data.back.postMessage('hi back')
          w.onmessage = (e2) => resolve({ pong: e.data.pong, ...e2.data })
        }
        w.postMessage({ type: 'port', port: ch.port2 }, [ch.port2])
      })
      const error = await new Promise<string>((resolve) => {
        w.onerror = (e) => resolve(e.message)
        w.postMessage({ type: 'throw' })
      })
      w.terminate()
      return { reply, error, ports }
    })
    expect(got.reply).toEqual(
      mode === 'previewOrigin'
        ? { origin: CROSS_SITE, answer: 42, bytes: 1000, stores: [], studioCache: false }
        : { origin: HOST, answer: 42, bytes: 1000, stores: ['files'], studioCache: true },
    )
    expect(got.error).toContain('boom from the worker')
    expect(got.ports).toEqual({ pong: true, via: 'returned port', got: 'hi back' })
  })
