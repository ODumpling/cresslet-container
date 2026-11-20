import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VFS } from '../src/vfs'
import { CandidateScanner, extractCandidates, globToRegExp } from '../src/css/scan'
import { CssPipeline, detectCssMode, TAILWIND_RE, type CssRequest, type CssResult } from '../src/css/pipeline'

// The CSS worker script is plain CommonJS: run it in real Node against the repo's tailwindcss/postcss/autoprefixer.
const worker = createRequire(import.meta.url)('../src/css/worker.cjs') as {
  handle(req: Partial<CssRequest>): Promise<CssResult>
  TAILWIND_RE: RegExp
  exportTarget(exp: unknown, sub: string): string | null
}
const repoModules = fileURLToPath(new URL('../node_modules', import.meta.url))

/** A temp project: the repo's packages linked into node_modules, plus `files` (fake packages go in node_modules/). */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cresslet-css-'))
  mkdirSync(join(dir, 'node_modules'))
  for (const p of ['tailwindcss', 'postcss', 'autoprefixer']) symlinkSync(join(repoModules, p), join(dir, 'node_modules', p))
  for (const [p, s] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), s)
  }
  return dir
}

describe('candidate extraction', () => {
  it('finds classes in JSX, cn() calls, template literals and arbitrary values', () => {
    const c = extractCandidates(`<div className="flex p-4 hover:bg-sky-500/50">
      <p className={cn('text-lg', active && "font-bold", \`mt-\${n} md:grid-cols-[1fr_2fr]\`)} />
      <i className="w-[calc(100%-1rem)] !p-2 [&>*]:underline bg-(--brand)" />`)
    for (const k of ['flex', 'p-4', 'hover:bg-sky-500/50', 'text-lg', 'font-bold', 'md:grid-cols-[1fr_2fr]', 'w-[calc(100%-1rem)]', '!p-2', '[&>*]:underline', 'bg-(--brand)']) expect(c).toContain(k)
  })

  it('strips trailing punctuation', () => {
    const c = extractCandidates('use flex, grid. or (block) <p>italic</p>')
    expect(c).toContain('flex')
    expect(c).toContain('grid')
    expect(c).toContain('block')
    expect(c).toContain('italic')
  })

  it('globs', () => {
    expect(globToRegExp('/a/**/*.{ts,tsx}').test('/a/b/c/x.tsx')).toBe(true)
    expect(globToRegExp('/a/**/*.{ts,tsx}').test('/a/x.ts')).toBe(true)
    expect(globToRegExp('/a/*.ts').test('/a/b/x.ts')).toBe(false)
  })
})

describe('CandidateScanner', () => {
  const vfs = () => {
    const v = new VFS()
    const w = (p: string, s: string) => v.writeFile('/p/' + p, s, { mkdirp: true })
    w('src/App.tsx', '<div className="flex p-4" />')
    w('node_modules/lib/index.js', '"from-node-modules"')
    w('dist/a.js', '"from-dist"')
    w('src/index.css', '.from-css {}')
    w('lib/ui.js', '"from-lib"')
    return v
  }

  it('auto-detects from the root, skipping node_modules, dist and css', () => {
    const s = new CandidateScanner(vfs(), '/p')
    s.addSources(null, [])
    const all = s.all()
    expect(all).toContain('flex')
    expect(all).toContain('from-lib')
    expect(all).not.toContain('from-node-modules')
    expect(all).not.toContain('from-dist')
    expect(all).not.toContain('.from-css')
  })

  it('explicit @source reaches node_modules; source(none) + negated sources', () => {
    const v = vfs()
    const s = new CandidateScanner(v, '/p')
    expect(s.addSources('none', [{ base: '/p/src', pattern: '../node_modules/lib', negated: false }])).toBe(true)
    expect(s.all()).toEqual(['from-node-modules'])
    const t = new CandidateScanner(v, '/p')
    t.addSources(null, [{ base: '/p', pattern: 'lib', negated: true }])
    expect(t.all()).not.toContain('from-lib')
  })

  it('update() reports only new candidates', () => {
    const v = vfs()
    const s = new CandidateScanner(v, '/p')
    s.addSources(null, [])
    s.all()
    v.writeFile('/p/src/App.tsx', '<div className="p-4 flex" />')
    expect(s.update('/p/src/App.tsx')).toBe(false)
    v.writeFile('/p/src/App.tsx', '<div className="p-4 flex text-red-500" />')
    expect(s.update('/p/src/App.tsx')).toBe(true)
    v.writeFile('/p/node_modules/lib/index.js', '"new-thing"')
    expect(s.update('/p/node_modules/lib/index.js')).toBe(false)
  })
})

