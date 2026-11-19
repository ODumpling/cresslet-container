// npm registry client: abbreviated packuments + tarballs, cached in memory and (optionally) in a persistent PackageCache.
import { canVerify, OP_TIMEOUT, selectDigest, tarballKey, type CacheStore, type Digest, type PackageCache } from './cache'

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
  /** Wait (bounded, best-effort) for pending persistent-cache writes. */
  flush?(): Promise<void>
}

/** Packuments are reused for 5 minutes (the registry's own `max-age`), in memory and across reloads. */
export const PACKUMENT_TTL = 5 * 60_000
/** A stale packument served because the registry was unreachable is retried after this long, not after a full TTL. */
export const STALE_RETRY = 10_000

/** In-memory memo, one per persistent cache (and one for "no cache"), shared by the registries using it. */
interface Memo {
  packuments: Map<string, { until: number; p: Promise<Packument> }>
  tarballs: Map<string, Promise<Uint8Array>>
  writes: Set<Promise<void>>
}
const memos = new WeakMap<object, Memo>()
const NO_CACHE = {}
function memoFor(cache: PackageCache | null): Memo {
  const k = cache ?? NO_CACHE
  let m = memos.get(k)
  if (!m) memos.set(k, (m = { packuments: new Map(), tarballs: new Map(), writes: new Set() }))
  return m
}

export interface HttpRegistryOptions {
  /** Persistent cache for tarballs + packuments; `null` = in-memory only. */
  cache?: PackageCache | null
}

export class HttpRegistry implements Registry {
  readonly cache: PackageCache | null
  private readonly memo: Memo

  constructor(
    public base = 'https://registry.npmjs.org',
    opts: HttpRegistryOptions = {},
  ) {
    this.base = base.replace(/\/+$/, '')
    this.cache = opts.cache ?? null
    this.memo = memoFor(this.cache)
  }

  packument(name: string): Promise<Packument> {
    const key = `${this.base}|${name}`
    const memo = this.memo.packuments
    const hit = memo.get(key)
    if (hit && Date.now() < hit.until) return hit.p
    const entry = { until: Infinity, p: null as unknown as Promise<Packument> } // in flight: shared until settled
    entry.p = (async () => {
      const stored = await this.cache?.get<{ at: number; data: Packument }>('packuments', key).catch(() => undefined)
      if (stored && Date.now() - stored.at < PACKUMENT_TTL) {
        entry.until = stored.at + PACKUMENT_TTL // keep the original fetch time: no TTL restart on load
        return stored.data
      }
      // registry unreachable: a stale packument beats failing, but retry soon
      const stale = () => ((entry.until = Date.now() + STALE_RETRY), stored!.data)
      const url = `${this.base}/${name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`
      let res: Response
      try {
        res = await fetchRetry(url, { headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' } })
      } catch (e) {
        if (stored) return stale()
        throw e
      }
      if (res.status >= 500 && stored) return stale() // 4xx (auth, not found, rate limit) surfaces
      if (res.status === 404) throw new Error(`404 Not Found - ${name} is not in the npm registry`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${name}`)
      const data = (await res.json()) as Packument
      const at = Date.now()
      entry.until = at + PACKUMENT_TTL
      this.write('packuments', key, { at, data })
      return data
    })()
    memo.set(key, entry)
    entry.p.catch(() => memo.get(key) === entry && memo.delete(key))
    return entry.p
  }

  tarball(url: string, integrity?: string): Promise<Uint8Array> {
    const memoKey = `${url} ${integrity ?? ''}` // a different expected digest must not get these bytes
    const memo = this.memo.tarballs
    let p = memo.get(memoKey)
    if (!p) {
      p = (async () => {
        const digest = selectDigest(integrity)
        const key = tarballKey(url, integrity)
        const stored = await this.cache?.get<Uint8Array>('tarballs', key).catch(() => undefined)
        if (stored instanceof Uint8Array) {
          // never trust the cache blindly: a corrupt/mismatched entry is evicted and refetched
          if (await verify(stored, digest, url).then(() => true, () => false)) return stored
          await this.cache?.delete('tarballs', key).catch(() => {})
        }
        const res = await fetchRetry(url)
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        await verify(buf, digest, url)
        this.write('tarballs', key, buf)
        return buf
      })()
      memo.set(memoKey, p)
      p.catch(() => memo.delete(memoKey))
    }
    return p
  }

  private write(store: CacheStore, key: string, value: unknown): void {
    if (!this.cache) return
    const writes = this.memo.writes
    const w = this.cache.put(store, key, value).catch(() => {})
    writes.add(w)
    void w.then(() => writes.delete(w))
  }

  async flush(): Promise<void> {
    if (!this.memo.writes.size) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([Promise.all(this.memo.writes), new Promise((r) => (timer = setTimeout(r, OP_TIMEOUT)))])
    clearTimeout(timer)
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

/** Checks `buf` against the selected digests (any may match); a no-op when there is none or it can't be checked (tarballs are then keyed by URL). */
async function verify(buf: Uint8Array, digest: Digest | null, url: string): Promise<void> {
  if (!canVerify(digest)) return
  const bytes = new Uint8Array(await crypto.subtle.digest(digest.subtle, buf as BufferSource))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  if (!digest.hashes.includes(btoa(s))) throw new Error(`integrity check failed for ${url}`)
}
