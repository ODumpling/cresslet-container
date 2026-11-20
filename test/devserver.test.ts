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
type CssBackend = import('../src/css/pipeline').CssBackend

const ROOT = '/__cresslet_test__/p'
let n = 0
const servers: { close(): void }[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
  gate.hold = null
})

type Msg = { type: string; updates?: { kind: string; url: string }[] }
const noCss = { restart() {}, process: async () => { throw new Error('no CSS worker in this test') } }
async function devServer(files: Record<string, string>, o: { deps?: Record<string, string>; css?: CssBackend } = {}) {
  const vfs = new VFS()
  const write = (p: string, s: string) => vfs.writeFile(join(ROOT, p), s, { mkdirp: true })
  write('package.json', JSON.stringify({ dependencies: { react: '*', 'react-dom': '*', ...o.deps } }))
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
    cssWorker: () => o.css ?? noCss,
    ports: { free: () => 5173, open: (_p: number, h: typeof handler) => ((handler = h), 'http://localhost/'), close() {} },
  }
  const server = await createDevServer(c as never, {})
  const msgs: Msg[] = []
  const bc = new BroadcastChannel(`cresslet:${id}:5173`)
  bc.onmessage = (e) => void msgs.push(e.data)
  servers.push(server, bc)
  const get = async (path: string) => (await handler(new Request('http://localhost' + path))).text()
  const res = async (path: string) => {
    const r = await handler(new Request('http://localhost' + path))
    return { type: r.headers.get('content-type') ?? '', text: await r.text() }
  }
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
  return { vfs, write, get, res, next, quiet, rm: (p: string) => vfs.rm(join(ROOT, p), { recursive: true }) }
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