describe('CSS mode', () => {
  it('detects tailwind deps and PostCSS configs; the regex matches Tailwind syntax only', () => {
    const v = new VFS()
    v.writeFile('/p/package.json', JSON.stringify({ devDependencies: { tailwindcss: '^4' } }), { mkdirp: true })
    expect(detectCssMode(v, '/p')).toEqual({ postcssConfig: null, tailwind: true })
    v.writeFile('/p/postcss.config.mjs', 'export default {}')
    expect(detectCssMode(v, '/p').postcssConfig).toBe('/p/postcss.config.mjs')
    expect(TAILWIND_RE.source).toBe(worker.TAILWIND_RE.source)
    for (const css of ['@import "tailwindcss";', "@import 'tailwindcss/utilities.css' layer(utilities);", '.a { @apply flex; }', '@theme { --x: 1 }', '@tailwind utilities;', '.a { margin: --spacing(2) }']) expect(TAILWIND_RE.test(css)).toBe(true)
    for (const css of ['body { color: red }', '@import "./other.css";', '@media (min-width: 1px) {}']) expect(TAILWIND_RE.test(css)).toBe(false)
  })

  it('pipeline: plain CSS skips the worker; Tailwind gets candidates and re-builds when @source widens the scan', async () => {
    const v = new VFS()
    v.writeFile('/p/package.json', JSON.stringify({ dependencies: { tailwindcss: '^4' } }), { mkdirp: true })
    v.writeFile('/p/src/App.tsx', '<b className="flex" />', { mkdirp: true })
    v.writeFile('/p/lib/x.js', '"underline"', { mkdirp: true })
    v.writeFile('/p/node_modules/ui/a.js', '"italic"', { mkdirp: true })
    const reqs: CssRequest[] = []
    const backend = {
      restart() {},
      async process(r: CssRequest): Promise<CssResult> {
        reqs.push(r)
        return { css: r.candidates.sort().join(' '), deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [{ base: '/p/src', pattern: '../node_modules/ui', negated: false }] }] }
      },
    }
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    expect((await p.process('/p/src/a.css', 'body{}')).css).toBe('body{}')
    expect(reqs).toHaveLength(0)
    const r = await p.process('/p/src/index.css', '@import "tailwindcss";')
    expect(reqs).toHaveLength(2)
    expect(reqs[0].candidates).not.toContain('italic')
    expect(r.css.split(' ')).toEqual(expect.arrayContaining(['flex', 'underline', 'italic']))
    expect(r.content).toBe(true)
    await p.process('/p/src/index.css', '@import "tailwindcss";')
    expect(reqs).toHaveLength(3) // sources already known: one request
  })
})

