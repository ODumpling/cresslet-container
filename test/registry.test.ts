import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { HttpRegistry, PACKUMENT_TTL } from '../src/npm/registry'
import { MemoryCache, tarballKey } from '../src/npm/cache'

const sri = (b: Uint8Array) => 'sha512-' + createHash('sha512').update(b).digest('base64')
let n = 0
const base = () => `https://reg${++n}.test` // module-level memo is keyed by base/url, so isolate each test

function mockFetch(routes: Record<string, () => Response>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    const r = routes[url]
    return r ? r() : new Response('nf', { status: 404 })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('HttpRegistry persistent cache', () => {
  const body = new TextEncoder().encode('tarball bytes')

  it('serves tarballs from the cache on a fresh registry (simulated reload), keyed by integrity', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    const calls = mockFetch({ [url]: () => new Response(body) })
    const cache = new MemoryCache()
    expect(await new HttpRegistry(b, { cache }).tarball(url, sri(body))).toEqual(body)
    await Promise.resolve()
    expect(cache.data.has(`tarballs:${sri(body)}`)).toBe(true)
    // same content under another URL (mirror / new page load: in-memory memo is per URL)
    const mirror = `${b}/mirror/a-1.0.0.tgz`
    expect(await new HttpRegistry(b, { cache }).tarball(mirror, sri(body))).toEqual(body)
    expect(calls).toEqual([url])
  })

  it('evicts and refetches a cached tarball that fails integrity', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    const calls = mockFetch({ [url]: () => new Response(body) })
    const cache = new MemoryCache()
    await cache.put('tarballs', sri(body), new TextEncoder().encode('corrupt'))
    expect(await new HttpRegistry(b, { cache }).tarball(url, sri(body))).toEqual(body)
    expect(calls).toEqual([url])
    await Promise.resolve()
    expect(cache.data.get(`tarballs:${sri(body)}`)).toEqual(body)
  })

  it('rejects a network tarball with bad integrity and does not cache it', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    mockFetch({ [url]: () => new Response(new TextEncoder().encode('tampered')) })
    const cache = new MemoryCache()
    await expect(new HttpRegistry(b, { cache }).tarball(url, sri(body))).rejects.toThrow(/integrity/)
    expect(cache.data.size).toBe(0)
  })

  it('keys by URL when there is no sha256+ integrity', () => {
    expect(tarballKey('u', undefined)).toBe('u')
    expect(tarballKey('u', 'sha1-abc')).toBe('u')
    expect(tarballKey('u', 'sha1-abc sha512-xyz')).toBe('sha512-xyz')
  })

  it('reuses persisted packuments within the TTL (no request after a reload)', async () => {
    const b = base()
    const doc = { name: 'a', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    const calls = mockFetch({})
    const cache = new MemoryCache()
    await cache.put('packuments', `${b}|a`, { at: Date.now() - 1000, data: doc }) // written by a previous page load
    expect(await new HttpRegistry(b, { cache }).packument('a')).toEqual(doc)
    expect(calls).toEqual([])
  })

  it('refetches packuments after the TTL; falls back to the stale copy when offline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const b = base()
    const doc = { name: 'a', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    const calls = mockFetch({ [`${b}/a`]: () => Response.json(doc) })
    const cache = new MemoryCache()
    const r = new HttpRegistry(b, { cache })
    expect(await r.packument('a')).toEqual(doc)
    expect(await r.packument('a')).toEqual(doc)
    expect(calls.length).toBe(1)
    await Promise.resolve()
    expect(cache.data.has(`packuments:${b}|a`)).toBe(true)
    vi.setSystemTime(Date.now() + PACKUMENT_TTL + 1)
    expect(await r.packument('a')).toEqual(doc)
    expect(calls.length).toBe(2)
    vi.setSystemTime(Date.now() + PACKUMENT_TTL + 1)
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    expect(await r.packument('a')).toEqual(doc)
  })

  it('works without a persistent cache', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    mockFetch({ [url]: () => new Response(body) })
    const r = new HttpRegistry(b, { cache: null })
    expect(r.cache).toBe(null)
    expect(await r.tarball(url, sri(body))).toEqual(body)
  })
})
