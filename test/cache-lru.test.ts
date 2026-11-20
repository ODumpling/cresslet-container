import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { DEFAULT_MAX_BYTES, IdbCache, sharedIdbCache, sizeOf, TOUCH_DELAY } from '../src/npm/cache'
import { Container } from '../src/container'

// LRU size cap, against a spec-complete IndexedDB (fake-indexeddb).

let factory: IDBFactory
let clock = 1_000
beforeEach(() => {
  factory = new IDBFactory()
  vi.stubGlobal('indexedDB', factory)
  vi.spyOn(Date, 'now').mockImplementation(() => clock++) // distinct, increasing last-use times
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const bytes = (n: number) => new Uint8Array(n)

/** Raw view of the `meta` store: entry ids, and the stored total. */
async function meta(): Promise<{ ids: string[]; total: number; sum: number }> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = factory.open('cresslet-npm')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const all = await new Promise<{ id: string; size?: number; bytes?: number }[]>((res) => {
    const r = db.transaction('meta').objectStore('meta').getAll()
    r.onsuccess = () => res(r.result)
  })
  db.close()
  const entries = all.filter((e) => e.id !== '#total')
  return {
    ids: entries.map((e) => e.id).sort(),
    total: all.find((e) => e.id === '#total')?.bytes ?? 0,
    sum: entries.reduce((a, e) => a + e.size!, 0),
  }
}

describe('IdbCache size cap', () => {
  it('evicts the least recently written entries past maxBytes', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(40))
    await c.put('tarballs', 'b', bytes(40))
    await c.put('tarballs', 'c', bytes(40))
    expect(await c.get('tarballs', 'a')).toBeUndefined()
    expect(await c.get('tarballs', 'b')).toEqual(bytes(40))
    expect(await c.get('tarballs', 'c')).toEqual(bytes(40))
    expect(await meta()).toEqual({ ids: ['tarballs:b', 'tarballs:c'], total: 80, sum: 80 })
  })

  it('a read hit counts as a use', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(40))
    await c.put('tarballs', 'b', bytes(40))
    expect(await c.get('tarballs', 'a')).toEqual(bytes(40))
    await c.flushTouches()
    await c.put('tarballs', 'c', bytes(40))
    expect(await c.get('tarballs', 'a')).toEqual(bytes(40))
    expect(await c.get('tarballs', 'b')).toBeUndefined()
  })

  it('writes read hits back on its own after TOUCH_DELAY', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(40))
    await c.put('tarballs', 'b', bytes(40))
    await c.get('tarballs', 'a')
    await new Promise((r) => setTimeout(r, TOUCH_DELAY + 100))
    await c.put('tarballs', 'c', bytes(40))
    expect((await meta()).ids).toEqual(['tarballs:a', 'tarballs:c'])
  })

  it('evicts across stores (packuments count, sized by their JSON)', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    const pk = { at: 1, data: { name: 'x', versions: {} } }
    await c.put('packuments', 'r|x', pk)
    await c.put('tarballs', 'a', bytes(100 - sizeOf(pk)))
    expect(await c.get('packuments', 'r|x')).toEqual(pk)
    await c.flushTouches()
    await c.put('tarballs', 'b', bytes(1))
    expect(await c.get('tarballs', 'a')).toBeUndefined()
    expect(await c.get('packuments', 'r|x')).toEqual(pk)
    expect(await meta()).toMatchObject({ total: sizeOf(pk) + 1, sum: sizeOf(pk) + 1 })
  })

  it('replacing a key re-counts its size instead of adding to it', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(60))
    await c.put('tarballs', 'a', bytes(30))
    await c.put('tarballs', 'b', bytes(70))
    expect(await c.get('tarballs', 'a')).toEqual(bytes(30))
    expect(await meta()).toEqual({ ids: ['tarballs:a', 'tarballs:b'], total: 100, sum: 100 })
  })

  it('delete subtracts from the total', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(60))
    await c.delete('tarballs', 'a')
    await c.delete('tarballs', 'missing')
    expect(await meta()).toEqual({ ids: [], total: 0, sum: 0 })
    await c.put('tarballs', 'b', bytes(100))
    expect(await c.get('tarballs', 'b')).toEqual(bytes(100))
  })

  it('does not store an entry larger than the cap (and drops an older copy of it)', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'keep', bytes(50))
    await c.put('tarballs', 'big', bytes(10))
    await c.put('tarballs', 'big', bytes(101))
    expect(await c.get('tarballs', 'big')).toBeUndefined()
    expect(await c.get('tarballs', 'keep')).toEqual(bytes(50))
    expect(await meta()).toEqual({ ids: ['tarballs:keep'], total: 50, sum: 50 })
  })

  it('repairs a total that drifted above the real size', async () => {
    const c = new IdbCache({ maxBytes: 100 })
    await c.put('tarballs', 'a', bytes(10))
    const db = await new Promise<IDBDatabase>((res) => {
      const r = factory.open('cresslet-npm')
      r.onsuccess = () => res(r.result)
    })
    await new Promise((res) => {
      const t = db.transaction('meta', 'readwrite')
      t.objectStore('meta').put({ id: '#total', bytes: 10_000 })
      t.oncomplete = res
    })
    db.close()
    await c.put('tarballs', 'b', bytes(10))
    expect(await c.get('tarballs', 'b')).toEqual(bytes(10))
    expect(await meta()).toEqual({ ids: ['tarballs:b'], total: 10, sum: 10 })
  })

  it('shares the cap between instances (the total lives in the database)', async () => {
    const a = new IdbCache({ maxBytes: 100 })
    const b = new IdbCache({ maxBytes: 100 })
    await a.put('tarballs', 'x', bytes(60))
    await b.put('tarballs', 'y', bytes(60))
    expect(await a.get('tarballs', 'x')).toBeUndefined()
    expect(await meta()).toEqual({ ids: ['tarballs:y'], total: 60, sum: 60 })
  })

  it('clears v1 entries on upgrade (they have no size / last-use record)', async () => {
    await new Promise<void>((res) => {
      const r = factory.open('cresslet-npm', 1)
      r.onupgradeneeded = () => {
        r.result.createObjectStore('tarballs').put(bytes(5), 'old')
        r.result.createObjectStore('packuments')
      }
      r.onsuccess = () => (r.result.close(), res())
    })
    const c = new IdbCache({ maxBytes: 100 })
    expect(await c.get('tarballs', 'old')).toBeUndefined()
    await c.put('tarballs', 'new', bytes(5))
    expect(await meta()).toEqual({ ids: ['tarballs:new'], total: 5, sum: 5 })
  })
})