describe('CSS worker (real tailwindcss / postcss / autoprefixer)', () => {
  it('exports: style condition first', () => {
    expect(worker.exportTarget({ '.': { types: './a.d.ts', style: './index.css', import: './x.mjs' } }, '.')).toBe('./index.css')
    expect(worker.exportTarget({ './*': { style: './dist/*.css' } }, './theme')).toBe('./dist/theme.css')
  })

  it('Tailwind v4: @import "tailwindcss" + candidates -> utilities, theme from an imported file', async () => {
    const dir = project({ 'src/index.css': '@import "tailwindcss";\n@import "./theme.css";\n', 'src/theme.css': '@theme { --color-brand: #123456; }\n' })
    const file = join(dir, 'src/index.css')
    const req = { root: dir, file, css: '@import "tailwindcss";\n@import "./theme.css";\n', candidates: ['flex', 'p-4', 'text-brand', 'hover:bg-red-500', 'not-a-class'] }
    const r = await worker.handle(req)
    expect(r.css).toMatch(/\.flex\s*\{\s*display: flex/)
    expect(r.css).toContain('.text-brand')
    expect(r.css).toContain('--color-brand: #123456')
    expect(r.css).toContain('.hover\\:bg-red-500')
    expect(r.css).not.toContain('not-a-class')
    expect(r.tailwind).toEqual([{ root: null, sources: [] }])
    expect(r.deps).toContain(join(dir, 'src/theme.css'))
    expect(r.deps.some((d) => d.endsWith('tailwindcss/index.css'))).toBe(true)
    // an imported file changed: recompiled
    writeFileSync(join(dir, 'src/theme.css'), '@theme { --color-brand: #abcdef; }\n')
    utimesSync(join(dir, 'src/theme.css'), new Date(), new Date(Date.now() + 5000))
    expect((await worker.handle(req)).css).toContain('--color-brand: #abcdef')
  })

  it('Tailwind v4: relative url()s in @imported files are rebased to the importing stylesheet', async () => {
    const dir = project({ 'src/sub/x.css': '.a { background: url(./img.png) } .b { background: url("../up.png") }\n' })
    const r = await worker.handle({ root: dir, file: join(dir, 'src/index.css'), css: '@import "tailwindcss/utilities.css";\n@import "./sub/x.css";\n', candidates: [] })
    expect(r.css).toContain('url(./sub/img.png)')
    expect(r.css).toContain('url("./up.png")')
  })

    it('Tailwind v4: reports source(none) / @source', async () => {
    const dir = project({})
    const r = await worker.handle({ root: dir, file: join(dir, 'src/a.css'), css: '@import "tailwindcss" source(none);\n@source "../lib";\n', candidates: [] })
    expect(r.tailwind[0].root).toBe('none')
    expect(r.tailwind[0].sources).toEqual([{ base: join(dir, 'src'), pattern: '../lib', negated: false }])
  })

  it('PostCSS config: autoprefixer runs; @tailwindcss/postcss is replaced by the built-in compiler', async () => {
    const dir = project({
      'postcss.config.cjs': "module.exports = { plugins: { '@tailwindcss/postcss': {}, autoprefixer: { overrideBrowserslist: ['safari 8'] } } }\n",
    })
    const r = await worker.handle({ root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss/utilities.css";\n.a { display: flex }\n', candidates: ['grid'], postcssConfig: join(dir, 'postcss.config.cjs') })
    expect(r.css).toContain('display: -webkit-flex')
    expect(r.css).toMatch(/\.grid\s*\{\s*display: -ms-grid;|\.grid\s*\{[^}]*display: grid/)
    expect(r.tailwind).toHaveLength(1)
  })

  it('a config that imports @tailwindcss/postcss gets the built-in stand-in (the real one needs native oxide)', async () => {
    const dir = project({
      'node_modules/@tailwindcss/postcss/package.json': JSON.stringify({ name: '@tailwindcss/postcss', main: 'index.js' }),
      'node_modules/@tailwindcss/postcss/index.js': "throw new Error('Cannot find native binding')\n",
      'postcss.config.cjs': "const tailwindcss = require('@tailwindcss/postcss')\nmodule.exports = { plugins: [tailwindcss()] }\n",
    })
    const r = await worker.handle({ root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss";\n', candidates: ['italic'], postcssConfig: join(dir, 'postcss.config.cjs') })
    expect(r.css).toMatch(/\.italic\s*\{\s*font-style: italic/)
  })

  it('PostCSS config errors name the plugin', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: { 'postcss-does-not-exist': {} } }\n" })
    await expect(worker.handle({ root: dir, file: join(dir, 'a.css'), css: 'a{}', postcssConfig: join(dir, 'postcss.config.cjs') })).rejects.toThrow(/PostCSS plugin 'postcss-does-not-exist' can't be loaded/)
  })
})
