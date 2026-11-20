import { expect, test, type Page } from '@playwright/test'

// boot({ persist }): files written in one page load are back after a reload; node_modules isn't snapshotted;
// clear() / Container.clearPersisted() remove the snapshot. OPFS where available, IndexedDB otherwise.

type Win = Window & { c: import('../src/container').Container }

/** Boot a container on the blank page with `persist`, and report what it restored. */
const boot = (page: Page, persist: unknown) =>
  page.evaluate(async (persist) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: false, persist: persist as never })
    ;(window as unknown as Win).c = c
    const p = c.persistence!
    const read = (f: string) => c.fs.readFile(f, 'utf8').catch(() => null)
    return {
      backend: p.backend,
      restored: p.restored,
      app: await read('src/App.tsx'),
      bin: await c.fs.readFile('logo.bin').then((b) => [...b]).catch(() => null),
      nodeModules: await c.fs.exists('node_modules'),
      tree: (await c.fs.readdir('.')).sort(),
    }
  }, persist)

/** Snapshot keys in IndexedDB (fallback backend). */
const idbKeys = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((res) => {
        const r = indexedDB.open('cresslet-vfs')
        r.onupgradeneeded = () => r.result.createObjectStore('snapshots')
        r.onsuccess = () => {
          const g = r.result.transaction('snapshots').objectStore('snapshots').getAllKeys()
          g.onsuccess = () => (r.result.close(), res(g.result as string[]))
        }
      }),
  )

for (const backend of ['opfs', 'indexeddb'] as const) {
  test(`workdir survives a reload (${backend})`, async ({ browser, browserName }) => {
    test.skip(backend === 'opfs' && browserName === 'webkit', "Playwright's WebKit has no OPFS (falls back to IndexedDB: the other test)")
    const page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e) => console.log('[pageerror]', e.message))
    // no OPFS writable streams on the main thread (older Safari): falls back to IndexedDB
    if (backend === 'indexeddb') await page.addInitScript(() => delete (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable)
    await page.goto('/demo/blank.html')

    const first = await boot(page, { key: 'proj-1', debounceMs: 200 })
    expect(first).toMatchObject({ backend, restored: false, app: null })
    await page.evaluate(async () => {
      const { c } = window as unknown as Win
      await c.fs.writeFile('src/App.tsx', 'export default () => <h1>persisted</h1>')
      await c.fs.writeFile('logo.bin', new Uint8Array([0, 128, 255]))
      await c.fs.writeFile('node_modules/react/index.js', 'module.exports = {}')
    })
    // the debounced snapshot (no flush()): wait past debounceMs
    await page.waitForTimeout(800)

    await page.reload()
    const second = await boot(page, { key: 'proj-1' })
    console.log(`after reload (${backend}):`, JSON.stringify(second))
    expect(second).toEqual({ backend, restored: true, app: 'export default () => <h1>persisted</h1>', bin: [0, 128, 255], nodeModules: false, tree: ['logo.bin', 'src'] })
    if (backend === 'indexeddb') expect(await idbKeys(page)).toEqual(['proj-1'])

    // other keys are separate snapshots
    await page.reload()
    expect(await boot(page, { key: 'proj-2' })).toMatchObject({ restored: false, tree: [] })

    // clear(): gone after the next reload
    await page.reload()
    expect(await boot(page, { key: 'proj-1' })).toMatchObject({ restored: true })
    await page.evaluate(() => (window as unknown as Win).c.persistence!.clear())
    await page.reload()
    expect(await boot(page, { key: 'proj-1' })).toMatchObject({ restored: false, tree: [] })
    if (backend === 'indexeddb') expect(await idbKeys(page)).toEqual([])
  })
}

test('a snapshot saved to IndexedDB (no OPFS writes then) is restored once OPFS is in use', async ({ browser, browserName }) => {
  test.skip(browserName === 'webkit', "Playwright's WebKit has no OPFS")
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    if (sessionStorage.noOpfs) delete (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable
  })
  await page.goto('/demo/blank.html')
  await page.evaluate(() => (sessionStorage.noOpfs = '1'))
  await page.reload()
  expect(await boot(page, { key: 'up' })).toMatchObject({ backend: 'indexeddb', restored: false })
  await page.evaluate(async () => {
    const { c } = window as unknown as Win
    await c.fs.writeFile('src/App.tsx', 'saved in idb')
    await c.persistence!.flush()
    sessionStorage.removeItem('noOpfs')
  })
  await page.reload()
  expect(await boot(page, { key: 'up' })).toMatchObject({ backend: 'opfs', restored: true, app: 'saved in idb' })
})

test('flush() on demand, teardown writes pending changes, Container.clearPersisted() without booting', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/demo/blank.html')
  await boot(page, true)
  await page.evaluate(async () => {
    const { c } = window as unknown as Win
    await c.fs.writeFile('a.txt', 'flushed')
    await c.persistence!.flush()
    await c.fs.writeFile('b.txt', 'on teardown')
    c.teardown()
    await new Promise((r) => setTimeout(r, 500))
  })
  await page.reload()
  expect(await boot(page, true)).toMatchObject({ restored: true, tree: ['a.txt', 'b.txt'] })

  await page.reload()
  await page.evaluate(async () => {
    const { Container } = await import('/dist/cresslet-container.js')
    await Container.clearPersisted()
  })
  expect(await boot(page, true)).toMatchObject({ restored: false, tree: [] })
})

test('without persist, nothing is stored or restored', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/demo/blank.html')
  const out = await page.evaluate(async () => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: false })
    await c.fs.writeFile('a.txt', 'x')
    await new Promise((r) => setTimeout(r, 1500))
    const names: string[] = []
    const root = await navigator.storage.getDirectory().catch(() => null) // Playwright's WebKit: no OPFS
    if (root) for await (const k of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(k)
    return { persistence: c.persistence, opfs: names, idb: (await indexedDB.databases()).map((d) => d.name) }
  })
  expect(out).toEqual({ persistence: null, opfs: [], idb: [] })
})