describe('cap configuration', () => {
  it('defaults to DEFAULT_MAX_BYTES; sharedIdbCache shares an instance per cap', () => {
    expect(new IdbCache().maxBytes).toBe(DEFAULT_MAX_BYTES)
    expect(sharedIdbCache()).toBe(sharedIdbCache(DEFAULT_MAX_BYTES))
    expect(sharedIdbCache(1000)).toBe(sharedIdbCache(1000))
    expect(sharedIdbCache(1000)).not.toBe(sharedIdbCache())
    expect(sharedIdbCache(1000).maxBytes).toBe(1000)
  })

  it('rejects a cap that is not a positive number', async () => {
    for (const maxBytes of [0, -1, NaN, '5' as unknown as number]) {
      expect(() => new IdbCache({ maxBytes })).toThrow(TypeError)
      await expect(Container.boot({ serviceWorkerUrl: false, npmCache: { maxBytes } })).rejects.toThrow(/maxBytes/)
    }
  })

  it('boot({ npmCache: { maxBytes } }) uses that cap', async () => {
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: { maxBytes: 1234 } })
    expect((c.registry as { cache: IdbCache }).cache.maxBytes).toBe(1234)
    const d = await Container.boot({ serviceWorkerUrl: false, npmCache: { maxBytes: Infinity } })
    expect((d.registry as { cache: IdbCache }).cache.maxBytes).toBe(Infinity)
    const e = await Container.boot({ serviceWorkerUrl: false })
    expect((e.registry as { cache: IdbCache }).cache).toBe(sharedIdbCache())
    for (const x of [c, d, e]) x.teardown()
  })
})
