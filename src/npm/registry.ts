// npm registry client: abbreviated packuments + tarballs, cached in memory and (optionally) in a persistent PackageCache.
import { tarballKey, type PackageCache } from './cache'

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

/** Packuments are reused for 5 minutes (the registry's own `max-age`), in memory and across reloads. */
export const PACKUMENT_TTL = 5 * 60_000
const packuments = new Map<string, { at: number; p: Promise<Packument> }>()
const tarballs = new Map<string, Promise<Uint8Array>>()

export interface HttpRegistryOptions {
  /** Persistent cache for tarballs + packuments; `null` = in-memory only. */
  cache?: PackageCache | null
}

export class HttpRegistry implements Registry {
  readonly cache: PackageCache | null

  constructor(
    public base = 'https://registry.npmjs.org',
    opts: HttpRegistryOptions = {},
  ) {
    this.base = base.replace(/\/+$/, '')
    this.cache = opts.cache ?? null
  }

  packument(name: string): Promise<Packument> {
    const key = `${this.base}|${name}`
    const hit = packuments.get(key)
    if (hit && Date.now() - hit.at < PACKUMENT_TTL) return hit.p
    const at = Date.now()
    const p = (async () => {
      const stored = await this.cache?.get<{ at: number; data: Packument }>('packuments', key).catch(() => undefined)
      if (stored && Date.now() - stored.at < PACKUMENT_TTL) return stored.data
      const url = `${this.base}/${name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`
      let res: Response
      try {
        res = await fetchRetry(url, { headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' } })
      } catch (e) {
        if (stored) return stored.data // offline: a stale packument beats failing
        throw e
      }
      if (res.status === 404) throw new Error(`404 Not Found - ${name} is not in the npm registry`)
      if (!res.ok && stored) return stored.data
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${name}`)
      const data = (await res.json()) as Packument
      this.cache?.put('packuments', key, { at: Date.now(), data }).catch(() => {})
      return data
    })()
    packuments.set(key, { at, p })
    p.catch(() => packuments.delete(key))
    return p
  }

  tarball(url: string, integrity?: string): Promise<Uint8Array> {
    let p = tarballs.get(url)
    if (!p) {
      p = (async () => {
        const key = tarballKey(url, integrity)
        const stored = await this.cache?.get<Uint8Array>('tarballs', key).catch(() => undefined)
        if (stored instanceof Uint8Array) {
          // never trust the cache blindly: a corrupt/mismatched entry is evicted and refetched
          if (!integrity || (await verify(stored, integrity, url).then(() => true, () => false))) return stored
          await this.cache?.delete('tarballs', key).catch(() => {})
        }
        const res = await fetchRetry(url)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        if (integrity) await verify(buf, integrity, url)
        this.cache?.put('tarballs', key, buf).catch(() => {})
        return buf
      })()
      tarballs.set(url, p)
      p.catch(() => tarballs.delete(url))
    }
    return p
  }
}

/** Drop the pre-IndexedDB Cache Storage tarball cache (superseded by the IndexedDB cache). */
export function dropLegacyCache(): void {
  if (typeof caches !== 'undefined') caches.delete('cresslet-npm-tarballs-v1').catch(() => {})
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
