import { expect, test, type Page, type Request } from '@playwright/test'

// The demo page runs `npm install && npm run dev` on load. After a reload, the second install of the same deps
// must be served from the persistent package cache: no tarball (and, within the packument TTL, no packument) requests.

const REGISTRY = 'https://registry.npmjs.org/'

async function installOnce(page: Page): Promise<{ tarballs: string[]; packuments: string[] }> {
  const tarballs: string[] = []
  const packuments: string[] = []
  const onReq = (r: Request) => {
    const u = r.url()
    if (!u.startsWith(REGISTRY)) return
    ;(u.endsWith('.tgz') ? tarballs : packuments).push(u)
  }
  page.on('request', onReq)
  await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible({ timeout: 120_000 })
  page.off('request', onReq)
  return { tarballs, packuments }
}

test('second npm install after a reload is served from the persistent cache', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  await page.goto('/')
  const first = await installOnce(page)
  expect(first.tarballs.length).toBeGreaterThan(0)
  expect(first.packuments.length).toBeGreaterThan(0)

  await page.reload()
  const second = await installOnce(page)
  console.log(`registry requests: first load ${first.tarballs.length} tarballs + ${first.packuments.length} packuments; after reload ${second.tarballs.length} + ${second.packuments.length}`)
  expect(second.tarballs).toEqual([])
  expect(second.packuments).toEqual([])
})

test('boot({ npmCache: false }) bypasses the persistent cache', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/')
  await installOnce(page) // warms the persistent cache in this context
  await page.goto('/demo/blank.html')
  const urls: string[] = []
  page.on('request', (r) => void (r.url().startsWith(REGISTRY) && urls.push(r.url())))
  const out = await page.evaluate(async () => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: false })
    await c.fs.writeFile('package.json', JSON.stringify({ dependencies: { react: '^19.1.0' } }))
    const p = await c.spawn('npm', ['install'])
    let out = ''
    await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    return { code: await p.exit, out }
  })
  expect(out.code).toBe(0)
  expect(urls.some((u) => u.endsWith('.tgz'))).toBe(true)
})
