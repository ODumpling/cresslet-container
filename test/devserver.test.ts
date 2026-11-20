import { afterEach, describe, expect, it, vi } from 'vitest'
import { VFS } from '../src/vfs'
import { join } from '../src/path'

// Dev server HMR decisions in node: native esbuild stands in for esbuild-wasm, a fake container captures the handler,
// and a BroadcastChannel listener records what the page would be told.
const gate = vi.hoisted(() => ({ hold: null as Promise<void> | null, built: 0 }))
vi.mock('../src/esbuild', async (orig) => {
  const m = await orig<typeof import('../src/esbuild')>()
  const real = await import('esbuild')
  const es = {
    ...real,
    build: async (o: Parameters<typeof real.build>[0]) => {
      const r = await real.build(o).then((v) => ({ v }), (e: unknown) => ({ e }))
      gate.built++
      if (gate.hold) await gate.hold // simulates a transform still in flight
      if ('e' in r) throw r.e
      return r.v
    },
  }
  return { ...m, loadEsbuild: async () => es }
})
const { createDevServer } = await import('../src/dev/server')

const ROOT = '/__cresslet_test__/p'
let n = 0
const servers: { close(): void }[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  gate.hold = null
})

type Msg = { type: string; updates?: { kind: string; url: string }[] }
async function devServer(files: Record<string, string>) {
  const vfs = new VFS()
  const write = (p: string, s: string) => vfs.writeFile(join(ROOT, p), s, { mkdirp: true })
  write('package.json', JSON.stringify({ dependencies: { react: '*', 'react-dom': '*' } }))
  for (const [p, s] of Object.entries(files)) write(p, s)
  let handler!: (r: Request) => Promise<Response>
  const id = `t${++n}`
  const c = {
    workdir: ROOT,
    vfs,
    instanceId: id,
    esbuildWasmUrl: '',
    resolveFs: { isFile: (p: string) => vfs.isFile(p), isDir: (p: string) => vfs.isDir(p), readText: (p: string) => vfs.tryReadText(p) },
    previewChannel: (name: string) => new BroadcastChannel(name),
    ports: { free: () => 5173, open: (_p: number, h: typeof handler) => ((handler = h), 'http://localhost/'), close() {} },
  }
  const server = await createDevServer(c as never, {})
  const msgs: Msg[] = []
  const bc = new BroadcastChannel(`cresslet:${id}:5173`)
  bc.onmessage = (e) => void msgs.push(e.data)
  servers.push(server, bc)
  const get = async (path: string) => (await handler(new Request('http://localhost' + path))).text()
  /** Wait for the next message the page would receive. */
  const next = async (): Promise<Msg> => {
    const k = msgs.length
    for (let i = 0; i < 200 && msgs.length === k; i++) await new Promise((r) => setTimeout(r, 10))
    if (msgs.length === k) throw new Error('no message')
    return msgs[k]
  }
  /** Assert nothing is sent for a while. */
  const quiet = async () => {
    const k = msgs.length
    await new Promise((r) => setTimeout(r, 250))
    return msgs.slice(k)
  }
  return { vfs, write, get, next, quiet, rm: (p: string) => vfs.rm(join(ROOT, p), { recursive: true }) }
}

// classic createElement instead of JSX syntax (no bare jsx-runtime import): keeps the dependency optimizer out of it
const comp = (name: string, body = 'return null', imports = '') => `${imports}\nexport default function ${name}() { React.createElement('i'); ${body} }\n`
const upd = (m: Msg) => (m.type === 'update' ? m.updates!.map((u) => u.url) : m.type)