describe('dev server CSS processing', () => {
  /** Stands in for Tailwind: emits the known utility candidates it was given; `BROKEN` in the CSS fails like a plugin. */
  const fakeTailwind = () => {
    const calls: string[][] = []
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        if (r.css.includes('BROKEN')) throw new Error('[postcss-fake] boom in ' + r.file)
        calls.push(r.candidates)
        const utils = r.candidates.filter((c) => /^(flex|underline|grid)$/.test(c)).sort()
        return { css: utils.map((u) => `.${u}{}`).join('\n'), deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [] }] }
      },
    }
    return { backend, calls }
  }
  const files = { 'src/main.ts': "import './index.css'\nimport App from './App'\n", 'src/App.tsx': comp('App', 'return "flex"'), 'src/index.css': '@import "tailwindcss";\n' }

  it('Tailwind: a source edit that adds classes hot-updates the stylesheet too; one that does not, only the component', async () => {
    const tw = fakeTailwind()
    const s = await devServer(files, { deps: { tailwindcss: '^4' }, css: tw.backend })
    await s.get('/src/main.ts')
    await s.get('/src/App.tsx')
    expect(await s.get('/src/index.css?import')).toMatch(/\.flex \{/)
    s.write('src/App.tsx', comp('App', 'return "flex underline"'))
    expect(upd(await s.next())).toEqual(expect.arrayContaining(['/src/index.css?import', '/src/App.tsx']))
    const css = await s.get('/src/index.css?import&t=1')
    expect(css).toMatch(/\.underline \{/)
    s.write('src/App.tsx', comp('App', 'return "underline flex"'))
    expect(upd(await s.next())).toEqual(['/src/App.tsx'])
  })

  it('non-CSS deps (configs) and content dirs (PostCSS dir-dependency, e.g. Tailwind v3) re-serve the stylesheet', async () => {
    const ROOT_ = '/__cresslet_test__/p'
    const backend: CssBackend = {
      restart() {},
      process: async (r) => ({ css: 'a{}', deps: [ROOT_ + '/tailwind.config.js', ROOT_ + '/src/theme.css', ROOT_ + '/src/App.tsx'], dirs: [ROOT_ + '/src/pages'], warnings: [], tailwind: [] }),
    }
    const s = await devServer({ ...files, 'postcss.config.js': 'export default {}', 'tailwind.config.js': 'export default {}', 'src/theme.css': 'b{}', 'src/pages/Home.tsx': comp('Home') }, { css: backend })
    await s.get('/src/main.ts')
    await s.get('/src/App.tsx')
    await s.get('/src/index.css?import')
    s.write('src/pages/Home.tsx', comp('Home', 'return "x"'))
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    s.write('tailwind.config.js', 'export default { x: 1 }')
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    s.write('src/theme.css', 'b{color:red}')
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    // a script dep doesn't become a CSS node: App still fast-refreshes as JS, and re-serves the stylesheet
    s.write('src/App.tsx', comp('App', 'return "y"'))
    const m = await s.next()
    expect(m.updates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'js', url: '/src/App.tsx' }), expect.objectContaining({ kind: 'css', url: '/src/index.css?import' })]))
  })

  it('Sass/Less: compiled by the worker in any project; imported, <link>ed, CSS modules and packages; partials join the CSS graph', async () => {
    let read: (p: string) => string | null = () => null
    const reqs: string[] = []
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        reqs.push(r.file)
        if (r.file === ROOT + '/src/main.scss') {
          const extra = read(ROOT + '/src/parts/_extra.scss')
          // what a missing import reports: the paths Sass tried
          if (r.css.includes('extra') && extra === null) throw Object.assign(new Error("Can't find stylesheet to import."), { deps: [ROOT + '/src/parts/_extra.scss', ROOT + '/src/parts/extra.scss'] })
          return { css: `.a { color: ${read(ROOT + '/src/_vars.scss')} }\n${extra ?? ''}`, deps: [ROOT + '/src/_vars.scss', ...(extra === null ? [] : [ROOT + '/src/parts/_extra.scss'])], dirs: [], warnings: [], tailwind: [] }
        }
        // as Less rewrites an imported file's url(): relative to the entry, without ./
        // and its plain-CSS imports: `@import "./parts/reset.css"` from an imported file comes out as `parts/reset.css`
        if (r.file.endsWith('.less') && !r.file.includes('module')) return { css: '@import "parts/reset.css";\n.l { background: url("img/dot.svg"); mask: url("img/dot.svg#m") }', deps: [], dirs: [], warnings: [], tailwind: [] }
        return { css: `.${r.file.split('/').pop()!.replace(/\W/g, '_')} { x: 1 }`, deps: [], dirs: [], warnings: [], tailwind: [] }
      },
    }
    const s = await devServer(
      {
        'index.html': '<link rel="stylesheet" href="/src/style.sass"><div id="root"></div><script type="module" src="/src/main.ts"></script>',
        'src/main.ts': "import './main.scss'\nimport 'kit/kit.scss'\nimport cls from './b.module.less'\nexport default cls\n",
        'src/main.scss': '@use "vars";\n',
        'src/_vars.scss': 'red',
        'src/b.module.less': '.x {}',
        'src/style.sass': '.y\n  a: b\n',
        'node_modules/kit/package.json': '{"name":"kit","version":"1.0.0"}',
        'node_modules/kit/kit.scss': '.k {}',
        'src/c.less': '@import "nested/x";',
        'src/img/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
        'src/parts/reset.css': '.reset { r: 1 }',
      },
      { css: backend },
    )
    read = (p) => s.vfs.tryReadText(p)
    const main = await s.get('/src/main.ts')
    for (const u of ['/src/main.scss?import', '/@modules/kit/kit.scss?import', '/src/b.module.less?import']) expect(main).toContain(u)
    expect(await s.get('/src/main.scss?import')).toContain('color: red')
    expect(await s.get('/@modules/kit/kit.scss?import')).toContain('.kit_scss')
    expect(await s.get('/src/b.module.less?import')).toMatch(/b_module_less/) // a CSS module: class names exported
    const less = await s.get('/src/c.less?import')
    expect(less).toContain('url(/src/img/dot.svg)') // url(img/dot.svg): relative first
    expect(less).toContain('.reset {') // @import "parts/reset.css": relative first, inlined
    expect(less).toContain('url(/src/img/dot.svg#m)') // its fragment kept
    const linked = await s.res('/src/style.sass')
    expect(linked.type).toContain('text/css')
    expect(linked.text).toContain('.style_sass')
    // a partial the output read: editing it hot-updates the entry
    s.write('src/_vars.scss', 'blue')
    expect(upd(await s.next())).toEqual(['/src/main.scss?import'])
    expect(await s.get('/src/main.scss?import&t=1')).toContain('color: blue')
    // a missing import: the error reaches the module; creating one of the tried paths hot-updates it
    s.write('src/main.scss', '@use "vars";\n@use "parts/extra";\n')
    expect(upd(await s.next())).toEqual(['/src/main.scss?import'])
    expect(await s.get('/src/main.scss?import&t=2')).toContain("Can't find stylesheet to import.")
    s.write('src/parts/_extra.scss', '.extra { z: 1 }')
    expect(upd(await s.next())).toEqual(['/src/main.scss?import'])
    expect(await s.get('/src/main.scss?import&t=3')).toContain('.extra')
    // the plain CSS the Less output imports: a CSS graph edge (editing it hot-updates the Less stylesheet)
    s.write('src/parts/reset.css', '.reset { r: 2 }')
    expect(upd(await s.next())).toEqual(['/src/c.less?import'])
    // <link>ed: swapped in place
    s.write('src/style.sass', '.y\n  a: c\n')
    expect(await s.next()).toMatchObject({ type: 'update', updates: [{ kind: 'css-link', url: '/src/style.sass' }] })
  })

  it('plain CSS in a Tailwind project skips the worker; projects without Tailwind/PostCSS never use it', async () => {
    const tw = fakeTailwind()
    const s = await devServer({ 'src/a.css': 'b { color: red }\n' }, { deps: { tailwindcss: '^4' }, css: tw.backend })
    expect(await s.get('/src/a.css?import')).toContain('color: red')
    const t = await devServer({ 'src/b.css': '@import "tailwindcss";\n' })
    expect(await t.get('/src/b.css?import')).toContain('tailwindcss') // untouched (no worker)
    expect(tw.calls).toHaveLength(0)
  })

  it('processing errors reach the overlay: imported CSS throws in its module, <link> CSS posts the error; fixing it hot-updates', async () => {
    const tw = fakeTailwind()
    const s = await devServer({ ...files, 'src/index.css': '@import "tailwindcss";\n/* BROKEN */\n' }, { deps: { tailwindcss: '^4' }, css: tw.backend })
    expect(await s.get('/src/index.css?import')).toContain('boom in')
    const next = s.next()
    expect(await s.get('/src/index.css')).toContain('boom in')
    expect(await next).toMatchObject({ type: 'error' })
    expect(await s.get('/@cresslet/last-error')).toContain('[postcss-fake] boom')
    s.write('src/index.css', '@import "tailwindcss";\n')
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    expect(await s.get('/src/index.css?import&t=1')).toMatch(/\.flex \{/)
  })

  it('a class added to index.html (full reload) is in the stylesheet the reloaded page gets, and so is one added before it asks', async () => {
    const tw = fakeTailwind()
    const s = await devServer({ ...files, 'index.html': '<div id="root"></div><script type="module" src="/src/main.ts"></script>' }, { deps: { tailwindcss: '^4' }, css: tw.backend })
    for (const p of ['/', '/src/main.ts', '/src/App.tsx']) await s.get(p)
    expect(await s.get('/src/index.css?import')).not.toMatch(/\.underline/)
    s.write('index.html', '<p class="underline">x</p><div id="root"></div><script type="module" src="/src/main.ts"></script>')
    expect(upd(await s.next())).toBe('reload')
    // the reloaded page hasn't requested the stylesheet yet (nothing tracks it): a source edit still counts
    s.write('src/App.tsx', comp('App', 'return "flex grid"'))
    await s.quiet()
    const css = await s.get('/src/index.css?import')
    expect(css).toMatch(/\.underline \{/)
    expect(css).toMatch(/\.grid \{/)
  })

  /** fakeTailwind whose candidate builds (`all`: every request) wait while `hold` is set. */
  const holdable = (all = false) => {
    const tw = fakeTailwind()
    const g = { hold: null as Promise<void> | null, builds: 0 }
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        if (all || !r.discover) {
          g.builds++
          if (g.hold) await g.hold
        }
        return tw.backend.process(r)
      },
    }
    const holdNext = () => {
      let release!: () => void
      g.hold = new Promise((r) => (release = r))
      const builds = g.builds
      return {
        started: async () => {
          while (g.builds === builds) await new Promise((r) => setTimeout(r, 5))
        },
        release: () => ((g.hold = null), release()),
      }
    }
    return { backend, holdNext, g }
  }

  it('a class added while the first stylesheet build is in flight is in what it serves', async () => {
    const h = holdable()
    const s = await devServer(files, { deps: { tailwindcss: '^4' }, css: h.backend })
    await s.get('/src/main.ts')
    await s.get('/src/App.tsx')
    const held = h.holdNext()
    const css = s.get('/src/index.css?import')
    await held.started()
    s.write('src/App.tsx', comp('App', 'return "flex underline"'))
    await new Promise((r) => setTimeout(r, 100))
    held.release()
    expect(await css).toMatch(/\.underline \{/)
  })

  it('a stylesheet edited during its first in-flight build is rebuilt, not lost (and no reload)', async () => {
    let builds = 0
    let hold: Promise<void> | null = null
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        if (!r.discover && hold && builds++ === 0) await hold
        return { css: r.css.includes('v2') ? '.v2{}' : '.v1{}', deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [] }] }
      },
    }
    const s = await devServer({ ...files, 'src/index.css': '@import "tailwindcss";\n/* v1 */\n' }, { deps: { tailwindcss: '^4' }, css: backend })
    await s.get('/src/main.ts')
    let release!: () => void
    hold = new Promise((r) => (release = r))
    const css = s.get('/src/index.css?import')
    while (!builds) await new Promise((r) => setTimeout(r, 5))
    s.write('src/index.css', '@import "tailwindcss";\n/* v2 */\n')
    const msgs = s.quiet()
    await new Promise((r) => setTimeout(r, 100))
    release()
    expect(await css).toContain('.v2')
    expect((await msgs).map(upd)).not.toContain('reload')
  })

  it('<link> CSS errors: cleared by a full reload and when the file is deleted; a build from the previous page does not report', async () => {
    const h = holdable(true)
    const s = await devServer({ ...files, 'index.html': '<link rel="stylesheet" href="/src/index.css">', 'src/index.css': '@import "tailwindcss";\n/* BROKEN */\n' }, { deps: { tailwindcss: '^4' }, css: h.backend })
    const e1 = s.next()
    await s.get('/src/index.css')
    expect(await e1).toMatchObject({ type: 'error' })
    expect(await s.get('/@cresslet/last-error')).toContain('boom')
    s.write('index.html', '<link rel="stylesheet" href="/src/index.css"> ')
    expect(upd(await s.next())).toBe('reload')
    expect(await s.get('/@cresslet/last-error')).toBe('')
    // a failing build still in flight when the page reloads: its error isn't the new page's
    const held = h.holdNext()
    const css = s.get('/src/index.css')
    await held.started()
    s.write('index.html', '<link rel="stylesheet" href="/src/index.css">  ')
    expect(upd(await s.next())).toBe('reload')
    held.release()
    await css
    expect(await s.get('/@cresslet/last-error')).toBe('')
    const e2 = s.next()
    await s.get('/src/index.css')
    expect(await e2).toMatchObject({ type: 'error' })
    expect(await s.get('/@cresslet/last-error')).toContain('boom')
    s.rm('src/index.css')
    await s.next()
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('a failed build records what it tried to read: creating a missing @import / @config target hot-updates the stylesheet', async () => {
    const ROOT_ = '/__cresslet_test__/p'
    const exists = { css: false, config: false }
    const backend: CssBackend = {
      restart() {},
      async process() {
        if (!exists.css || !exists.config) throw Object.assign(new Error("Can't resolve './missing.css'"), { deps: [ROOT_ + '/src/missing.css', ROOT_ + '/tailwind.config.js'] })
        return { css: '.ok{}', deps: [ROOT_ + '/src/missing.css', ROOT_ + '/tailwind.config.js'], dirs: [], warnings: [], tailwind: [] }
      },
    }
    const s = await devServer({ ...files, 'src/index.css': '@import "tailwindcss";\n@import "./missing.css";\n@config "../tailwind.config.js";\n' }, { deps: { tailwindcss: '^4' }, css: backend })
    await s.get('/src/main.ts')
    expect(await s.get('/src/index.css?import')).toContain("Can't resolve")
    exists.css = true
    s.write('src/missing.css', '.m{}')
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    expect(await s.get('/src/index.css?import&t=1')).toContain("Can't resolve")
    exists.config = true
    s.write('tailwind.config.js', 'export default {}')
    expect(upd(await s.next())).toEqual(['/src/index.css?import'])
    expect(await s.get('/src/index.css?import&t=2')).toContain('.ok')
  })

  it('a failing <link> build in flight when its directory is deleted does not report afterwards', async () => {
    const h = holdable(true)
    const s = await devServer({ ...files, 'index.html': '<link rel="stylesheet" href="/src/styles/index.css">', 'src/styles/index.css': '@import "tailwindcss";\n/* BROKEN */\n' }, { deps: { tailwindcss: '^4' }, css: h.backend })
    const held = h.holdNext()
    const css = s.get('/src/styles/index.css')
    await held.started()
    s.rm('src/styles')
    held.release()
    await css
    await s.quiet()
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('a failing <link> build in flight when the stylesheet itself is deleted does not report afterwards', async () => {
    const h = holdable(true)
    const s = await devServer({ ...files, 'index.html': '<link rel="stylesheet" href="/src/index.css">', 'src/index.css': '@import "tailwindcss";\n/* BROKEN */\n' }, { deps: { tailwindcss: '^4' }, css: h.backend })
    const held = h.holdNext()
    const css = s.get('/src/index.css')
    await held.started()
    s.rm('src/index.css')
    held.release()
    await css
    expect((await s.quiet()).filter((m) => m.type === 'error')).toEqual([])
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('a failed CSS Module keeps what it tried to read: creating the missing @import updates its importer', async () => {
    const ROOT_ = '/__cresslet_test__/p'
    let exists = false
    const backend: CssBackend = {
      restart() {},
      async process() {
        if (!exists) throw Object.assign(new Error("Can't resolve './missing.css'"), { deps: [ROOT_ + '/src/missing.css'] })
        return { css: '.ok{}', deps: [ROOT_ + '/src/missing.css'], dirs: [], warnings: [], tailwind: [] }
      },
    }
    const s = await devServer({ 'src/main.ts': "import App from './App'\n", 'src/App.tsx': comp('App', 'return s.ok', "import s from './a.module.css'"), 'src/a.module.css': '@import "./missing.css";\n.ok { color: red }\n', 'postcss.config.js': 'module.exports = {}' }, { css: backend })
    await s.get('/src/main.ts')
    await s.get('/src/App.tsx')
    expect(await s.get('/src/a.module.css?import')).toContain("Can't resolve")
    exists = true
    s.write('src/missing.css', '.m{}')
    expect(upd(await s.next())).not.toEqual([])
  })

  it('<link> CSS errors are cleared when a directory holding the stylesheet is deleted', async () => {
    const tw = fakeTailwind()
    const s = await devServer({ ...files, 'index.html': '<link rel="stylesheet" href="/src/styles/index.css">', 'src/styles/index.css': '/* BROKEN */\n', 'postcss.config.js': 'module.exports = {}' }, { css: tw.backend })
    const e = s.next()
    await s.get('/src/styles/index.css')
    expect(await e).toMatchObject({ type: 'error' })
    expect(await s.get('/@cresslet/last-error')).toContain('boom')
    s.rm('src/styles')
    await s.quiet()
    expect(await s.get('/@cresslet/last-error')).toBe('')
  })

  it('closing the dev server releases its CSS worker state', async () => {
    const tw = fakeTailwind()
    const released: string[] = []
    const sessions = new Set<string>()
    const backend: CssBackend = { ...tw.backend, process: (r) => (sessions.add(r.session!), tw.backend.process(r)), release: (x) => void released.push(x) }
    const s = await devServer(files, { deps: { tailwindcss: '^4' }, css: backend })
    await s.get('/src/index.css?import')
    for (const x of servers.splice(0)) x.close()
    expect(released).toEqual([...sessions])
  })
})

