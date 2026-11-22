import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { VFS } from '../src/vfs'
import { clearPersisted, encodeSnapshot, idbStore, restoreSnapshot, VfsPersistence, type SnapshotStore } from '../src/persist'

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
    const bad = [
      [['l', 'l', 0, '/etc'], ['l/passwd', 'd', 0]], // through a symlink
      [['a', 'f', 0, 0], ['a/b', 'f', 0, 0]], // under a file
      [['x/y', 'd', 0]], // before its parent
      [['a', 'd', 0], ['a', 'd', 0]], // twice
      [['a', 'd', '0']], // bad mtime
    ]
    for (const entries of bad) {
      const dst = new VFS()
      expect(() => restoreSnapshot(dst, W, snapshotOf(entries))).toThrow(/bad entry/)
      expect(dst.exists(W)).toBe(false)
    }
  })
})

describe('VfsPersistence', () => {
  const started: VfsPersistence[] = []
  afterEach(() => {
    vi.useRealTimers()
    for (const p of started.splice(0)) p.close() // unregisters them (clearPersisted goes through live instances)
  })

  async function setup<S extends SnapshotStore = MemoryStore>(opts = {}, given?: S, other: SnapshotStore | null = new MemoryStore('indexeddb'), dir = W) {
    const store = given ?? new MemoryStore()
    const fs = new VFS()
    fs.mkdir(W, { recursive: true })
    const errors: string[] = []
    const p = new VfsPersistence(fs, dir, opts, (m) => errors.push(m), async () => store, async () => other)
    started.push(p)
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

  it('counts writes through symlinks into the workdir (node_modules/pkg -> packages/pkg, links elsewhere)', async () => {
    const { fs, p, store } = await setup({ debounceMs: 60_000 })
    fs.writeFile(`${W}/packages/pkg/index.js`, 'v1', { mkdirp: true })
    fs.writeFile(`${W}/a.txt`, 'v1')
    fs.mkdir(`${W}/node_modules`)
    fs.symlink('../packages/pkg', `${W}/node_modules/pkg`)
    fs.symlink(W, '/tmp-link')
    await p.flush()
    for (const [path, file] of [
      [`${W}/node_modules/pkg/index.js`, 'packages/pkg/index.js'],
      [`${W}/node_modules/pkg/new.js`, 'packages/pkg/new.js'],
      ['/tmp-link/a.txt', 'a.txt'],
    ]) {
      fs.writeFile(path, 'v2')
      await p.flush()
      const back = new VFS()
      restoreSnapshot(back, W, store.data.get('default')!)
      expect(back.readText(`${W}/${file}`)).toBe('v2')
    }
    fs.symlink(`${W}/a.txt`, '/file-link')
    await p.flush()
    fs.writeFile('/file-link', 'v3')
    await p.flush()
    const viaFile = new VFS()
    restoreSnapshot(viaFile, W, store.data.get('default')!)
    expect(viaFile.readText(`${W}/a.txt`)).toBe('v3')
    fs.rm(`${W}/node_modules/pkg/new.js`)
    await p.flush()
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.exists(`${W}/packages/pkg/new.js`)).toBe(false)

    // creating a link inside node_modules isn't a change; removing the workdir through a link to its parent is
    const writes = store.writes
    fs.symlink('../a.txt', `${W}/node_modules/project-link`)
    await p.flush()
    expect(store.writes).toBe(writes)
    fs.symlink('/home', '/workspace')
    fs.rm('/workspace/project', { recursive: true })
    await p.flush()
    const gone = new VFS()
    restoreSnapshot(gone, W, store.data.get('default')!)
    expect(gone.readdir(W)).toEqual([])
  })

  it('a workdir moved and linked back keeps saving edits made at its new path', async () => {
    const { fs, p, store } = await setup({ debounceMs: 60_000 })
    fs.writeFile(`${W}/a.txt`, 'v1')
    fs.rename(W, '/home/moved')
    fs.symlink('/home/moved', W)
    await p.flush()
    fs.writeFile('/home/moved/a.txt', 'v2')
    await p.flush()
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.readText(`${W}/a.txt`)).toBe('v2')
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

  it('a change right after clear() is saved (not swallowed by a write queued before it)', async () => {
    for (const slow of [false, true]) {
      const store = new MemoryStore()
      const { fs, p } = await setup({ debounceMs: 60_000 }, store)
      const gate = deferred()
      if (slow) store.gate = gate.p
      fs.writeFile(`${W}/a`, '1')
      const first = p.flush()
      if (slow) await new Promise((r) => setTimeout(r)) // in progress
      fs.writeFile(`${W}/b`, '1')
      void p.flush() // queued behind it
      const cleared = p.clear()
      fs.writeFile(`${W}/y`, 'after clear')
      const last = p.flush()
      gate.open()
      await first
      await Promise.all([cleared, last, p.flush()])
      const back = new VFS()
      restoreSnapshot(back, W, store.data.get('default')!)
      expect(back.readText(`${W}/y`)).toBe('after clear')
    }
  })

  it('a failing write is reported once, however many changes join it', async () => {
    const store = new MemoryStore()
    store.fail = true
    const { fs, errors } = await setup({ maxWrites: 2 }, store)
    for (let i = 0; i < 50; i++) fs.writeFile(`${W}/f${i}`, 'x')
    await new Promise((r) => setTimeout(r, 10))
    expect(errors.length).toBe(1)
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

  it('restores the newer of the two backends\' snapshots; the first save drops the other copy', async () => {
    const snap = (text: string, t: number) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(t)
      try {
        const fs = new VFS()
        fs.writeFile(`${W}/a`, text, { mkdirp: true })
        return encodeSnapshot(fs, W)
      } finally {
        vi.useRealTimers()
      }
    }
    for (const [mineAt, theirsAt, want] of [[null, 100, 'theirs'], [100, 200, 'theirs'], [200, 100, 'mine']] as const) {
      const store = new MemoryStore('opfs')
      const other = new MemoryStore('indexeddb')
      if (mineAt) store.data.set('default', snap('mine', mineAt))
      other.data.set('default', snap('theirs', theirsAt))
      const { fs, p } = await setup({ debounceMs: 60_000 }, store, other)
      expect(p).toMatchObject({ restored: true, backend: 'opfs' })
      expect(fs.readText(`${W}/a`)).toBe(want)
      fs.writeFile(`${W}/a`, 'new')
      await p.flush()
      expect(other.data.has('default')).toBe(false)
      expect(store.data.has('default')).toBe(true)
    }
  })

  it('a newer snapshot that fails validation falls back to the older one', async () => {
    const store = new MemoryStore('opfs')
    const other = new MemoryStore('indexeddb')
    other.data.set('default', encodeSnapshot(project(), W))
    await new Promise((r) => setTimeout(r, 2))
    const newer = encodeSnapshot(project(), W)
    store.data.set('default', newer.slice(0, newer.byteLength - 3)) // valid header, truncated payload
    const { fs, p } = await setup({}, store, other)
    expect(p.restored).toBe(true)
    expect(fs.readText(`${W}/src/main.ts`)).toBe('console.log(1)')
  })

  it("the first save doesn't delete a copy saved to the other backend since boot", async () => {
    const store = new MemoryStore('opfs')
    const other = new MemoryStore('indexeddb')
    other.data.set('default', encodeSnapshot(project(), W))
    const { fs, p } = await setup({ debounceMs: 60_000 }, store, other)
    await new Promise((r) => setTimeout(r, 2))
    const fromOtherTab = encodeSnapshot(project(), W)
    other.data.set('default', fromOtherTab)
    fs.writeFile(`${W}/a`, '1')
    await p.flush()
    expect(other.data.get('default')).toBe(fromOtherTab)
  })

  it('normalizes the workdir path (trailing slash, relative)', async () => {
    for (const dir of [`${W}/`, W.slice(1)]) {
      const store = new MemoryStore()
      const { fs, p } = await setup({ debounceMs: 60_000 }, store, undefined, dir)
      fs.writeFile(`${W}/a`, '1')
      await p.flush()
      expect(store.writes).toBe(1)
    }
  })

  it('teardown retries a write in progress that fails', async () => {
    const store = new MemoryStore()
    const { fs, p } = await setup({ debounceMs: 60_000 }, store)
    fs.writeFile(`${W}/a`, '1')
    store.failures = 1
    const gate = deferred()
    store.gate = gate.p
    const write = p.flush()
    await new Promise((r) => setTimeout(r)) // in progress, nothing else pending
    p.close()
    gate.open()
    await expect(write).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    expect(store.writes).toBe(1)
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

  it('a removed workdir (or ancestor) snapshots as empty; changes elsewhere are ignored', async () => {
    for (const removed of [W, '/home']) {
      const store = new MemoryStore()
      const { fs, p } = await setup({ debounceMs: 60_000 }, store)
      fs.writeFile(`${W}/a`, '1')
      await p.flush()
      fs.writeFile('/tmp/x', 'x', { mkdirp: true })
      fs.writeFile('/home/other', 'x')
      await p.flush()
      expect(store.writes).toBe(1)
      fs.rm(removed, { recursive: true })
      await p.flush()
      expect(store.writes).toBe(2)
      const back = new VFS()
      restoreSnapshot(back, W, store.data.get('default')!)
      expect(back.readdir(W)).toEqual([])
    }
  })

  it('clear() after teardown still deletes, with the IndexedDB store closed', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    try {
      const store = (await idbStore())!
      const { fs, p } = await setup({ debounceMs: 60_000 }, store, null)
      fs.writeFile(`${W}/a`, '1')
      await p.flush()
      p.close()
      const cleared = p.clear() // right away, as `teardown(); await persistence.clear()`
      await cleared
      await new Promise((r) => setTimeout(r, 10))
      await p.clear() // and once the store is closed
      const check = (await idbStore(false))!
      expect(await check.read('default')).toBeNull()
      check.close()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('the static clear waits for a save still queued at teardown', async () => {
    const store = new MemoryStore()
    const { fs, p } = await setup({ debounceMs: 60_000 }, store)
    const gate = deferred()
    store.gate = gate.p
    fs.writeFile(`${W}/a`, '1')
    void p.flush().catch(() => {}) // in flight
    await new Promise((r) => setTimeout(r))
    fs.writeFile(`${W}/a`, '2') // queued by teardown
    p.close()
    const cleared = clearPersisted('default')
    gate.open()
    await cleared
    await new Promise((r) => setTimeout(r, 10))
    expect(store.data.has('default')).toBe(false)
  })

  it('the static clear deletes once for containers sharing a key, after all their queued saves', async () => {
    // one backend, two connections: only the old one's write is slow
    const store = new MemoryStore()
    const slow = new MemoryStore()
    slow.data = store.data
    const old = await setup({ debounceMs: 60_000 }, slow)
    const now = await setup({ debounceMs: 60_000 }, store) // e.g. rebooted with the same key
    const gate = deferred()
    slow.gate = gate.p
    old.fs.writeFile(`${W}/a`, 'old')
    void old.p.flush().catch(() => {}) // slow write in flight
    await new Promise((r) => setTimeout(r))
    old.p.close()
    const cleared = clearPersisted('default')
    now.fs.writeFile(`${W}/b`, 'new') // an edit in the new container while the clear is pending
    const saved = now.p.flush()
    await new Promise((r) => setTimeout(r, 5))
    gate.open()
    await cleared
    await saved
    await new Promise((r) => setTimeout(r, 5))
    const back = new VFS()
    restoreSnapshot(back, W, store.data.get('default')!)
    expect(back.readdir(W)).toEqual(['b'])
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