describe('dev server HMR', () => {
  it('an HTML entry that exports a component is not a refresh boundary', async () => {
    const s = await devServer({ 'index.html': '<script type="module" src="/src/App.tsx"></script>', 'src/App.tsx': comp('App') })
    await s.get('/')
    expect(await s.get('/src/App.tsx')).toContain('.register(App')
    s.write('src/App.tsx', comp('App', 'return 1'))
    expect(upd(await s.next())).toBe('reload')
  })

  it('signs hooks in .ts modules and registers JSX components in .js files', async () => {
    const s = await devServer({ 'src/useCounter.ts': 'export function useCounter() { return useState(0) }\nfunction useState(x) { return [x] }\n', 'src/Button.js': 'export default function Button() { return <b /> }\n' })
    expect(await s.get('/src/useCounter.ts')).toMatch(/\.sign\(useCounter, "return useState\(0\);"/)
    expect(await s.get('/src/Button.js')).toContain('.register(Button')
  })

  it('an in-flight transform from before a flush does not publish stale code', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App', 'return util', "import util from './util'"), 'src/util.ts': 'export default 1\n' })
    await s.get('/src/main.ts')
    await s.get('/src/App.tsx')
    await s.get('/src/util.ts')
    s.write('src/util.ts', 'export default 2\n')
    const m1 = await s.next()
    expect(upd(m1)).toEqual(['/src/App.tsx'])
    // the page re-imports App (new util stamp); meanwhile util changes again before that transform finishes
    let release!: () => void
    gate.hold = new Promise((r) => (release = r))
    const built = gate.built
    const inflight = s.get('/src/App.tsx?t=1')
    while (gate.built === built) await new Promise((r) => setTimeout(r, 5))
    s.write('src/util.ts', 'export default 3\n')
    await s.next()
    gate.hold = null
    release()
    const stale = await inflight
    const fresh = await s.get('/src/App.tsx?t=2')
    const stamp = (code: string) => /util\.ts\?t=(\d+)/.exec(code)![1]
    expect(stamp(fresh)).not.toBe(stamp(stale))
  })

  it('a deleted module leaves the graph (its edges no longer steer updates)', async () => {
    const s = await devServer({
      'src/main.ts': "import App from './App'\nimport Old from './Old'\n",
      'src/App.tsx': comp('App', 'return util', "import util from './util'"),
      'src/Old.tsx': comp('Old', 'return util', "import util from './util'"),
      'src/util.ts': 'export default 1\n',
    })
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/Old.tsx', '/src/util.ts']) await s.get(p)
    s.write('src/main.ts', "import App from './App'\n")
    s.rm('src/Old.tsx')
    expect(upd(await s.next())).toBe('reload')
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/util.ts']) await s.get(p) // the reloaded page
    s.write('src/util.ts', 'export default 2\n')
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('a transform error stops counting once its module is no longer imported; a full reload clears it', async () => {
    const s = await devServer({
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': "import App from './App'\n",
      'src/App.tsx': comp('App', 'return Broken', "import Broken from './Broken'"),
      'src/Broken.tsx': 'export default function Broken( {\n',
    })
    for (const p of ['/', '/src/main.ts', '/src/App.tsx', '/src/Broken.tsx']) await s.get(p)
    expect(await s.get('/@cresslet/last-error')).toContain('Broken.tsx')
    s.write('src/App.tsx', comp('App'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    await s.get('/src/App.tsx?t=1') // no longer imports Broken
    s.write('src/App.tsx', comp('App', 'return 2'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    expect(await s.get('/@cresslet/last-error')).toBe('')

    await s.get('/src/Broken.tsx')
    expect(await s.get('/@cresslet/last-error')).toContain('Broken.tsx')
    s.write('index.html', '<script type="module" src="/src/main.ts"></script>\n')
    expect(upd(await s.next())).toBe('reload')
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('ignores directories and non-asset files outside the graph; unknown assets reload', async () => {
    const s = await devServer({ 'src/App.tsx': comp('App') })
    await s.get('/src/App.tsx')
    s.write('README.md', '# hi')
    s.write('.gitignore', 'node_modules')
    s.write('src/App.tsx.swp', 'x')
    s.vfs.mkdir(join(ROOT, 'src/newdir'), { recursive: true })
    expect(await s.quiet()).toEqual([])
    s.write('src/logo.svg', '<svg/>')
    expect(upd(await s.next())).toBe('reload')
  })

  /** Run `get(path)` with its transform held in flight while `during` runs; resolves to the served code. */
  const inFlight = async (s: Awaited<ReturnType<typeof devServer>>, path: string, during: () => Promise<unknown>) => {
    let release!: () => void
    gate.hold = new Promise((r) => (release = r))
    const built = gate.built
    const res = s.get(path)
    while (gate.built === built) await new Promise((r) => setTimeout(r, 5))
    await during()
    gate.hold = null
    release()
    return res
  }

  it('only jsx/tsx modules can be refresh boundaries (a .ts constants module is not)', async () => {
    const s = await devServer({
      'src/main.ts': "import App from './App'\n",
      'src/App.tsx': comp('App', 'return API_URL', "import { API_URL } from './constants'"),
      'src/constants.ts': "export const API_URL = '/a'\nexport enum Color { Red }\n",
    })
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/constants.ts']) await s.get(p)
    s.write('src/constants.ts', "export const API_URL = '/b'\nexport enum Color { Red }\n")
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('a module edited during its first transform still gets its graph node (later edits update)', async () => {
    const s = await devServer({ 'src/main.ts': "import Page from './Page'\n", 'src/Page.tsx': comp('Page', 'return App', "import App from './App'"), 'src/App.tsx': comp('App') })
    for (const p of ['/src/main.ts', '/src/Page.tsx']) await s.get(p)
    await inFlight(s, '/src/App.tsx', async () => {
      s.write('src/App.tsx', comp('App', 'return 1'))
      expect(upd(await s.next())).toEqual(['/src/Page.tsx']) // flush runs (bumps the generation) while the transform is held
    })
    s.write('src/App.tsx', comp('App', 'return 2'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('a change to a module whose first transform is in flight (no graph node yet) is not ignored', async () => {
    const s = await devServer({ 'src/App.tsx': comp('App') })
    await inFlight(s, '/src/App.tsx', async () => {
      s.write('src/App.tsx', comp('App', 'return 1'))
      expect(upd(await s.next())).toBe('reload') // the page is about to run the old code and nothing accepts the change
    })
  })

  it('a first transform finishing after a full reload does not leave an orphan boundary', async () => {
    const s = await devServer({
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': "import Widget from './Widget'\n",
      'src/Widget.tsx': comp('Widget'),
    })
    for (const p of ['/', '/src/main.ts']) await s.get(p)
    await inFlight(s, '/src/Widget.tsx', async () => {
      s.write('src/main.ts', 'export {}\n')
      expect(upd(await s.next())).toBe('reload')
      gate.hold = null // only the first Widget transform stays held
      for (const p of ['/', '/src/main.ts']) await s.get(p) // the reloaded page no longer imports Widget
    })
    s.write('src/Widget.tsx', comp('Widget', 'return 1'))
    expect(await s.quiet()).toEqual([])
  })

  it('an older transform finishing after a newer one does not overwrite its graph edges/accept', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App') })
    for (const p of ['/src/main.ts', '/src/App.tsx']) await s.get(p)
    s.write('src/App.tsx', 'export const helper = 1\n' + comp('App', 'return 1')) // v1: not a boundary
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    let release!: () => void
    gate.hold = new Promise((r) => (release = r))
    const built = gate.built
    const older = s.get('/src/App.tsx?t=1') // transforms v1, held
    while (gate.built === built) await new Promise((r) => setTimeout(r, 5))
    gate.hold = null
    s.write('src/App.tsx', comp('App', 'return 2')) // v2: a boundary again
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    await s.get('/src/App.tsx?t=2') // newer transform publishes first
    release()
    await older
    s.write('src/App.tsx', comp('App', 'return 3'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('an error from a stale transform is not published to last-error', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': 'export default function App( {\n' })
    await s.get('/src/main.ts')
    const code = await inFlight(s, '/src/App.tsx', async () => {
      s.write('src/App.tsx', comp('App'))
      await s.quiet()
    })
    expect(code).toContain('moduleError')
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('a stale successful transform does not clear a newer error', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App') })
    for (const p of ['/src/main.ts', '/src/App.tsx']) await s.get(p)
    s.write('src/App.tsx', comp('App', 'return 1'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    let release!: () => void
    gate.hold = new Promise((r) => (release = r))
    const built = gate.built
    const older = s.get('/src/App.tsx?t=1') // succeeds, held
    while (gate.built === built) await new Promise((r) => setTimeout(r, 5))
    gate.hold = null
    s.write('src/App.tsx', 'export default function App( {\n')
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
    expect(await s.get('/src/App.tsx?t=2')).toContain('moduleError')
    release()
    await older
    expect(await s.get('/@cresslet/last-error')).toContain('App.tsx')
  })

  it('an error from a transform started before a full reload is not published to last-error', async () => {
    const s = await devServer({ 'index.html': '<script type="module" src="/src/main.ts"></script>', 'src/main.ts': "import App from './App'\n", 'src/App.tsx': 'export default function App( {\n' })
    for (const p of ['/', '/src/main.ts']) await s.get(p)
    await inFlight(s, '/src/App.tsx', async () => {
      s.write('index.html', '<script type="module" src="/src/main.ts"></script>\n')
      expect(upd(await s.next())).toBe('reload')
    })
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('a plain .js constants module is not a boundary: edits hot-update through the importing component', async () => {
    const s = await devServer({
      'src/main.ts': "import App from './App'\n",
      'src/App.tsx': comp('App', 'return API_URL', "import { API_URL } from './constants.js'"),
      'src/constants.js': "export const API_URL = '/a'\n",
    })
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/constants.js']) await s.get(p)
    s.write('src/constants.js', "export const API_URL = '/b'\n")
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  // two transforms of different versions inside one debounce window (no flush between), the older finishing last
  const outOfOrder = async (s: Awaited<ReturnType<typeof devServer>>, v1: string, v2: string, v2Check: (code: string) => void) => {
    let release!: () => void
    gate.hold = new Promise((r) => (release = r))
    const built = gate.built
    s.write('src/App.tsx', v1)
    const older = s.get('/src/App.tsx') // transforms v1, held
    while (gate.built === built) await new Promise((r) => setTimeout(r, 5))
    gate.hold = null
    s.write('src/App.tsx', v2)
    v2Check(await s.get('/src/App.tsx')) // newer transform finishes first
    release()
    await older
  }

  it('an older transform within the debounce window does not restore obsolete edges/accept', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App') })
    for (const p of ['/src/main.ts', '/src/App.tsx']) await s.get(p)
    // v1: not a boundary; v2: a boundary again
    await outOfOrder(s, 'export const helper = 1\n' + comp('App', 'return 1'), comp('App', 'return 2'), () => {})
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('an older successful transform within the debounce window does not clear a newer error', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App') })
    for (const p of ['/src/main.ts', '/src/App.tsx']) await s.get(p)
    await outOfOrder(s, comp('App', 'return 1'), 'export default function App( {\n', (code) => expect(code).toContain('moduleError'))
    expect(await s.get('/@cresslet/last-error')).toContain('App.tsx')
  })

  it('a string containing "createElement(" does not make a .js module a boundary', async () => {
    const s = await devServer({
      'src/main.ts': "import App from './App'\n",
      'src/App.tsx': comp('App', 'return FormatTag', "import { FormatTag } from './format.js'"),
      'src/format.js': 'export function FormatTag() { return "createElement(" }\n',
    })
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/format.js']) await s.get(p)
    s.write('src/format.js', 'export function FormatTag() { return "createElement( " }\n')
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('detects entries after env substitution in index.html', async () => {
    const s = await devServer({ '.env': 'VITE_ENTRY=/src/App.tsx\n', 'index.html': '<script type="module" src="%VITE_ENTRY%"></script>', 'src/App.tsx': comp('App') })
    expect(await s.get('/')).toContain('src="/src/App.tsx"')
    await s.get('/src/App.tsx')
    s.write('src/App.tsx', comp('App', 'return 1'))
    expect(upd(await s.next())).toBe('reload')
  })

  it('a full reload resets the graph: a module that lost its last importer is no longer a boundary', async () => {
    const s = await devServer({
      'index.html': '<script type="module" src="/src/main.ts"></script>',
      'src/main.ts': "import Widget from './Widget'\n",
      'src/Widget.tsx': comp('Widget'),
    })
    for (const p of ['/', '/src/main.ts', '/src/Widget.tsx']) await s.get(p)
    s.write('src/main.ts', 'export {}\n')
    expect(upd(await s.next())).toBe('reload')
    for (const p of ['/', '/src/main.ts']) await s.get(p) // the reloaded page no longer imports Widget
    s.write('src/Widget.tsx', comp('Widget', 'return 1'))
    expect(await s.quiet()).toEqual([])
  })

  it('a served file outside the module graph (runtime fetch) reloads when changed', async () => {
    const s = await devServer({ 'src/App.tsx': comp('App'), 'src/data.json': '{"a":1}', 'src/other.json': '{}' })
    await s.get('/src/App.tsx')
    expect(await s.get('/src/data.json')).toBe('{"a":1}')
    s.write('src/other.json', '{"b":1}') // never served
    expect(await s.quiet()).toEqual([])
    s.write('src/data.json', '{"a":2}')
    expect(upd(await s.next())).toBe('reload')
  })

  it('a dynamic import() of the JSX runtime does not make a module a boundary', async () => {
    const s = await devServer({
      'src/main.ts': "import App from './App'\n",
      'src/App.tsx': comp('App', 'return Helper', "import { Helper } from './Helper.jsx'"),
      'src/Helper.jsx': 'export function Helper() { return import("react/jsx-runtime") }\n',
    })
    for (const p of ['/src/main.ts', '/src/App.tsx', '/src/Helper.jsx']) await s.get(p)
    s.write('src/Helper.jsx', 'export function Helper() { return import("react/jsx-runtime").then(() => 1) }\n')
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('a same-millisecond rewrite (unchanged mtime) is not served from the transform cache', async () => {
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App', 'return "v1"') })
    await s.get('/src/main.ts')
    const abs = join(ROOT, 'src/App.tsx')
    expect(await s.get('/src/App.tsx')).toContain('"v1"')
    const mtime = s.vfs.stat(abs).mtimeMs
    s.write('src/App.tsx', comp('App', 'return "v2"'))
    s.vfs.utimes(abs, mtime) // as if both writes landed in the same millisecond
    // requested inside the debounce window, before the flush drops the cache entry
    const code = await s.get('/src/App.tsx')
    expect(code).toContain('"v2"')
    expect(code).not.toContain('"v1"')
  })
})
