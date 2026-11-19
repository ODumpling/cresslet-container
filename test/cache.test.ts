import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdbCache, OP_TIMEOUT } from '../src/npm/cache'

// Minimal hand-rolled indexedDB: enough to drive IdbCache's connection lifecycle and transaction timeouts.
interface FakeDb {
  closed: boolean
  onversionchange: (() => void) | null
  onclose: (() => void) | null
  close(): void
}
function fakeIndexedDb(o: { openDelay?: number; hangTx?: () => boolean } = {}) {
  const dbs: FakeDb[] = []
  const data = new Map<string, unknown>()
  const factory = {
    open() {
      const req: Record<string, unknown> & { result?: unknown } = {}
      const db = {
        closed: false,
        onversionchange: null,
        onclose: null,
        objectStoreNames: { contains: () => true },
        close() {
          this.closed = true
        },
        transaction() {
          if (db.closed) throw new Error('InvalidStateError')
          const t: Record<string, (() => void) | null> = { oncomplete: null, onerror: null, onabort: null }
          const finish = () => !o.hangTx?.() && setTimeout(() => t.oncomplete?.(), 0)
          const r = (result?: unknown) => (finish(), { result })
          return Object.assign(t, {
            objectStore: () => ({
              get: (k: string) => r(data.get(k)),
              put: (v: unknown, k: string) => (data.set(k, v), r()),
              delete: (k: string) => (data.delete(k), r()),
            }),
          })
        },
      } as FakeDb & Record<string, unknown>
      dbs.push(db)
      setTimeout(() => {
        req.result = db
        ;(req.onsuccess as () => void)?.()
      }, o.openDelay ?? 0)
      return req
    },
  }
  vi.stubGlobal('indexedDB', factory)
  return { dbs }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('IdbCache connection lifecycle', () => {
  it('closes on versionchange (deleteDatabase / upgrade) and reopens on next use', async () => {
    const { dbs } = fakeIndexedDb()
    const c = new IdbCache()
    await c.put('tarballs', 'k', 1)
    expect(dbs.length).toBe(1)
    dbs[0].onversionchange?.()
    expect(dbs[0].closed).toBe(true)
    expect(await c.get('tarballs', 'k')).toBe(1)
    expect(dbs.length).toBe(2)
  })

  it('reopens after the browser closes the connection', async () => {
    const { dbs } = fakeIndexedDb()
    const c = new IdbCache()
    await c.get('tarballs', 'k')
    dbs[0].closed = true
    dbs[0].onclose?.()
    await c.put('tarballs', 'k', 2)
    expect(dbs.length).toBe(2)
    expect(await c.get('tarballs', 'k')).toBe(2)
  })

  it('closes a connection that opens after the open timeout already fell back', async () => {
    vi.useFakeTimers()
    const { dbs } = fakeIndexedDb({ openDelay: 10_000 })
    const c = new IdbCache()
    const miss = c.get('tarballs', 'k')
    await vi.advanceTimersByTimeAsync(3001)
    expect(await miss).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(dbs[0].closed).toBe(true)
  })
})

describe('IdbCache transaction timeout', () => {
  it('a stuck transaction is a miss (get) / no-op (put, delete)', async () => {
    vi.useFakeTimers()
    let hang = false
    fakeIndexedDb({ hangTx: () => hang })
    const c = new IdbCache()
    const first = c.put('tarballs', 'k', 1)
    await vi.advanceTimersByTimeAsync(1)
    await first
    hang = true
    const ops = [c.get('tarballs', 'k'), c.put('tarballs', 'k', 2), c.delete('tarballs', 'k')]
    let settled = false
    const all = Promise.all(ops).then((v) => ((settled = true), v))
    await vi.advanceTimersByTimeAsync(OP_TIMEOUT - 10)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(20)
    expect(await all).toEqual([undefined, undefined, undefined])
  })
})
