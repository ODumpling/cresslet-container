// npm registry client: abbreviated packuments + tarballs, cached in memory (and Cache API for tarballs).

export interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  bin?: string | Record<string, string>
  os?: string[]
  cpu?: string[]
  hasInstallScript?: boolean
  scripts?: Record<string, string>
  deprecated?: string
  dist: { tarball: string; integrity?: string; shasum?: string }
}

export interface Packument {
  name: string
  'dist-tags': Record<string, string>
  versions: Record<string, Manifest>
}

export interface Registry {
  packument(name: string): Promise<Packument>
  tarball(url: string, integrity?: string): Promise<Uint8Array>
}

const PACKUMENT_TTL = 5 * 60_000
const packuments = new Map<string, { at: number; p: Promise<Packument> }>()
const tarballs = new Map<string, Promise<Uint8Array>>()
const CACHE_NAME = 'cresslet-npm-tarballs-v1'

export class HttpRegistry implements Registry {
  constructor(public base = 'https://registry.npmjs.org') {
    this.base = base.replace(/\/+$/, '')
  }

  packument(name: string): Promise<Packument> {
    const key = `${this.base}|${name}`
    const hit = packuments.get(key)
    if (hit && Date.now() - hit.at < PACKUMENT_TTL) return hit.p
    const p = (async () => {
      const url = `${this.base}/${name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`
      const res = await fetchRetry(url, { headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' } })
      if (res.status === 404) throw new Error(`404 Not Found - ${name} is not in the npm registry`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${name}`)
      return (await res.json()) as Packument
    })()
    packuments.set(key, { at: Date.now(), p })
    p.catch(() => packuments.delete(key))
    return p
  }

  tarball(url: string, integrity?: string): Promise<Uint8Array> {
    let p = tarballs.get(url)
    if (!p) {
      p = (async () => {
        const cache = await openCache()
        let res = cache ? await cache.match(url).catch(() => undefined) : undefined
        const fromCache = !!res
        if (!res) res = await fetchRetry(url)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
        const buf = new Uint8Array(await res.clone().arrayBuffer())
        if (integrity) await verify(buf, integrity, url)
        if (cache && !fromCache) cache.put(url, new Response(buf as BlobPart)).catch(() => {})
        return buf
      })()
      tarballs.set(url, p)
      p.catch(() => tarballs.delete(url))
    }
    return p
  }
}

let cachePromise: Promise<Cache | null> | null = null
function openCache(): Promise<Cache | null> {
  if (!cachePromise) cachePromise = typeof caches !== 'undefined' ? caches.open(CACHE_NAME).catch(() => null) : Promise.resolve(null)
  return cachePromise
}

async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init)
      if (res.status >= 500 && i < tries - 1) throw new Error(String(res.status))
      return res
    } catch (e) {
      if (i >= tries - 1) throw new Error(`network error fetching ${url}: ${e instanceof Error ? e.message : e}`)
      await new Promise((r) => setTimeout(r, 300 * 2 ** i))
    }
  }
}

async function verify(buf: Uint8Array, integrity: string, url: string): Promise<void> {
  const [algo, b64] = integrity.split(' ')[0].split('-')
  const name = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[algo]
  if (!name || !b64 || !globalThis.crypto?.subtle) return
  const digest = new Uint8Array(await crypto.subtle.digest(name, buf as BufferSource))
  let s = ''
  for (const b of digest) s += String.fromCharCode(b)
  if (btoa(s) !== b64) throw new Error(`integrity check failed for ${url}`)
}
