import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { readFileSync } from 'node:fs'
import { parseExports, refreshRuntimeModule, refreshTransform, refreshUtilsCode, REFRESH_RUNTIME_URL, REFRESH_UTILS_URL } from '../src/dev/refresh'
import { ModuleGraph } from '../src/dev/hmr'
import { SWAP_LINKS } from '../src/dev/client'

/** Same shape as the dev server's transform: bundle with every import external. */
async function esm(src: string, file = '/src/App.tsx'): Promise<string> {
  const r = await esbuild.build({
    stdin: { contents: src, loader: 'tsx', sourcefile: file },
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    sourcemap: 'inline',
    plugins: [{ name: 'ext', setup: (b) => b.onResolve({ filter: /.*/ }, (a) => ({ path: a.path, external: true })) }],
  })
  return r.outputFiles[0].text
}

const sigOf = (code: string, name: string) => {
  const m = new RegExp(`register\\(${name}, "[^"]+", ("(?:[^"\\\\]|\\\\.)*")`).exec(code)
  return m ? JSON.parse(m[1]) : undefined
}

describe('refreshTransform', () => {
  it('registers components with hook signatures and marks all-component modules as boundaries', async () => {
    const code = await esm(`import { useState, useEffect, memo } from 'react'
import { useThing } from './hooks'
export function Counter() {
  const [n, setN] = useState(0)
  useEffect(() => {}, [n])
  useThing()
  return <b>{n}</b>
}
const Inner = memo(() => <i />)
export default function App() { return <><Counter /><Inner /></> }
`)
    const r = refreshTransform(code, '/src/App.tsx')
    expect(r.boundary).toBe(true)
    expect(r.registered).toEqual(['Counter', 'Inner', 'App'])
    expect(sigOf(r.code, 'Counter')).toBe('const [n, setN] = useState(0);\nuseEffect\nuseThing')
    expect(r.code).toContain('register(Counter, "/src/App.tsx Counter"')
    expect(r.code).toContain('typeof useThing === "function" ? useThing : void 0')
    expect(sigOf(r.code, 'App')).toBe('')
    // registration goes before the inline source map, which must stay last
    expect(r.code.trimEnd().split('\n').pop()).toMatch(/^\/\/# sourceMappingURL=/)
    expect(r.code).toContain('import * as __cresslet_refresh from "/@cresslet/refresh"')
  })

  it('changing a useState initialiser changes the signature (remount), editing JSX does not', async () => {
    const v = (init: string, text: string) => esm(`import { useState } from 'react'\nexport default function App() { const [s] = useState(${init}); return <p>${text}{s}</p> }\n`)
    const a = sigOf(refreshTransform(await v('0', 'a'), 'x').code, 'App')
    expect(sigOf(refreshTransform(await v('0', 'b'), 'x').code, 'App')).toBe(a)
    expect(sigOf(refreshTransform(await v('1', 'a'), 'x').code, 'App')).not.toBe(a)
  })

  it('is not a boundary when the module also exports non-components', async () => {
    const r = refreshTransform(await esm(`export const helper = () => 1\nexport function Button() { return <button /> }\n`), 'x')
    expect(r.boundary).toBe(false)
    expect(r.registered).toEqual(['Button'])
  })

  it('leaves modules without components untouched', async () => {
    const code = await esm(`import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.body).render(<App />)\n`, '/src/main.tsx')
    expect(refreshTransform(code, 'x')).toEqual({ code, boundary: false, registered: [] })
  })

  it('signs custom hooks defined in the module', async () => {
    const r = refreshTransform(await esm(`import { useState } from 'react'\nexport function useCount() { return useState(0) }\nexport function C() { const [c] = useCount(); return c }\n`), 'x')
    expect(r.code).toMatch(/sign\(useCount, "return useState\(0\);"/)
    expect(r.boundary).toBe(false) // useCount isn't a component
  })

  it('signs hooks in hook-only modules (e.g. useCounter.ts)', async () => {
    const r = refreshTransform(await esm(`import { useState } from 'react'\nexport function useCounter() { const [n, setN] = useState(0); return [n, setN] }\n`, '/src/useCounter.ts'), '/src/useCounter.ts')
    expect(r.registered).toEqual([])
    expect(r.boundary).toBe(false)
    expect(r.code).toMatch(/\.sign\(useCounter, "const \[n, setN\] = useState\(0\);"/)
  })

  it('guards registrations (template-literal false matches) and avoids binding collisions', async () => {
    const code = await esm(`const __cresslet_refresh = 'mine'
export const help = \`
function Fake() {
var Other = 1
\`
export default function App() { return __cresslet_refresh + help }
`)
    const r = refreshTransform(code, '/src/App.tsx')
    expect(r.registered).toContain('Fake')
    // run it against a stub refresh module: the false matches must not throw, the user's binding is untouched
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__stubCalls = calls
    const stub = `export const register = (t, id) => globalThis.__stubCalls.push(id); export const sign = () => {}; export const exportsOf = () => {};`
    const runnable = r.code.replace(JSON.stringify(REFRESH_UTILS_URL), JSON.stringify('data:text/javascript,' + encodeURIComponent(stub)))
    const mod = await import('data:text/javascript,' + encodeURIComponent(runnable))
    expect(mod.default()).toContain('mine')
    expect(calls).toEqual(['/src/App.tsx App'])
  })

  it('emits the export shape of boundaries', async () => {
    const r = refreshTransform(await esm(`export function A() { return 1 }\nexport default function B() { return 2 }\n`), '/src/x.tsx')
    expect(r.code).toMatch(/\.exportsOf\("\/src\/x\.tsx", \{ "A": typeof A !== "undefined" \? A : void 0, "default": typeof B !== "undefined" \? B : void 0 \}\)/)
  })

  it('parseExports reads the export clause and rejects re-exports', () => {
    expect([...parseExports('var a=1;\nexport {\n  a,\n  B as default\n};\n')!]).toEqual([
      ['a', 'a'],
      ['default', 'B'],
    ])
    expect(parseExports('export * from "./x";\n')).toBe(null)
    expect(parseExports('export { a } from "./x";\n')).toBe(null)
    expect(parseExports('console.log(1)\n')!.size).toBe(0)
  })
})

describe('refresh runtime: export shape', () => {
  it('flags added/removed exports and a default that now maps to another component family', async () => {
    const g = globalThis as Record<string, unknown>
    g.window ??= globalThis
    const cjs = readFileSync(new URL('../node_modules/react-refresh/cjs/react-refresh-runtime.development.js', import.meta.url), 'utf8')
    const runtime = 'data:text/javascript,' + encodeURIComponent(refreshRuntimeModule(cjs))
    const rt = await import('data:text/javascript,' + encodeURIComponent(refreshUtilsCode().replace(JSON.stringify(REFRESH_RUNTIME_URL), JSON.stringify(runtime))))
    const comp = (name: string) => ({ [name]: () => null })[name]
    const load = (exportsByName: Record<string, string>) => {
      const mod: Record<string, unknown> = {}
      for (const [exp, local] of Object.entries(exportsByName)) {
        mod[exp] = comp(local)
        rt.register(mod[exp], `/m.tsx ${local}`, '', undefined)
      }
      rt.exportsOf('/m.tsx', mod)
      return rt.exportsChanged('/m.tsx')
    }
    expect(load({ default: 'App' })).toBe(false) // initial load
    expect(load({ default: 'App' })).toBe(false) // same shape, new function: hot-updatable
    expect(load({ default: 'Main' })).toBe(true) // default re-pointed to another component
    expect(load({ default: 'Main' })).toBe(false)
    expect(load({ default: 'Main', Extra: 'Extra' })).toBe(true) // export added
    expect(load({ default: 'Main' })).toBe(true) // export removed
    // unknown refresh family (unregistered component): a changed export value is a change
    const unreg = (mod: Record<string, unknown>) => (rt.exportsOf('/u.tsx', mod), rt.exportsChanged('/u.tsx'))
    const same = comp('Y')
    expect(unreg({ default: comp('X') })).toBe(false) // initial load
    expect(unreg({ default: same })).toBe(true)
    expect(unreg({ default: same })).toBe(false)
  })
})

describe('swapLinks (<link rel=stylesheet> HMR)', () => {
  type El = { href: string; parent: El[]; onload?: () => void; onerror?: () => void; cloneNode(): El; remove(): void; after(n: El): void; [k: string]: unknown }
  const swap = new Function(`${SWAP_LINKS}; return swapLinks`)() as (doc: unknown, pathname: string, href: string) => boolean
  function page() {
    const els: El[] = []
    const mk = (href: string): El => ({
      href,
      parent: els,
      cloneNode: () => mk(href),
      remove() {
        const i = els.indexOf(this)
        if (i >= 0) els.splice(i, 1)
      },
      after(n) {
        els.splice(els.indexOf(this) + 1, 0, n)
      },
    })
    els.push(mk('http://x/src/a.css'))
    const doc = { baseURI: 'http://x/', querySelectorAll: () => [...els] }
    return { els, doc }
  }

  it('keeps one pending replacement per link; removes the old one only after the replacement loads', () => {
    const { els, doc } = page()
    const [orig] = els
    expect(swap(doc, '/src/a.css', '/src/a.css?t=1')).toBe(true)
    expect(swap(doc, '/src/a.css', '/src/a.css?t=2')).toBe(true) // before t=1 loaded: supersedes it
    expect(els.map((e) => e.href)).toEqual(['http://x/src/a.css', '/src/a.css?t=2'])
    els[1].onload!()
    expect(els.map((e) => e.href)).toEqual(['/src/a.css?t=2'])
    expect(els.includes(orig)).toBe(false)
  })

  it('keeps the working stylesheet when the replacement fails', () => {
    const { els, doc } = page()
    swap(doc, '/src/a.css', '/src/a.css?t=1')
    els[1].onerror!()
    expect(els.map((e) => e.href)).toEqual(['http://x/src/a.css'])
    expect(swap(doc, '/src/a.css', '/src/a.css?t=2')).toBe(true) // and later edits still swap it
    expect(els.length).toBe(2)
  })

  it('returns false when the page has no such link', () => {
    expect(swap(page().doc, '/src/b.css', '/src/b.css?t=1')).toBe(false)
  })
})

describe('ModuleGraph.propagate', () => {
  const g = new ModuleGraph()
  g.setImports('/main.tsx', ['/App.tsx', '/index.css'])
  g.setImports('/App.tsx', ['/util.ts', '/a.module.css'])
  g.setImports('/util.ts', [])
  g.ensure('/App.tsx').accept = 'self'
  g.ensure('/index.css', 'css').accept = 'self'
  g.setImports('/index.css', ['/base.css'])
  g.ensure('/base.css', 'css')
  g.ensure('/linked.css', 'css').accept = 'link'
  g.ensure('/a.module.css', 'css')

  it('stops at the nearest accepting module and reports the chain to re-execute', () => {
    const r = g.propagate('/util.ts')!
    expect(r.updates).toEqual([{ kind: 'js', file: '/App.tsx' }])
    expect([...r.chain]).toEqual(['/util.ts', '/App.tsx'])
    expect(g.propagate('/a.module.css')!.updates).toEqual([{ kind: 'js', file: '/App.tsx' }])
  })

  it('css: self-accepting, through @import, and <link>', () => {
    expect(g.propagate('/index.css')!.updates).toEqual([{ kind: 'css', file: '/index.css' }])
    expect(g.propagate('/base.css')!.updates).toEqual([{ kind: 'css', file: '/index.css' }])
    expect(g.propagate('/linked.css')!.updates).toEqual([{ kind: 'css-link', file: '/linked.css' }])
  })

  it('returns null (full reload) when a path reaches an entry or an unknown module', () => {
    expect(g.propagate('/main.tsx')).toBe(null)
    expect(g.propagate('/nope.ts')).toBe(null)
    g.setImports('/main.tsx', ['/App.tsx', '/index.css', '/util.ts']) // util now also imported by the entry
    expect(g.propagate('/util.ts')).toBe(null)
  })

  it('setImports replaces old edges', () => {
    g.setImports('/main.tsx', ['/App.tsx'])
    expect(g.nodes.get('/index.css')!.importers.has('/main.tsx')).toBe(false)
  })
})

describe('ModuleGraph: entries, cycles, removal', () => {
  it('an HTML entry is never a boundary, even if it exports a component', () => {
    const g = new ModuleGraph()
    g.setImports('/App.tsx', ['/util.ts'])
    g.ensure('/App.tsx').accept = 'self'
    expect(g.propagate('/util.ts')!.updates).toEqual([{ kind: 'js', file: '/App.tsx' }])
    g.setEntries('/index.html', ['/App.tsx'])
    expect(g.propagate('/App.tsx')).toBe(null)
    expect(g.propagate('/util.ts')).toBe(null)
  })

  it('an importer cycle with no accepting module is a full reload, not a no-op', () => {
    const g = new ModuleGraph()
    g.setImports('/a.ts', ['/b.ts'])
    g.setImports('/b.ts', ['/a.ts'])
    expect(g.propagate('/a.ts')).toBe(null)
    g.setImports('/App.tsx', ['/a.ts'])
    g.ensure('/App.tsx').accept = 'self'
    expect(g.propagate('/a.ts')!.updates).toEqual([{ kind: 'js', file: '/App.tsx' }])
  })

  it('remove() drops the node and the edges pointing at it', () => {
    const g = new ModuleGraph()
    g.setImports('/main.tsx', ['/Old.tsx'])
    g.setImports('/Old.tsx', ['/util.ts'])
    g.remove('/Old.tsx')
    expect(g.nodes.has('/Old.tsx')).toBe(false)
    expect(g.nodes.get('/util.ts')!.importers.size).toBe(0)
    expect(g.nodes.get('/main.tsx')!.imports.size).toBe(0)
  })
})
