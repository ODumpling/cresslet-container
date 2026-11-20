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
