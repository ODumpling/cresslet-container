import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { HttpRegistry, PACKUMENT_TTL, STALE_RETRY, type Packument, type Registry } from '../src/npm/registry'
import { MemoryCache, OP_TIMEOUT, selectDigest, tarballKey, type CacheStore } from '../src/npm/cache'
import { install } from '../src/npm/install'
import { VFS } from '../src/vfs'

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

  it('does not hand a memoized tarball to a request expecting a different digest', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    mockFetch({ [url]: () => new Response(body) })
    const r = new HttpRegistry(b, { cache: null })
    expect(await r.tarball(url, sri(body))).toEqual(body)
    const other = sri(new TextEncoder().encode('something else'))
    await expect(r.tarball(url, other)).rejects.toThrow(/integrity/)
  })

  it('keys and verifies with the same (strongest) digest token', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    const sha256 = 'sha256-' + createHash('sha256').update(body).digest('base64')
    // sha1 first and wrong: verification must use the sha512 token that is also the key
    const integrity = `sha1-AAAA ${sha256} ${sri(body)}`
    const calls = mockFetch({ [url]: () => new Response(body) })
    const cache = new MemoryCache()
    expect(await new HttpRegistry(b, { cache }).tarball(url, integrity)).toEqual(body)
    expect(calls).toEqual([url])
    expect(cache.data.has(`tarballs:${sri(body)}`)).toBe(true)
    expect(selectDigest(integrity)?.token).toBe(sri(body))
    expect(tarballKey(url, integrity)).toBe(sri(body))
  })

  it('accepts a tarball matching any of several strongest-algorithm digests (SRI)', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    const other = 'sha512-' + createHash('sha512').update('other').digest('base64')
    const integrity = `${other} ${sri(body)}`
    mockFetch({ [url]: () => new Response(body) })
    const cache = new MemoryCache()
    expect(await new HttpRegistry(b, { cache }).tarball(url, integrity)).toEqual(body)
    expect(selectDigest(integrity)?.token).toBe(other) // keyed by one chosen token
    await Promise.resolve()
    // served from the cache on reload, verified against every sha512 token
    mockFetch({})
    expect(await new HttpRegistry(b, { cache }).tarball(url, integrity)).toEqual(body)
    // a weaker matching digest does not rescue a failing strongest set
    mockFetch({ [url]: () => new Response(body) })
    const sha256 = 'sha256-' + createHash('sha256').update(body).digest('base64')
    await expect(new HttpRegistry(b, { cache: null }).tarball(url, `${other} ${sha256}`)).rejects.toThrow(/integrity/)
  })

  it('keys by URL when the digest cannot be verified (no WebCrypto)', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    vi.stubGlobal('crypto', undefined)
    expect(tarballKey(url, sri(body))).toBe(url)
    mockFetch({ [url]: () => new Response(body) })
    const cache = new MemoryCache()
    // a poisoned integrity-keyed entry must not be served unverified
    await cache.put('tarballs', sri(body), new TextEncoder().encode('poison'))
    expect(await new HttpRegistry(b, { cache }).tarball(url, sri(body))).toEqual(body)
    await Promise.resolve()
    expect(cache.data.get(`tarballs:${url}`)).toEqual(body)
  })

  it('keeps the persisted fetch time when loading a packument (no TTL restart)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const b = base()
    const doc = { name: 'a', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    const calls = mockFetch({ [`${b}/a`]: () => Response.json(doc) })
    const cache = new MemoryCache()
    await cache.put('packuments', `${b}|a`, { at: Date.now() - PACKUMENT_TTL + 1000, data: doc }) // 1s of TTL left
    const r = new HttpRegistry(b, { cache })
    expect(await r.packument('a')).toEqual(doc)
    expect(calls).toEqual([])
    vi.setSystemTime(Date.now() + 2000)
    expect(await r.packument('a')).toEqual(doc)
    expect(calls).toEqual([`${b}/a`])
  })

  it('retries soon after serving a stale packument instead of treating it as fresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const b = base()
    const doc = { name: 'a', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    const cache = new MemoryCache()
    await cache.put('packuments', `${b}|a`, { at: Date.now() - PACKUMENT_TTL - 1, data: doc })
    const calls: string[] = []
    vi.stubGlobal('fetch', async (u: string) => (calls.push(u), new Response('down', { status: 503 })))
    const r = new HttpRegistry(b, { cache })
    expect(await r.packument('a')).toEqual(doc) // 5xx: stale copy
    const n0 = calls.length
    expect(await r.packument('a')).toEqual(doc) // within the backoff: memo
    expect(calls.length).toBe(n0)
    vi.setSystemTime(Date.now() + 60_000) // well within a fresh TTL: a stale copy must not count as fresh
    expect(await r.packument('a')).toEqual(doc)
    expect(calls.length).toBeGreaterThan(n0)
    expect(STALE_RETRY).toBeLessThan(60_000)
  })

  it('surfaces 4xx instead of falling back to a stale packument', async () => {
    for (const status of [401, 403, 404, 429]) {
      const b = base()
      const cache = new MemoryCache()
      await cache.put('packuments', `${b}|a`, { at: 0, data: { name: 'a', 'dist-tags': {}, versions: {} } })
      vi.stubGlobal('fetch', async () => new Response('x', { status }))
      await expect(new HttpRegistry(b, { cache }).packument('a')).rejects.toThrow(String(status))
    }
  })

  it('does not share in-flight persistent reads with a registry that has no cache', async () => {
    const b = base()
    const doc = { name: 'a', 'dist-tags': { latest: '1.0.0' }, versions: {} }
    const calls = mockFetch({ [`${b}/a`]: () => Response.json(doc) })
    const cache = new MemoryCache()
    await cache.put('packuments', `${b}|a`, { at: Date.now(), data: { ...doc, cached: true } })
    const [withCache, without] = await Promise.all([new HttpRegistry(b, { cache }).packument('a'), new HttpRegistry(b, { cache: null }).packument('a')])
    expect(withCache).toHaveProperty('cached', true)
    expect(without).not.toHaveProperty('cached')
    expect(calls).toEqual([`${b}/a`])
  })

  it('flush() waits for pending cache writes, bounded by the op timeout', async () => {
    const b = base()
    const url = `${b}/a/-/a-1.0.0.tgz`
    mockFetch({ [url]: () => new Response(body) })
    let release!: () => void
    const slow = new (class extends MemoryCache {
      async put(store: CacheStore, key: string, value: unknown) {
        await new Promise<void>((r) => (release = r))
        await super.put(store, key, value)
      }
    })()
    const r = new HttpRegistry(b, { cache: slow })
    await r.tarball(url, sri(body))
    let flushed = false
    const f = r.flush().then(() => (flushed = true))
    await new Promise((res) => setTimeout(res, 10))
    expect(flushed).toBe(false)
    release()
    await f
    expect(slow.data.has(`tarballs:${sri(body)}`)).toBe(true)
    // a write that never completes doesn't hang the flush
    vi.useFakeTimers()
    const url2 = `${b}/b/-/b-1.0.0.tgz`
    mockFetch({ [url2]: () => new Response(body) })
    await r.tarball(url2)
    const hung = r.flush().then(() => 'done')
    await vi.advanceTimersByTimeAsync(OP_TIMEOUT + 1)
    expect(await hung).toBe('done')
  })
})

describe('npm install', () => {
  it('flushes the registry before reporting success', async () => {
    const vfs = new VFS()
    vfs.writeFile('/p/package.json', JSON.stringify({ name: 'p', version: '1.0.0' }), { mkdirp: true })
    const log: string[] = []
    const registry: Registry = {
      packument: async () => ({ name: 'x', 'dist-tags': {}, versions: {} }) as Packument,
      tarball: async () => new Uint8Array(),
      flush: async () => void log.push('flush'),
    }
    await install(vfs, registry, { cwd: '/p', out: { write: (s: string) => void (/added/.test(s) && log.push('report')) } })
    expect(log).toEqual(['flush', 'report'])
  })
})
