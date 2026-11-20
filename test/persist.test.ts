import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { VFS } from '../src/vfs'
import { encodeSnapshot, idbStore, restoreSnapshot, VfsPersistence, type SnapshotStore } from '../src/persist'

const W = '/home/project'

function project(): VFS {
  const fs = new VFS()
  fs.writeFile(`${W}/package.json`, '{"name":"x"}', { mkdirp: true })
  fs.writeFile(`${W}/src/main.ts`, 'console.log(1)', { mkdirp: true })
  fs.writeFile(`${W}/bin.dat`, new Uint8Array([0, 1, 2, 255]))
  fs.mkdir(`${W}/empty`)
  fs.symlink('src/main.ts', `${W}/link.ts`)
  fs.writeFile(`${W}/node_modules/react/index.js`, 'x', { mkdirp: true })
  fs.writeFile(`${W}/pkgs/a/node_modules/b/index.js`, 'x', { mkdirp: true })
  fs.writeFile(`/tmp/outside`, 'x', { mkdirp: true })
  return fs
}

class MemoryStore implements SnapshotStore {
  data = new Map<string, Uint8Array>()
  writes = 0
  fail = false
  /** The next this many writes fail. */
  failures = 0
  /** Writes wait for this (a slow backend). */
  gate: Promise<void> | null = null
  constructor(readonly backend: 'opfs' | 'indexeddb' = 'indexeddb') {}
  async read(key: string) {
    return this.data.get(key) ?? null
  }
  async write(key: string, bytes: Uint8Array) {
    await this.gate
    if (this.failures > 0) this.failures--
    else if (!this.fail) {
      this.writes++
      this.data.set(key, bytes)
      return
    }
    throw new Error('QuotaExceededError')
  }
  async delete(key: string) {
    this.data.delete(key)
  }
  close() {}
}

const deferred = () => {
  let open!: () => void
  const p = new Promise<void>((r) => (open = r))
  return { p, open }
}

function snapshotOf(entries: unknown[]): Uint8Array {
  const h = new TextEncoder().encode(JSON.stringify({ v: 1, entries }))
  const b = new Uint8Array(8 + h.byteLength)
  b.set([0x43, 0x56, 0x46, 0x53])
  new DataView(b.buffer).setUint32(4, h.byteLength, true)
  b.set(h, 8)
  return b
}

describe('snapshot codec', () => {
  it('round-trips the workdir without node_modules or files outside it', () => {
    const src = project()
    src.utimes(`${W}/src/main.ts`, 1234)
    src.utimes(`${W}/src`, 99)
    const dst = new VFS()
    restoreSnapshot(dst, W, encodeSnapshot(src, W))
    expect(dst.readText(`${W}/package.json`)).toBe('{"name":"x"}')
    expect(dst.readText(`${W}/src/main.ts`)).toBe('console.log(1)')
    expect([...dst.readFile(`${W}/bin.dat`)]).toEqual([0, 1, 2, 255])
    expect(dst.isDir(`${W}/empty`)).toBe(true)
    expect(dst.readlink(`${W}/link.ts`)).toBe('src/main.ts')
    expect(dst.stat(`${W}/src/main.ts`).mtimeMs).toBe(1234)
    expect(dst.stat(`${W}/src`).mtimeMs).toBe(99)
    expect(dst.exists(`${W}/node_modules`)).toBe(false)
    expect(dst.exists(`${W}/pkgs/a/node_modules`)).toBe(false)
    expect(dst.isDir(`${W}/pkgs/a`)).toBe(true)
    expect(dst.exists('/tmp/outside')).toBe(false)
  })

  it('rejects corrupt snapshots without writing anything', () => {
    const good = encodeSnapshot(project(), W)
    for (const bad of [new Uint8Array([1, 2, 3]), good.slice(0, good.byteLength - 2), new TextEncoder().encode('CVFS\x05\0\0\0{"v":9}')]) {
      const dst = new VFS()
      expect(() => restoreSnapshot(dst, W, bad)).toThrow()
      expect(dst.exists(W)).toBe(false)
    }
    const evil = new TextEncoder().encode(JSON.stringify({ v: 1, entries: [['../escape', 'd', 0]] }))
    const blob = new Uint8Array(8 + evil.byteLength)
    blob.set([0x43, 0x56, 0x46, 0x53])
    new DataView(blob.buffer).setUint32(4, evil.byteLength, true)
    blob.set(evil, 8)
    expect(() => restoreSnapshot(new VFS(), W, blob)).toThrow(/bad path/)
    const through = snapshotOf([['l', 'l', 0, '/etc'], ['l/passwd', 'd', 0]])
    expect(() => restoreSnapshot(new VFS(), W, through)).toThrow(/bad entry/)
  })
})

