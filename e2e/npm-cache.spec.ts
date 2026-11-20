import { expect, test, type Page, type Request } from '@playwright/test'

// The demo page runs `npm install && npm run dev` on load. After a reload, the second install of the same deps
// must be served from the persistent package cache: no tarball (and, within the packument TTL, no packument) requests.

const REGISTRY = 'https://registry.npmjs.org/'

/** Records registry requests from before `navigate` starts until the demo app renders. */
async function installOnce(page: Page, navigate: () => Promise<unknown>): Promise<{ tarballs: string[]; packuments: string[] }> {
  const tarballs: string[] = []
  const packuments: string[] = []
  const onReq = (r: Request) => {
    const u = r.url()
    if (!u.startsWith(REGISTRY)) return
    ;(u.endsWith('.tgz') ? tarballs : packuments).push(u)
  }
  page.on('request', onReq)
  await navigate()
  await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible({ timeout: 120_000 })
  page.off('request', onReq)
  return { tarballs, packuments }
}

test('second npm install after a reload is served from the persistent cache', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))

  const first = await installOnce(page, () => page.goto('/'))
  expect(first.tarballs.length).toBeGreaterThan(0)
  expect(first.packuments.length).toBeGreaterThan(0)

  const second = await installOnce(page, () => page.reload())
  console.log(`registry requests: first load ${first.tarballs.length} tarballs + ${first.packuments.length} packuments; after reload ${second.tarballs.length} + ${second.packuments.length}`)
  expect(second.tarballs).toEqual([])
  expect(second.packuments).toEqual([])
})

test('boot({ npmCache: false }) bypasses the persistent cache', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await installOnce(page, () => page.goto('/')) // warms the persistent cache in this context
  const urls: string[] = []
  page.on('request', (r) => void (r.url().startsWith(REGISTRY) && urls.push(r.url())))
  await page.goto('/demo/blank.html')
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

test('boot({ npmCache: { maxBytes } }) keeps the persistent cache under the cap, evicting least recently used', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/demo/blank.html')
  const CAP = 4_000_000 // abbreviated packuments of react, react-dom, scheduler are ~3 MB each
  const out = await page.evaluate(async (CAP) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: { maxBytes: CAP } })
    const install = async (deps: Record<string, string>) => {
      await c.fs.writeFile('package.json', JSON.stringify({ dependencies: deps }))
      await c.fs.rm('node_modules', { recursive: true, force: true })
      const p = await c.spawn('npm', ['install'])
      await p.output.pipeTo(new WritableStream())
      return p.exit
    }
    const codes = [await install({ react: '19.1.0' }), await install({ 'react-dom': '19.1.0' })]
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('cresslet-npm')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const read = <T,>(store: string) =>
      new Promise<T[]>((res) => {
        const r = db.transaction(store).objectStore(store).getAll()
        r.onsuccess = () => res(r.result)
      })
    const meta = await read<{ id: string; size?: number; bytes?: number }>('meta')
    const tarballs = await read<Uint8Array>('tarballs')
    db.close()
    const entries = meta.filter((e) => e.id !== '#total')
    return {
      codes,
      total: meta.find((e) => e.id === '#total')?.bytes,
      sum: entries.reduce((a, e) => a + (e.size ?? 0), 0),
      tarballBytes: tarballs.reduce((a, t) => a + t.byteLength, 0),
      ids: entries.map((e) => e.id),
    }
  }, CAP)
  console.log(`cache after two installs: ${out.ids.length} entries, ${out.total} bytes (cap ${CAP})`)
  expect(out.codes).toEqual([0, 0])
  expect(out.total).toBe(out.sum)
  expect(out.total).toBeLessThanOrEqual(CAP)
  expect(out.tarballBytes).toBeLessThanOrEqual(out.total!)
  expect(out.ids.length).toBeGreaterThan(0)
  // the first install's packument is the least recently used entry once react-dom's (~3 MB) is written
  expect(out.ids).not.toContain('packuments:https://registry.npmjs.org|react')
})
