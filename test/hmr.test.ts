import { describe, expect, it } from 'vitest'
import * as esbuild from 'esbuild'
import { parseExports, refreshTransform } from '../src/dev/refresh'
import { ModuleGraph } from '../src/dev/hmr'

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