describe('VfsPersistence', () => {
  afterEach(() => vi.useRealTimers())

  async function setup(opts = {}, store = new MemoryStore(), fallback = new MemoryStore()) {
    const fs = new VFS()
    fs.mkdir(W, { recursive: true })
    const errors: string[] = []
    const p = new VfsPersistence(fs, W, opts, (m) => errors.push(m), async () => store, (k) => fallback.read(k))
    await p.start()
    return { fs, p, store, errors }
  }

  it('restores on start and reports it', async () => {
    const store = new MemoryStore()
    store.data.set('default', encodeSnapshot(project(), W))
    const { fs, p } = await setup({}, store)
    expect(p.restored).toBe(true)
    expect(p.backend).toBe('indexeddb')
    expect(fs.readText(`${W}/src/main.ts`)).toBe('console.log(1)')
    expect(store.writes).toBe(0) // restoring isn't a change
  })

  it('debounces writes, and writes after maxWrites changes even while they keep coming', async () => {
    vi.useFakeTimers()
    const { fs, store } = await setup({ debounceMs: 100, maxWrites: 5 })
    fs.writeFile(`${W}/a`, '1')
    fs.writeFile(`${W}/a`, '2')
    await vi.advanceTimersByTimeAsync(50)
    expect(store.writes).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(store.writes).toBe(1)
    for (let i = 0; i < 5; i++) fs.writeFile(`${W}/b${i}`, 'x')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.writes).toBe(2)
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.readdir(W)).toEqual(['a', 'b0', 'b1', 'b2', 'b3', 'b4'])
  })

  it('ignores node_modules changes', async () => {
    vi.useFakeTimers()
    const { fs, store } = await setup({ debounceMs: 10 })
    fs.writeFile(`${W}/node_modules/x/index.js`, 'x', { mkdirp: true })
    fs.writeFile(`${W}/sub/node_modules/y.js`, 'x', { mkdirp: true }) // creates sub/: a change
    await vi.advanceTimersByTimeAsync(20)
    expect(store.writes).toBe(1)
    fs.writeFile(`${W}/sub/node_modules/y.js`, 'y')
    await vi.advanceTimersByTimeAsync(20)
    expect(store.writes).toBe(1)
  })

  it('flush() writes now; clear() drops pending changes and the snapshot', async () => {
    const { fs, p, store } = await setup({ key: 'proj', debounceMs: 60_000 })
    fs.writeFile(`${W}/a`, '1')
    await p.flush()
    expect(store.data.has('proj')).toBe(true)
    fs.writeFile(`${W}/a`, '2')
    await p.clear()
    expect(store.data.has('proj')).toBe(false)
    await p.flush()
    expect(store.writes).toBe(1)
  })

  it('reports failed background writes; flush() rejects', async () => {
    vi.useFakeTimers()
    const store = new MemoryStore()
    const { fs, p, errors } = await setup({ debounceMs: 10 }, store)
    store.fail = true
    fs.writeFile(`${W}/a`, '1')
    await vi.advanceTimersByTimeAsync(20)
    expect(errors).toEqual([expect.stringContaining('not saved: QuotaExceededError')])
    fs.writeFile(`${W}/a`, '2')
    await expect(p.flush()).rejects.toThrow('QuotaExceededError')
  })

  it('a failed write keeps its changes pending: retried by the next flush(), which rejects while it keeps failing', async () => {
    const store = new MemoryStore()
    const { fs, p } = await setup({ debounceMs: 60_000 }, store)
    fs.writeFile(`${W}/a`, '1')
    store.fail = true
    await expect(p.flush()).rejects.toThrow('QuotaExceededError')
    await expect(p.flush()).rejects.toThrow('QuotaExceededError') // nothing new, but not stored either
    store.fail = false
    await p.flush()
    expect(store.writes).toBe(1)
    // flush() during a write that fails retries it rather than resolving
    fs.writeFile(`${W}/a`, '2')
    store.failures = 1
    const gate = deferred()
    store.gate = gate.p
    const first = p.flush()
    await new Promise((r) => setTimeout(r)) // the write is in progress: nothing else pending
    const second = p.flush()
    gate.open()
    await expect(first).rejects.toThrow('QuotaExceededError')
    await second
    expect(store.writes).toBe(2)
  })

  it('clear() during a failing write: its changes stay cleared', async () => {
    const store = new MemoryStore()
    const { fs, p } = await setup({ debounceMs: 60_000 }, store)
    fs.writeFile(`${W}/a`, '1')
    store.failures = 1
    const gate = deferred()
    store.gate = gate.p
    const write = p.flush()
    await new Promise((r) => setTimeout(r)) // the write is in progress
    const cleared = p.clear()
    gate.open()
    await expect(write).rejects.toThrow()
    await cleared
    store.gate = null
    await p.flush()
    expect(store.writes).toBe(0)
  })

  it('changes during a slow write join one queued write (one serialization), not one per batch', async () => {
    const store = new MemoryStore()
    const { fs, p } = await setup({ maxWrites: 5 }, store)
    const gate = deferred()
    store.gate = gate.p
    for (let i = 0; i < 5; i++) fs.writeFile(`${W}/a${i}`, 'x')
    await new Promise((r) => setTimeout(r)) // the first write starts (and blocks)
    for (let i = 0; i < 500; i++) fs.writeFile(`${W}/b${i}`, 'x')
    gate.open()
    await p.flush()
    expect(store.writes).toBe(2)
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.readdir(W).length).toBe(505)
  })

  it('restores from IndexedDB when OPFS has no snapshot', async () => {
    const fallback = new MemoryStore()
    fallback.data.set('default', encodeSnapshot(project(), W))
    const { fs, p } = await setup({}, new MemoryStore('opfs'), fallback)
    expect(p).toMatchObject({ restored: true, backend: 'opfs' })
    expect(fs.readText(`${W}/src/main.ts`)).toBe('console.log(1)')
  })

  it('close() writes pending changes and stops watching', async () => {
    const { fs, p, store } = await setup({ debounceMs: 60_000 })
    fs.writeFile(`${W}/a`, '1')
    p.close()
    await p.flush()
    expect(store.writes).toBe(1)
    fs.writeFile(`${W}/a`, '2')
    await p.flush()
    expect(store.writes).toBe(1)
  })

  it('a removed workdir snapshots as empty', async () => {
    const { fs, p, store } = await setup({ maxWrites: 1 })
    fs.writeFile(`${W}/a`, '1')
    fs.rm(W, { recursive: true })
    await p.flush()
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.readdir(W)).toEqual([])
  })

  it('validates options', () => {
    const fs = new VFS()
    expect(() => new VfsPersistence(fs, W, { key: '' }, () => {})).toThrow(/key/)
    expect(() => new VfsPersistence(fs, W, { maxWrites: 0 }, () => {})).toThrow(/maxWrites/)
    expect(() => new VfsPersistence(fs, W, { debounceMs: -1 }, () => {})).toThrow(/debounceMs/)
  })
})

describe('idbStore', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads, writes and deletes snapshots', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    const s = (await idbStore())!
    expect(s.backend).toBe('indexeddb')
    expect(await s.read('k')).toBeNull()
    await s.write('k', new Uint8Array([1, 2]))
    expect([...(await s.read('k'))!]).toEqual([1, 2])
    await s.delete('k')
    expect(await s.read('k')).toBeNull()
  })
  it('create: false opens no database that does not exist', async () => {
    const f = new IDBFactory()
    vi.stubGlobal('indexedDB', f)
    expect(await idbStore(false)).toBeNull()
    expect(await f.databases()).toEqual([])
    ;(await idbStore())!.close()
    expect(await idbStore(false)).not.toBeNull()
  })
  it('is null without IndexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(await idbStore()).toBeNull()
  })
})
