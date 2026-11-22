import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs'
import { spawn as spawnProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VFS } from '../src/vfs'
import { CandidateScanner, extractCandidates, globToRegExp } from '../src/css/scan'
import { CssPipeline, detectCssMode, nodeCssBackend, PREPROCESSED_RE, TAILWIND_RE, type CssBackend, type CssRequest, type CssResult, type CssWorkerSpawn } from '../src/css/pipeline'

// The CSS worker script is plain CommonJS: run it in real Node against the repo's tailwindcss/postcss/autoprefixer.
const workerPath = fileURLToPath(new URL('../src/css/worker.cjs', import.meta.url))
const worker = createRequire(import.meta.url)('../src/css/worker.cjs') as {
  handle(req: Partial<CssRequest> & { candidatesReset?: boolean }): Promise<CssResult>
  release(session: string): void
  TAILWIND_RE: RegExp
  exportTarget(exp: unknown, sub: string): string | null
  rebaseUrls(css: string, fromDir: string, toDir: string, o?: { sass?: boolean; indented?: boolean }): string
  sassTiers(p: string, fromImport: boolean): string[][]
  PREPROCESSED_RE: RegExp
}
const repoModules = fileURLToPath(new URL('../node_modules', import.meta.url))

/** A temp project: the repo's packages linked into node_modules, plus `files` (fake packages go in node_modules/). */
function project(files: Record<string, string>, packages = ['tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less']): string {
  const dir = mkdtempSync(join(tmpdir(), 'cresslet-css-'))
  mkdirSync(join(dir, 'node_modules'))
  for (const p of packages) symlinkSync(join(repoModules, p), join(dir, 'node_modules', p))
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

  it('auto-detects from the root, skipping node_modules, dist and css', async () => {
    const all = await new CandidateScanner(vfs(), '/p').all()
    expect(all).toContain('flex')
    expect(all).toContain('from-lib')
    expect(all).not.toContain('from-node-modules')
    expect(all).not.toContain('from-dist')
    expect(all).not.toContain('.from-css')
  })

  it('explicit @source reaches node_modules; source(none) + negated sources', async () => {
    const v = vfs()
    expect(await new CandidateScanner(v, '/p', [{ root: 'none', sources: [{ base: '/p/src', pattern: '../node_modules/lib', negated: false }] }]).all()).toEqual(['from-node-modules'])
    expect(await new CandidateScanner(v, '/p', [{ root: null, sources: [{ base: '/p', pattern: 'lib', negated: true }] }]).all()).not.toContain('from-lib')
    expect(await new CandidateScanner(v, '/p', [{ root: { base: '/p', pattern: 'lib' }, sources: [] }]).all()).toEqual(['from-lib'])
  })

  it('dist/build/out/coverage are skipped only at the scope root; node_modules and dot-dirs at any depth', async () => {
    const v = vfs()
    const w = (p: string, s: string) => v.writeFile('/p/' + p, s, { mkdirp: true })
    w('build/x.js', '"root-build"')
    w('src/build/x.js', '"nested-build"')
    w('src/out/x.js', '"nested-out"')
    w('src/node_modules/x.js', '"nested-nm"')
    w('src/.cache/x.js', '"nested-dot"')
    const s = new CandidateScanner(v, '/p')
    const all = await s.all()
    expect(all).toEqual(expect.arrayContaining(['nested-build', 'nested-out']))
    for (const k of ['root-build', 'nested-nm', 'nested-dot', 'from-dist']) expect(all).not.toContain(k)
    // update() applies the same rules
    w('src/build/y.js', '"nested-build-2"')
    expect(s.update('/p/src/build/y.js')).toBe(true)
    w('build/y.js', '"root-build-2"')
    expect(s.update('/p/build/y.js')).toBe(false)
    w('src/node_modules/y.js', '"nested-nm-2"')
    expect(s.update('/p/src/node_modules/y.js')).toBe(false)
  })

  it('does not follow directory symlinks into ancestors or loops; other symlinks are followed', async () => {
    const v = vfs()
    v.symlink('/p', '/p/src/up') // ancestor
    v.symlink('.', '/p/src/self') // loop
    v.symlink('/', '/p/src/rootfs') // above the scope
    v.writeFile('/shared/ui.js', '"from-shared"', { mkdirp: true })
    v.symlink('/shared', '/p/src/shared')
    v.symlink('/shared/ui.js', '/p/src/ui-link.js')
    const all = await new CandidateScanner(v, '/p').all()
    expect(all).toEqual(expect.arrayContaining(['flex', 'from-shared']))
    expect(all).not.toContain('from-node-modules')
  })

  it('checks a file size before reading it', async () => {
    const v = vfs()
    v.writeFile('/p/src/huge.js', new Uint8Array(2_000_001).fill(0x61))
    const read: string[] = []
    const orig = v.tryReadText.bind(v)
    v.tryReadText = (p: string) => (read.push(p), orig(p))
    await new CandidateScanner(v, '/p').all()
    expect(read).toContain('/p/src/App.tsx')
    expect(read).not.toContain('/p/src/huge.js')
  })

  it('yields to the event loop while walking a large tree', async () => {
    const v = new VFS()
    for (let i = 0; i < 300; i++) v.writeFile(`/p/src/d${i % 10}/f${i}.js`, `"c-${i}"`, { mkdirp: true })
    let t = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 5))
    try {
      let ticked = false
      setTimeout(() => (ticked = true), 0)
      const scan = new CandidateScanner(v, '/p').all()
      const all = await scan
      expect(ticked).toBe(true)
      expect(all).toHaveLength(300)
    } finally {
      spy.mockRestore()
    }
  })

  it('source("./src/"): a trailing slash scopes the same directory, for the scan and for updates', async () => {
    const v = vfs()
    const s = new CandidateScanner(v, '/p', [{ root: { base: '/p', pattern: './src/' }, sources: [{ base: '/p', pattern: 'lib/', negated: false }] }])
    expect(await s.all()).toContain('flex')
    v.writeFile('/p/src/App.tsx', '<div className="later" />')
    expect(s.update('/p/src/App.tsx')).toBe(true)
    v.writeFile('/p/lib/ui.js', '"lib-later"')
    expect(s.update('/p/lib/ui.js')).toBe(true)
  })

  it('a symlink loop (ELOOP) is skipped, not fatal to the scan', async () => {
    const v = vfs()
    v.symlink('/p/src/b', '/p/src/a')
    v.symlink('/p/src/a', '/p/src/b')
    expect(() => v.isFile('/p/src/a')).toThrow()
    expect(await new CandidateScanner(v, '/p').all()).toContain('flex')
  })

  it('update() reports only new candidates; it applies once the scan has started', async () => {
    const v = vfs()
    const s = new CandidateScanner(v, '/p')
    expect(s.update('/p/src/App.tsx')).toBe(false) // not scanning yet: the scan reads it
    let t = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 5)) // the walk yields after each entry
    const scan = s.all()
    v.writeFile('/p/src/App.tsx', '<div className="p-4 flex mid-scan" />')
    expect(s.update('/p/src/App.tsx')).toBe(true)
    expect(await scan).toContain('mid-scan')
    spy.mockRestore()
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
    expect(detectCssMode(v, '/p', false).postcssConfig).toBe(null) // cssPlugins: false
    expect(TAILWIND_RE.source).toBe(worker.TAILWIND_RE.source)
    for (const css of ['@import "tailwindcss";', "@import 'tailwindcss/utilities.css' layer(utilities);", '.a { @apply flex; }', '@theme { --x: 1 }', '@tailwind utilities;', '.a { margin: --spacing(2) }']) expect(TAILWIND_RE.test(css)).toBe(true)
    for (const css of ['body { color: red }', '@import "./other.css";', '@media (min-width: 1px) {}']) expect(TAILWIND_RE.test(css)).toBe(false)
  })

  /** A backend that answers like the worker: each stylesheet's rules come from a `rules` map (by file). */
  const fakeBackend = (rules: Record<string, CssResult['tailwind']>) => {
    const reqs: CssRequest[] = []
    const backend = {
      restart() {},
      async process(r: CssRequest): Promise<CssResult> {
        reqs.push(r)
        return { css: r.discover ? '' : [...r.candidates].sort().join(' '), deps: [], dirs: [], warnings: [], tailwind: rules[r.file] ?? [] }
      },
    }
    return { reqs, backend }
  }
  const tailwindProject = () => {
    const v = new VFS()
    v.writeFile('/p/package.json', JSON.stringify({ dependencies: { tailwindcss: '^4' } }), { mkdirp: true })
    v.writeFile('/p/src/App.tsx', '<b className="flex" />', { mkdirp: true })
    v.writeFile('/p/lib/x.js', '"underline"', { mkdirp: true })
    v.writeFile('/p/node_modules/ui/a.js', '"italic"', { mkdirp: true })
    return v
  }

  it('pipeline: plain CSS skips the worker; source rules are discovered before the first candidate build', async () => {
    const v = tailwindProject()
    const { reqs, backend } = fakeBackend({ '/p/src/index.css': [{ root: 'none', sources: [{ base: '/p/src', pattern: '../node_modules/ui', negated: false }] }] })
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    expect((await p.process('/p/src/a.css', 'body{}')).css).toBe('body{}')
    expect(reqs).toHaveLength(0)
    const r = await p.process('/p/src/index.css', '@import "tailwindcss" source(none);')
    expect(reqs.map((q) => q.discover)).toEqual([true, false])
    // source(none): only the @source dir, from the very first build
    expect(r.css).toBe('italic')
    expect(reqs[1].candidateSet).toMatch(new RegExp('^' + p.session + ':'))
    expect(r.scanner).not.toBeNull()
    await p.process('/p/src/index.css', '@import "tailwindcss" source(none);')
    expect(reqs).toHaveLength(3) // rules known for this text: one request
  })

  it('pipeline: stylesheets with different source rules get separate candidate sets; updates report the grown ones', async () => {
    const v = tailwindProject()
    const { backend } = fakeBackend({
      '/p/a.css': [{ root: null, sources: [{ base: '/p', pattern: 'lib', negated: true }] }],
      '/p/b.css': [{ root: { base: '/p', pattern: 'lib' }, sources: [] }],
    })
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    const a = await p.process('/p/a.css', '@import "tailwindcss";')
    const b = await p.process('/p/b.css', '@import "tailwindcss" source("../lib");')
    expect(a.css.split(' ')).toContain('flex')
    expect(a.css.split(' ')).not.toContain('underline')
    expect(b.css).toBe('underline')
    v.writeFile('/p/lib/x.js', '"underline grid"')
    expect(p.update('/p/lib/x.js')).toEqual([b.scanner])
    expect(p.revision).toBe(1)
    v.writeFile('/p/src/App.tsx', '<b className="flex italic" />')
    expect(p.update('/p/src/App.tsx')).toEqual([a.scanner])
  })

  it('pipeline: rules that change with the stylesheet (or its imports) are re-discovered', async () => {
    const v = tailwindProject()
    const rules: Record<string, CssResult['tailwind']> = { '/p/a.css': [{ root: null, sources: [] }] }
    const { reqs, backend } = fakeBackend(rules)
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    await p.process('/p/a.css', '@import "tailwindcss";')
    rules['/p/a.css'] = [{ root: 'none', sources: [{ base: '/p', pattern: 'lib', negated: false }] }] // an @import'ed file added these
    const r = await p.process('/p/a.css', '@import "tailwindcss";')
    expect(r.css).toBe('underline')
    expect(reqs.slice(2).map((q) => q.discover)).toEqual([false, false])
    expect(reqs[2].candidateSet).not.toBe(reqs[3].candidateSet)
  })

  it('pipeline: a request cut off by resets (a config renamed) is sent again with the current config', async () => {
    const v = tailwindProject()
    v.writeFile('/p/postcss.config.js', 'module.exports = {}')
    const reqs: CssRequest[] = []
    const waiting: ((e: Error) => void)[] = []
    const backend: CssBackend = {
      restart: () => void waiting.splice(0).forEach((f) => f(Object.assign(new Error('CSS worker restarted'), { restarted: true }))),
      process: (r) => (reqs.push(r), r.postcssConfig === '/p/postcss.config.cjs' ? Promise.resolve({ css: 'ok', deps: [], dirs: [], warnings: [], tailwind: [] }) : new Promise((_, rej) => waiting.push(rej))),
    }
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    const out = p.process('/p/a.css', '@import "tailwindcss";')
    await new Promise((r) => setTimeout(r, 0))
    v.rename('/p/postcss.config.js', '/p/postcss.config.cjs')
    p.reset() // the old name's event
    p.reset() // the new name's
    expect((await out).css).toBe('ok')
    expect(reqs.at(-1)!.postcssConfig).toBe('/p/postcss.config.cjs')
  })

  it('pipeline: a reset during the candidate scan prepares the request again under the new mode', async () => {
    const v = tailwindProject()
    for (let i = 0; i < 20; i++) v.writeFile(`/p/src/f${i}.js`, '"flex"')
    let t = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 5)) // the scan yields after each entry
    const reqs: CssRequest[] = []
    let p!: CssPipeline
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        reqs.push(r)
        if (r.discover) setTimeout(() => (v.writeFile('/p/package.json', '{}'), p.reset()), 0) // Tailwind removed mid-scan
        return { css: 'built', deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [] }] }
      },
    }
    p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    try {
      expect((await p.process('/p/a.css', '@import "tailwindcss";')).css).toBe('@import "tailwindcss";')
      expect(reqs.map((q) => q.discover)).toEqual([true])
    } finally {
      spy.mockRestore()
    }
  })

  it('pipeline: resets that keep landing during the scan give up instead of sending stale candidates', async () => {
    const v = tailwindProject()
    for (let i = 0; i < 40; i++) v.writeFile(`/p/src/f${i}.js`, '"flex"')
    let t = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 5))
    const reqs: CssRequest[] = []
    let p!: CssPipeline
    const timer = setInterval(() => p.reset(), 0) // Tailwind stays on: every attempt is cut off mid-scan
    const backend: CssBackend = {
      restart() {},
      async process(r) {
        reqs.push(r)
        return { css: 'built', deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [] }] }
      },
    }
    p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    try {
      await expect(p.process('/p/a.css', '@import "tailwindcss";')).rejects.toThrow(/kept changing/)
      expect(reqs.every((q) => q.discover)).toBe(true)
    } finally {
      clearInterval(timer)
      spy.mockRestore()
    }
  })

  it('pipeline: warm rules, then a reset during every scan: the fourth restart throws before any stale build is sent', async () => {
    const v = tailwindProject()
    const { reqs, backend } = fakeBackend({ '/p/a.css': [{ root: null, sources: [] }] })
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    await p.process('/p/a.css', '@import "tailwindcss";') // rules known now
    const before = reqs.length
    const spy = vi.spyOn(CandidateScanner.prototype, 'all').mockImplementation(async () => (p.reset(), []))
    try {
      await expect(p.process('/p/a.css', '@import "tailwindcss";')).rejects.toThrow(/kept changing/)
      expect(spy).toHaveBeenCalledTimes(4)
      expect(reqs.slice(before).map((q) => q.discover)).toEqual([true, true, true])
    } finally {
      spy.mockRestore()
    }
  })

  it('pipeline: released while a discovery request runs, it sends no build (nothing recreates its worker state)', async () => {
    const v = tailwindProject()
    let release!: () => void
    const reqs: CssRequest[] = []
    const backend: CssBackend = {
      restart() {},
      release() {},
      process: (r) => (reqs.push(r), new Promise((res) => (release = () => res({ css: '', deps: [], dirs: [], warnings: [], tailwind: [{ root: null, sources: [] }] })))),
    }
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    const out = p.process('/p/a.css', '@import "tailwindcss";')
    await new Promise((r) => setTimeout(r, 0))
    p.release()
    release()
    await expect(out).rejects.toThrow(/closed/)
    expect(reqs.map((q) => q.discover)).toEqual([true])
  })

  it('pipeline: cssPlugins: false ignores PostCSS configs and tells the worker not to run plugins', async () => {
    const v = tailwindProject()
    v.writeFile('/p/postcss.config.js', 'module.exports = {}')
    const { reqs, backend } = fakeBackend({})
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend, cssPlugins: false }, '/p', 'development')
    expect(p.mode.postcssConfig).toBe(null)
    await p.process('/p/a.css', '@import "tailwindcss";')
    expect(reqs[0]).toMatchObject({ postcssConfig: null, plugins: false })
  })
})

describe('Sass/Less in the pipeline', () => {
  it('Sass/Less always go to the worker (no Tailwind, no PostCSS config); plain CSS still skips it', async () => {
    const v = new VFS()
    v.writeFile('/p/package.json', JSON.stringify({ devDependencies: { sass: '*', less: '*' } }), { mkdirp: true })
    const reqs: CssRequest[] = []
    const backend = { restart() {}, process: async (r: CssRequest): Promise<CssResult> => (reqs.push(r), { css: 'compiled', deps: [], dirs: [], warnings: [], tailwind: [] }) }
    const p = new CssPipeline({ vfs: v, cssWorker: () => backend }, '/p', 'development')
    expect((await p.process('/p/src/a.css', 'a{}')).css).toBe('a{}')
    for (const f of ['/p/src/a.scss', '/p/src/b.sass', '/p/src/c.less', '/p/src/d.module.scss']) expect((await p.process(f, '$x: 1;')).css).toBe('compiled')
    expect(reqs.map((r) => [r.file, r.discover, r.tailwind])).toEqual(['/p/src/a.scss', '/p/src/b.sass', '/p/src/c.less', '/p/src/d.module.scss'].map((f) => [f, false, false]))
    expect(PREPROCESSED_RE.source).toBe(worker.PREPROCESSED_RE.source)
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

  it('url() rebasing: unquoted, quoted, spaces, package CSS; absolute/data:/#/protocol-relative untouched', () => {
    const css = [
      '.a { background: url(img.png) }',
      '.b { background: url( "../up dir/x.png?v=1#f" ) }',
      ".c { background: url('./q.svg') }",
      '.d { background: url(/abs.png), url(data:image/png;base64,AA==), url(#grad), url(//cdn.example/x.png), url(https://x.test/y.png) }',
      '/* url(./in-comment.png) */ .e { content: "url(./in-string.png)" }',
      '@import url("./nested.css");',
    ].join('\n')
    const out = worker.rebaseUrls(css, '/p/node_modules/pkg/dist', '/p/src')
    expect(out).toContain('url(../node_modules/pkg/dist/img.png)')
    expect(out).toContain('url("../node_modules/pkg/up dir/x.png?v=1#f")')
    expect(out).toContain("url('../node_modules/pkg/dist/q.svg')")
    expect(out).toContain('url(/abs.png), url(data:image/png;base64,AA==), url(#grad), url(//cdn.example/x.png), url(https://x.test/y.png)')
    expect(out).toContain('url(./in-comment.png)')
    expect(out).toContain('"url(./in-string.png)"')
    expect(out).toContain('@import url("./nested.css");')
    // an unquoted result that needs quoting gets it
    expect(worker.rebaseUrls('.a{background:url(a.png)}', '/p/my dir', '/p')).toBe('.a{background:url("./my dir/a.png")}')
    // CSS escapes: hex code points (one trailing space eaten) and escaped spaces, quoted or not
    expect(worker.rebaseUrls('.a{background:url("./asset\\20 name.svg")}', '/p/d', '/p')).toBe('.a{background:url("./d/asset name.svg")}')
    expect(worker.rebaseUrls('.a{background:url(./asset\\ name.svg)}', '/p/d', '/p')).toBe('.a{background:url("./d/asset name.svg")}')
    expect(worker.rebaseUrls('.a{background:url(./\\31 x.svg)}', '/p/d', '/p')).toBe('.a{background:url(./d/1x.svg)}')
    // control characters are written back as escapes (a raw newline would end the string)
    expect(worker.rebaseUrls('.a{background:url("./a\\a b.svg")}', '/p/d', '/p')).toBe('.a{background:url("./d/a\\a b.svg")}')
    expect(worker.rebaseUrls('.a{background:url(./a\\d b.svg)}', '/p/d', '/p')).toBe('.a{background:url("./d/a\\d b.svg")}')
  })

  it('a failed compile reports what it tried to read: a missing @import / @config target', async () => {
    const dir = project({})
    const file = join(dir, 'src/a.css')
    const err = await worker.handle({ root: dir, file, css: '@import "tailwindcss";\n@import "./missing.css";\n', candidates: [] }).then(() => null, (e) => e)
    expect(err.deps).toContain(join(dir, 'src/missing.css'))
    const err2 = await worker.handle({ root: dir, file, css: '@import "tailwindcss";\n@config "../tailwind.config.js";\n', candidates: [] }).then(() => null, (e) => e)
    expect(err2.deps).toContain(join(dir, 'tailwind.config.js'))
    // creating it: the next request compiles
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src/missing.css'), '.made { color: red }\n')
    expect((await worker.handle({ root: dir, file, css: '@import "tailwindcss";\n@import "./missing.css";\n', candidates: [] })).css).toContain('.made')
  })

  it('discovery: reports the source rules without building utilities', async () => {
    const dir = project({})
    const r = await worker.handle({ root: dir, file: join(dir, 'd.css'), css: '@import "tailwindcss" source(none);\n@source not "./legacy";\n', candidates: ['flex'], discover: true, session: 's-disc' })
    expect(r.css).toBe('')
    expect(r.tailwind[0]).toEqual({ root: 'none', sources: [{ base: dir, pattern: './legacy', negated: true }] })
  })

  it('candidate sets: requests carry deltas the worker accumulates; a different set (new rules) gets a fresh compiler; release drops a session', async () => {
    const dir = project({})
    const file = join(dir, 'a.css')
    const base = { root: dir, file, css: '@import "tailwindcss/utilities.css";\n', session: 's1' }
    expect((await worker.handle({ ...base, candidateSet: 's1:1', candidates: ['flex'] })).css).toMatch(/\.flex/)
    const r = await worker.handle({ ...base, candidateSet: 's1:1', candidates: ['underline'] })
    expect(r.css).toMatch(/\.flex/)
    expect(r.css).toMatch(/\.underline/)
    const other = await worker.handle({ ...base, candidateSet: 's1:2', candidates: ['italic'] })
    expect(other.css).toMatch(/\.italic/)
    expect(other.css).not.toMatch(/\.underline/)
    worker.release('s1')
    expect((await worker.handle({ ...base, candidateSet: 's1:1', candidates: ['grid'] })).css).not.toMatch(/\.flex/)
  })

  it('a production session starts fresh (no dev classes) and config/plugins see NODE_ENV=production', async () => {
    const dir = project({
      'postcss.config.cjs': "module.exports = (ctx) => ({ plugins: [{ postcssPlugin: 'env', Once(root) { root.append({ text: 'env:' + ctx.env + ':' + process.env.NODE_ENV }) } }] })\n",
    })
    const file = join(dir, 'a.css')
    const req = { root: dir, file, css: '@import "tailwindcss/utilities.css";\n', postcssConfig: join(dir, 'postcss.config.cjs'), tailwind: true }
    const dev = await worker.handle({ ...req, session: 'dev', candidateSet: 'dev:1', candidates: ['underline'], env: 'development' })
    expect(dev.css).toMatch(/\.underline/)
    expect(dev.css).toContain('env:development:development')
    const prod = await worker.handle({ ...req, session: 'prod-1', candidateSet: 'prod-1:1', candidates: ['flex'], env: 'production' })
    expect(prod.css).toMatch(/\.flex/)
    expect(prod.css).not.toMatch(/\.underline/)
    expect(prod.css).toContain('env:production:production')
  })

  it('PostCSS config without a Tailwind plugin in a Tailwind v4 project: v4 compiles, then the config plugins', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: { autoprefixer: { overrideBrowserslist: ['safari 8'] } } }\n" })
    const req = { root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss/utilities.css";\n', candidates: ['flex'], postcssConfig: join(dir, 'postcss.config.cjs') }
    const r = await worker.handle({ ...req, tailwind: true })
    expect(r.css).toContain('display: -webkit-flex')
    expect(r.tailwind).toHaveLength(1)
    // not a Tailwind project: the config's plugins only
    const dir2 = project({ 'postcss.config.cjs': "module.exports = { plugins: { autoprefixer: {} } }\n" })
    expect((await worker.handle({ ...req, root: dir2, file: join(dir2, 'a.css'), postcssConfig: join(dir2, 'postcss.config.cjs') })).tailwind).toHaveLength(0)
  })

  it('staleness by content (same size and mtime), plugin helpers reload on recompile, plugin instances are cached with the config', async () => {
    const dir = project({
      'src/theme.css': '@theme { --color-brand: #111111; }\n',
      'src/plugin.cjs': "const h = require('./helper.cjs')\nmodule.exports = function ({ addBase }) { addBase({ ':root': { '--helper': h.value } }) }\n",
      'src/helper.cjs': "module.exports = { value: 'one' }\n",
      'postcss.config.cjs': "globalThis.__made = 0\nmodule.exports = { plugins: [ (() => { globalThis.__made++; return { postcssPlugin: 'count' } })() ] }\n",
    })
    const file = join(dir, 'src/index.css')
    const css = '@import "tailwindcss/theme.css" layer(theme);\n@import "./theme.css";\n@plugin "./plugin.cjs";\n.x { color: var(--color-brand) }\n'
    const req = { root: dir, file, css, candidates: [], postcssConfig: join(dir, 'postcss.config.cjs'), tailwind: true, session: 'st' }
    expect((await worker.handle(req)).css).toContain('#111111')
    const theme = join(dir, 'src/theme.css')
    const st = statSync(theme)
    writeFileSync(theme, '@theme { --color-brand: #222222; }\n')
    utimesSync(theme, st.atime, st.mtime)
    expect((await worker.handle(req)).css).toContain('#222222')
    writeFileSync(join(dir, 'src/helper.cjs'), "module.exports = { value: 'two' }\n")
    expect((await worker.handle({ ...req, css: css + '/* edit */\n' })).css).toContain('--helper: two')
    expect((globalThis as { __made?: number }).__made).toBe(1)
  })

  it('discovery stops at the Tailwind plugin: later PostCSS plugins never see its empty output', async () => {
    const dir = project({
      'postcss.config.cjs': "module.exports = { plugins: [require('@tailwindcss/postcss'), { postcssPlugin: 'needs-rules', Once(root) { if (!root.toString().trim()) throw new Error('empty input') } }] }\n",
      'node_modules/@tailwindcss/postcss/package.json': '{"name":"@tailwindcss/postcss","main":"index.js"}',
      'node_modules/@tailwindcss/postcss/index.js': 'module.exports = () => ({ postcssPlugin: "real" })\n',
    })
    const base = { root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss";\n', postcssConfig: join(dir, 'postcss.config.cjs'), tailwind: true, session: 's-d5' }
    const d = await worker.handle({ ...base, candidates: [], discover: true })
    expect(d.tailwind).toHaveLength(1)
    expect((await worker.handle({ ...base, candidates: ['flex'] })).css).toMatch(/\.flex/)
  })

  it('a failed directory @import records <dir>/index.css as attempted', async () => {
    const dir = project({})
    const err = await worker.handle({ root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss";\n@import "./theme";\n', candidates: [] }).then(() => null, (e) => e)
    expect(err.deps).toEqual(expect.arrayContaining([join(dir, 'theme'), join(dir, 'theme.css'), join(dir, 'theme/index.css')]))
    const err2 = await worker.handle({ root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss";\n@import "./theme.dark";\n', candidates: [] }).then(() => null, (e) => e)
    expect(err2.deps).toEqual(expect.arrayContaining([join(dir, 'theme.dark'), join(dir, 'theme.dark.css'), join(dir, 'theme.dark/index.css')]))
  })

  it('a package that reads NODE_ENV when loaded sees the build\'s mode', async () => {
    const dir = project({
      'postcss.config.cjs': "module.exports = { plugins: [require('envplug')] }\n",
      'node_modules/envplug/index.js': 'const env = process.env.NODE_ENV\nmodule.exports = { postcssPlugin: "envplug", Once(root) { root.append({ text: "env:" + env }) } }\n',
    })
    const req = { root: dir, file: join(dir, 'a.css'), css: 'a{}', candidates: [], postcssConfig: join(dir, 'postcss.config.cjs') }
    expect((await worker.handle({ ...req, env: 'development' })).css).toContain('env:development')
    expect((await worker.handle({ ...req, env: 'production' })).css).toContain('env:production')
    // and back: plugins from before the switch never meet the reloaded postcss (instanceof checks hold)
    const dir2 = project({ 'postcss.config.cjs': "const postcss = require('postcss')\nmodule.exports = { plugins: [{ postcssPlugin: 'inst', Once(root) { if (!(root instanceof postcss.Root)) throw new Error('mixed postcss instances') } }] }\n" })
    const req2 = { root: dir2, file: join(dir2, 'a.css'), css: 'a{}', candidates: [], postcssConfig: join(dir2, 'postcss.config.cjs') }
    for (const env of ['development', 'production', 'development'] as const) expect((await worker.handle({ ...req2, env })).css).toContain('a{}')
  })

  it('plugins: false (boot({ cssPlugins: false })): @plugin / @config are refused, Tailwind core compiles', async () => {
    const dir = project({ 'src/plugin.cjs': 'module.exports = () => {}\n' })
    const file = join(dir, 'src/a.css')
    await expect(worker.handle({ root: dir, file, css: '@import "tailwindcss";\n@plugin "./plugin.cjs";\n', candidates: [], plugins: false })).rejects.toThrow(/@plugin '.\/plugin.cjs' not loaded: project CSS plugins are disabled/)
    expect((await worker.handle({ root: dir, file, css: '@import "tailwindcss";\n', candidates: ['flex'], plugins: false })).css).toMatch(/\.flex/)
  })
})

describe('CSS worker: Sass / Less (real sass / less)', () => {
  it('SCSS: partials from other dirs, variables, nesting; url()s in partials rebased, url($var) left to Sass', async () => {
    const dir = project({
      'src/styles/_vars.scss': '@import "./reset.css";\n$brand: #123456;\n$img: "./x.png";\n.from-partial { background: url(./bg.png); mask: url($img); }\n',
      'src/styles/_index.scss': '@forward "vars";\n',
    })
    const file = join(dir, 'src/main.scss')
    const r = await worker.handle({ root: dir, file, css: '@use "sass:math";\n@use "styles" as s;\n.a { color: s.$brand; .b { width: math.div(10px, 2); } }\n', candidates: [] })
    expect(r.css).toContain('.a {\n  color: #123456;')
    expect(r.css).toContain('.a .b {\n  width: 5px;')
    expect(r.css).toContain('url(./styles/bg.png)')
    expect(r.css).toContain('url("./x.png")') // a variable's value: as Sass emits it (relative to the entry)
    expect(r.css).toContain('@import "./styles/reset.css";') // plain CSS Sass passes through, from the partial's dir
    expect(r.deps).toEqual(expect.arrayContaining([join(dir, 'src/styles/_index.scss'), join(dir, 'src/styles/_vars.scss')]))
    expect(r.tailwind).toEqual([])
  })

  it('the indented syntax (.sass), and .css loaded by Sass', async () => {
    const dir = project({ 'src/lib/_mix.sass': '=box($w)\n  width: $w\n', 'src/lib/plain.css': '@import "./reset.css";\n.plain { color: red; background: url(./p.png) }\n', 'src/lib/_c.sass': '@import "./d"  // the d partial\n', 'src/lib/_d.sass': '.d\n  a: 1\n' })
    const r = await worker.handle({ root: dir, file: join(dir, 'src/a.sass'), css: '@use "lib/mix" as *\n@use "lib/plain"\n@import "lib/c"\n.a\n  +box(3px)\n', candidates: [] })
    expect(r.css).toContain('@import "./lib/reset.css";') // the loaded .css's own import, from its dir
    // SCSS: a media query on the next line; a bare `x.css` beside the partial (not a package)
    writeFileSync(join(dir, 'src/lib/beside.css'), '.b {}')
    writeFileSync(join(dir, 'src/lib/theme.css'), '.t {}')
    writeFileSync(join(dir, 'src/lib/_q.scss'), '@import "./print"\n  print;\n@import "beside.css";\n@import "kit/x.css";\n@import url(beside.css) print;\n@import url("kit/y.css");\n@import "theme" screen;\n')
    const q = await worker.handle({ root: dir, file: join(dir, 'src/b.scss'), css: '@use "lib/q";\n', candidates: [] })
    expect(q.css).toContain('@import "./lib/print" print;')
    expect(q.css).toContain('@import "./lib/beside.css";')
    expect(q.css).toContain('@import "kit/x.css";') // a package specifier
    expect(q.css).toContain('@import url(./lib/beside.css) print;')
    expect(q.css).toContain('@import url("kit/y.css");') // a package specifier in url()
    expect(q.css).toContain('@import "./lib/theme" screen;') // theme.css beside it
    expect(r.css).toContain('.d {') // a commented Sass import in a partial still resolves
    expect(r.css).toContain('.a {\n  width: 3px;')
    expect(r.css).toContain('.plain {')
    expect(r.css).toContain('url(./lib/p.png)')
  })

  it('package paths resolve from node_modules (also ~pkg); @import finds .import files first', async () => {
    const dir = project({
      'node_modules/kit/scss/_colors.scss': '$kit: rgb(1, 2, 3);\n',
      'node_modules/kit/package.json': '{"name":"kit"}',
      'src/_theme.scss': '.theme { a: 1 }\n',
      'src/_theme.import.scss': '.theme-import { a: 1 }\n',
    })
    const file = join(dir, 'src/a.scss')
    const r = await worker.handle({ root: dir, file, css: '@use "kit/scss/colors";\n@use "~kit/scss/colors" as c2;\n.a { color: colors.$kit; }\n', candidates: [] })
    expect(r.css).toContain('color: rgb(1, 2, 3);')
    expect(r.deps).toContain(join(dir, 'node_modules/kit/scss/_colors.scss'))
    // a package's own dependency, nested in its node_modules; a package's warnings stay quiet
    mkdirSync(join(dir, 'node_modules/kit/node_modules/dep'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/kit/node_modules/dep/_index.scss'), '$dep: 4px;\n')
    writeFileSync(join(dir, 'node_modules/kit/scss/_uses-dep.scss'), '@use "dep";\n@warn "from the package";\n.kit { width: dep.$dep; }\n')
    const nested = await worker.handle({ root: dir, file, css: '@use "kit/scss/uses-dep";\n@warn "from the project";\n', candidates: [] })
    expect(nested.css).toContain('width: 4px;')
    expect(nested.warnings.join('\n')).toContain('from the project')
    expect(nested.warnings.join('\n')).not.toContain('from the package')
    // a bare package: its package.json `sass` entry (as `@use "bootstrap"` in vite)
    mkdirSync(join(dir, 'node_modules/boot/scss'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/boot/package.json'), '{"name":"boot","sass":"scss/boot.scss"}')
    writeFileSync(join(dir, 'node_modules/boot/scss/boot.scss'), '.boot { a: 1 }\n')
    expect((await worker.handle({ root: dir, file, css: '@use "boot";\n', candidates: [] })).css).toContain('.boot {')
    const imp = await worker.handle({ root: dir, file, css: '@import "theme";\n', candidates: [] })
    expect(imp.css).toContain('.theme-import')
    expect((await worker.handle({ root: dir, file, css: '@use "theme";\n', candidates: [] })).css).toMatch(/\.theme \{/)
  })

  it('a missing Sass import fails with Sass\'s message and reports the paths it tried (creating one retries)', async () => {
    const dir = project({ 'src/_ok.scss': '.ok { a: 1 }\n' })
    const file = join(dir, 'src/a.scss')
    const e = await worker.handle({ root: dir, file, css: '@use "ok";\n@use "parts/missing";\n', candidates: [] }).then(() => null, (x) => x)
    expect(e.message).toContain("Can't find stylesheet to import")
    for (const p of ['src/parts/_missing.scss', 'src/parts/missing.scss', 'src/parts/missing/_index.scss', 'src/_ok.scss']) expect(e.deps).toContain(join(dir, p))
    // a `../` or absolute load that misses never falls back to node_modules (or what `node_modules/..` is)
    writeFileSync(join(dir, '_vars.scss'), '.root-vars { a: 1 }')
    mkdirSync(join(dir, 'node_modules/nope'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/nope/_index.scss'), '.pkg { a: 1 }')
    for (const css of ['@use "../vars";', '@use "../../nope";', `@use "${join(dir, 'src/nope')}";`])
      await expect(worker.handle({ root: dir, file: join(dir, 'src/sub/a.scss'), css, candidates: [] })).rejects.toThrow(/Can't find stylesheet to import/)
    const syntax = await worker.handle({ root: dir, file, css: '.a { color: ; }\n', candidates: [] }).then(() => null, (x) => x)
    expect(syntax.message).toMatch(/Expected expression/)
  })

  it('Sass output goes on to Tailwind (plain-CSS @import of tailwindcss, @apply) and to a PostCSS config', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: { autoprefixer: { overrideBrowserslist: ['safari 8'] } } }\n", 'src/lib/_tw.scss': '@import "tailwindcss/utilities.css";\n' })
    const file = join(dir, 'src/a.scss')
    // the Tailwind import from a partial in another dir: a package specifier, not rebased
    const tw = await worker.handle({ root: dir, file, css: '@use "lib/tw";\n$pad: 4px;\n.btn { padding: $pad * 2; @apply flex; }\n', candidates: ['grid'], tailwind: true })
    expect(tw.css).toMatch(/\.btn \{\s*padding: 8px;\s*display: flex;/)
    expect(tw.css).toMatch(/\.grid\s*\{\s*display: grid/)
    const pc = await worker.handle({ root: dir, file, css: '$d: flex;\n.a { display: $d; }\n', candidates: [], postcssConfig: join(dir, 'postcss.config.cjs') })
    expect(pc.css).toContain('display: -webkit-flex')
    // Tailwind syntax in a project without Tailwind: left as Sass emitted it
    expect((await worker.handle({ root: dir, file, css: '.a { @apply flex; }\n', candidates: [], tailwind: false })).css).toContain('@apply flex')
  })

  it('Less: imports from other dirs (url()s rewritten), deps, errors with file:line, a missing import reports what it tried', async () => {
    const dir = project({ 'src/styles/vars.less': '@brand: #654321;\n.from-import { background: url("./bg.png"); }\n' })
    const file = join(dir, 'src/main.less')
    const r = await worker.handle({ root: dir, file, css: '@import "styles/vars";\n.a { color: @brand; .b { width: (10px / 2); } }\n', candidates: [] })
    expect(r.css).toContain('color: #654321;')
    expect(r.css).toContain('.a .b {\n  width: 5px;')
    expect(r.css).toContain('url("./styles/bg.png")')
    expect(r.deps).toContain(join(dir, 'src/styles/vars.less'))
    const syntax = await worker.handle({ root: dir, file, css: '.a {\n  color: @nope;\n}\n', candidates: [] }).then(() => null, (x) => x)
    expect(syntax.message).toContain(`${file}:2:10: variable @nope is undefined`)
    expect(syntax.message).toContain('   2 |   color: @nope;')
    const missing = await worker.handle({ root: dir, file, css: '@import "parts/missing";\n', candidates: [] }).then(() => null, (x) => x)
    expect(missing.message).toContain("wasn't found")
    expect(missing.deps).toContain(join(dir, 'src/parts/missing.less'))
    // an error after imports loaded keeps them as deps (the fix may go in one); a missing (optional) import is one too
    const late = await worker.handle({ root: dir, file, css: '@import "styles/vars";\n@import (optional) "./opt";\n.a { color: @undefined-here; }\n', candidates: [] }).then(() => null, (x) => x)
    expect(late.deps).toEqual(expect.arrayContaining([join(dir, 'src/styles/vars.less'), join(dir, 'src/opt.less')]))
    const opt = await worker.handle({ root: dir, file, css: '@import (optional) "./opt";\n.a { b: 1 }\n', candidates: [] })
    expect(opt.deps).toContain(join(dir, 'src/opt.less'))
    // a file data-uri() inlines is a dep too
    writeFileSync(join(dir, 'src/dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const inlined = await worker.handle({ root: dir, file, css: '.a { background: data-uri("dot.svg"); }\n', candidates: [] })
    expect(inlined.css).toContain('data:image/svg+xml')
    expect(inlined.deps).toContain(join(dir, 'src/dot.svg'))
  })

  it('Less @plugin runs project code: loaded normally, refused with plugins: false; inline JavaScript stays off', async () => {
    const dir = project({ 'src/plugin.js': "module.exports = { install(less, pm, functions) { functions.add('twice', (n) => new less.tree.Dimension(n.value * 2, n.unit)) } }\n" })
    const file = join(dir, 'src/a.less')
    const css = '@plugin "./plugin";\n.a { width: twice(3px); }\n'
    expect((await worker.handle({ root: dir, file, css, candidates: [] })).css).toContain('width: 6px;')
    await expect(worker.handle({ root: dir, file, css, candidates: [], plugins: false })).rejects.toThrow(/@plugin '.\/plugin' not loaded: project CSS plugins are disabled/)
    await expect(worker.handle({ root: dir, file, css: '.a { width: `1 + 1`px; }\n', candidates: [] })).rejects.toThrow(/Inline JavaScript is not enabled/)
  })

  it('a project without the compiler says which package to install', async () => {
    const dir = project({}, [])
    await expect(worker.handle({ root: dir, file: join(dir, 'a.scss'), css: '.a{}', candidates: [] })).rejects.toThrow(/a\.scss needs the `sass` package \(npm install -D sass\)/)
    await expect(worker.handle({ root: dir, file: join(dir, 'a.less'), css: '.a{}', candidates: [] })).rejects.toThrow(/a\.less needs the `less` package \(npm install -D less\)/)
  })

  it('url() rebasing for Sass source: variables and interpolation are left alone; an indented @import ends at its line', () => {
    const r = (css: string, o = { sass: true }) => worker.rebaseUrls(css, '/p/src/a', '/p/src', o)
    expect(r('.x { a: url(./i.png); b: url($v); c: url("#{$d}/i.png"); d: url("img/#{$n}.png"); }')).toBe('.x { a: url(./a/i.png); b: url($v); c: url("#{$d}/i.png"); d: url("img/#{$n}.png"); }')
    expect(r('@import foo\n.x\n  a: url(./i.png)\n', { sass: true, indented: true } as never)).toBe('@import foo\n.x\n  a: url(./a/i.png)\n')
    // Sass: `//` comments are skipped; a plain-CSS `@import "x.css"` (left in Sass's output) is rebased, Sass's own imports aren't
    expect(r('.x {\n  // @import "note"\n  a: url(./i.png);\n}\n@import "./reset.css";\n@import "theme";\n@import url(./u.css) screen;\n@import url(v.css);\n')).toBe('.x {\n  // @import "note"\n  a: url(./a/i.png);\n}\n@import "./a/reset.css";\n@import "theme";\n@import url(./a/u.css) screen;\n@import url(v.css);\n') // (no v.css beside it: a package)
    // a media query makes it plain CSS; a package specifier and Sass's own (comma-separated) imports are left alone
    expect(r('@import "./print" print;\n@import "tailwindcss/utilities.css";\n@import "./a", "./b";\n')).toBe('@import "./a/print" print;\n@import "tailwindcss/utilities.css";\n@import "./a", "./b";\n')
    // a comment after a Sass import is no media query
    expect(r('@import "./e" /* e */;\n@import "./f" // f\n')).toBe('@import "./e" /* e */;\n@import "./f" // f\n')
    expect(r('@import "./b"  // the b partial\n.x\n  a: b\n', { sass: true, indented: true } as never)).toBe('@import "./b"  // the b partial\n.x\n  a: b\n')
    expect(r('.n { @import "./d" }\n')).toBe('.n { @import "./d" }\n') // a nested Sass import, no semicolon
    // CSS that Sass loads: every relative @import in it is plain CSS
    expect(r('@import "./reset";\n@import url(./r2.css);\n@import "pkg/x.css";\n', { cssImports: true } as never)).toBe('@import "./a/reset";\n@import url(./a/r2.css);\n@import "pkg/x.css";\n')
    expect(worker.rebaseUrls('@import "./reset.css";', '/p/src/a', '/p/src')).toBe('@import "./reset.css";') // CSS: the compiler resolves it
    // a `//****` banner isn't a block comment; the indented syntax's `/*` may never close
    expect(r('//*********** Card\n.card { background: url(bg.png); }')).toBe('//*********** Card\n.card { background: url(./a/bg.png); }')
    expect(r('/* Card styles\n.card\n  background: url(bg.png)\n', { sass: true, indented: true } as never)).toBe('/* Card styles\n.card\n  background: url(./a/bg.png)\n')
    // plain CSS keeps rebasing what looks like a path
    expect(worker.rebaseUrls('a { b: url($v) }', '/p/src/a', '/p/src')).toBe('a { b: url(./a/$v) }')
  })

  it('Sass load candidates follow Sass\'s tiers; two files in one tier are ambiguous, as in Sass', async () => {
    expect(worker.sassTiers('/p/a/b', false)).toEqual([
      ['/p/a/b.sass', '/p/a/_b.sass', '/p/a/b.scss', '/p/a/_b.scss'],
      ['/p/a/b.css', '/p/a/_b.css'],
      ['/p/a/b/index.sass', '/p/a/b/_index.sass', '/p/a/b/index.scss', '/p/a/b/_index.scss'],
      ['/p/a/b/index.css', '/p/a/b/_index.css'],
    ])
    expect(worker.sassTiers('/p/a/b.scss', true)).toEqual([['/p/a/b.import.scss', '/p/a/_b.import.scss'], ['/p/a/b.scss', '/p/a/_b.scss']])
    const dir = project({ 'src/_t.scss': 'a { b: 1 }', 'src/t.scss': 'a { b: 2 }', 'src/u.sass': 'a\n  b: 1\n', 'src/u.scss': 'a { b: 2 }', 'src/v.scss': 'a { b: 1 }', 'src/v.css': 'a { b: 2 }' })
    const file = join(dir, 'src/a.scss')
    for (const [css, found] of [['@use "t";', 'src/_t.scss'], ['@use "t.scss";', 'src/_t.scss'], ['@use "u";', 'src/u.sass']]) {
      const e = await worker.handle({ root: dir, file, css, candidates: [] }).then(() => null, (x) => x)
      expect(e?.message).toContain("It's not clear which file to import")
      expect(e.deps).toContain(join(dir, found))
    }
    // .sass/.scss before .css: not ambiguous
    expect((await worker.handle({ root: dir, file, css: '@use "v";', candidates: [] })).css).toContain('b: 1')
  })
})

describe('CSS worker process (nodeCssBackend over a real node child)', () => {
  /** Spawns worker.cjs in Node; records what went over stdin. */
  const nodeSpawn = () => {
    const lines: Record<string, unknown>[] = []
    let spawned = 0
    const spawn: CssWorkerSpawn = (io) => {
      spawned++
      const p = spawnProcess(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'] })
      p.stdout.setEncoding('utf8').on('data', io.stdout)
      p.stderr.setEncoding('utf8').on('data', io.stderr)
      return {
        write: (l) => (lines.push(JSON.parse(l)), void p.stdin.write(l)),
        kill: () => void p.kill(),
        exited: new Promise((r) => p.on('exit', (code) => r(code ?? 1))),
      }
    }
    return { spawn, lines, spawns: () => spawned }
  }
  const req = (dir: string, o: Partial<CssRequest> = {}): CssRequest => ({ root: dir, file: join(dir, 'a.css'), css: '@import "tailwindcss/utilities.css";\n', candidates: [], postcssConfig: null, env: 'development', ...o })

  it('sends candidate deltas per worker instance; a restart rejects in-flight requests as restarted', async () => {
    const dir = project({
      'postcss.config.cjs': "module.exports = { plugins: [{ postcssPlugin: 'slow', Once: () => new Promise((r) => setTimeout(r, 400)) }] }\n",
    })
    const s = nodeSpawn()
    const b = nodeCssBackend({} as never, { spawn: s.spawn })
    try {
      expect((await b.process(req(dir, { candidateSet: 'x:1', candidates: ['flex'] }))).css).toMatch(/\.flex/)
      const r = await b.process(req(dir, { candidateSet: 'x:1', candidates: ['flex', 'underline'] }))
      expect(r.css).toMatch(/\.flex/)
      expect(r.css).toMatch(/\.underline/)
      expect(s.lines.map((l) => l.candidates)).toEqual([['flex'], ['underline']])
      // a slow request cut off by a restart: rejected as `restarted` (the pipeline re-sends it with its new mode)
      const slow = b.process(req(dir, { candidateSet: 'x:1', candidates: ['flex', 'underline'], postcssConfig: join(dir, 'postcss.config.cjs'), tailwind: true }))
      await new Promise((r) => setTimeout(r, 100))
      b.restart()
      await expect(slow).rejects.toMatchObject({ restarted: true })
      // the new worker gets the whole set
      expect((await b.process(req(dir, { candidateSet: 'x:1', candidates: ['flex', 'underline'] }))).css).toMatch(/\.underline/)
      expect(s.spawns()).toBe(2)
      expect(s.lines.at(-1)!.candidates).toEqual(['flex', 'underline'])
      // release: the worker forgets the session; its next request sends the whole set again
      b.release!('x')
      await b.process(req(dir, { candidateSet: 'x:1', candidates: ['flex', 'underline', 'grid'] }))
      expect(s.lines.at(-2)).toEqual({ op: 'release', session: 'x' })
      expect(s.lines.at(-1)!.candidates).toEqual(['flex', 'underline', 'grid'])
    } finally {
      b.close()
    }
  })

  it('a released session\'s queued requests are not replayed when another request times out', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: [{ postcssPlugin: 'hang', Once: (root) => root.toString().includes('HANG') ? new Promise(() => {}) : undefined }] }\n" })
    const s = nodeSpawn()
    const b = nodeCssBackend({} as never, { spawn: s.spawn, timeoutMs: 800 })
    try {
      const pc = { postcssConfig: join(dir, 'postcss.config.cjs') }
      const hang = b.process(req(dir, { ...pc, css: '/* HANG */', session: 'a' }))
      const queued = b.process(req(dir, { ...pc, css: 'a{}', session: 'b' }))
      b.release!('b')
      await expect(queued).rejects.toThrow(/closed/)
      await expect(hang).rejects.toThrow(/timed out/)
      await new Promise((r) => setTimeout(r, 100))
      expect(s.lines.filter((l) => l.session === 'b' && l.op !== 'release')).toHaveLength(1)
    } finally {
      b.close()
    }
  })

  it('a released request still counts in the queue: the one behind it gets its own full timeout', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: [{ postcssPlugin: 'slow', Once: () => new Promise((r) => setTimeout(r, 600)) }] }\n" })
    const s = nodeSpawn()
    const b = nodeCssBackend({} as never, { spawn: s.spawn, timeoutMs: 1000 })
    try {
      const pc = { postcssConfig: join(dir, 'postcss.config.cjs'), css: 'a{}' }
      const first = b.process(req(dir, { ...pc, session: 'live' }))
      const gone = b.process(req(dir, { ...pc, session: 'gone' }))
      const last = b.process(req(dir, { ...pc, session: 'live' }))
      b.release!('gone')
      await expect(gone).rejects.toThrow(/closed/)
      expect((await first).css).toContain('a{}')
      expect((await last).css).toContain('a{}') // ~1.8s after it was sent, 0.6s after the worker started it
      expect(s.spawns()).toBe(1)
    } finally {
      b.close()
    }
  })

  it('the timeout counts from when the worker starts a request, not while it waits behind another', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: [{ postcssPlugin: 'slow', Once: () => new Promise((r) => setTimeout(r, 700)) }] }\n" })
    const s = nodeSpawn()
    const b = nodeCssBackend({} as never, { spawn: s.spawn, timeoutMs: 1000 })
    try {
      const pc = { postcssConfig: join(dir, 'postcss.config.cjs'), css: 'a{}' }
      const [x, y] = await Promise.all([b.process(req(dir, pc)), b.process(req(dir, pc))]) // ~1.4s in all, 0.7s each
      expect(x.css + y.css).toContain('a{}')
      expect(s.spawns()).toBe(1)
    } finally {
      b.close()
    }
  })

  it('a request that never finishes times out: the worker is recycled and the next request works', async () => {
    const dir = project({ 'postcss.config.cjs': "module.exports = { plugins: [{ postcssPlugin: 'hang', Once: (root) => root.toString().includes('HANG') ? new Promise(() => {}) : undefined }] }\n" })
    const s = nodeSpawn()
    const b = nodeCssBackend({} as never, { spawn: s.spawn, timeoutMs: 1000 })
    try {
      const pc = { postcssConfig: join(dir, 'postcss.config.cjs') }
      await expect(b.process(req(dir, { ...pc, css: '/* HANG */' }))).rejects.toThrow(/CSS worker timed out after 1s processing .*a\.css/)
      expect((await b.process(req(dir, { ...pc, css: 'a { color: red }' }))).css).toContain('color: red')
      expect(s.spawns()).toBe(2)
    } finally {
      b.close()
    }
  })
})
