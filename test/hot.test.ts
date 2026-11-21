import { describe, expect, it, vi } from 'vitest'
import * as esbuild from 'esbuild'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeHot, HOT_ID, hotBanner } from '../src/dev/hot'
import { splitQuery } from '../src/esbuild'
import { ModuleGraph } from '../src/dev/hmr'
import { clientCode } from '../src/dev/client'
import { prefreshCoreModule, refreshTransform, PREFRESH_UTILS_URL } from '../src/dev/refresh'
import { spawn as spawnProcess } from 'node:child_process'
import { nodeCssBackend, type CssWorkerSpawn, type SfcRequest, type SfcResult } from '../src/css/pipeline'

/** The dev server's transform for a module that uses the API: define + banner, every import external. */
async function esm(src: string, url = '/src/a.js'): Promise<string> {
  const r = await esbuild.build({
    stdin: { contents: src, loader: 'ts', sourcefile: url },
    bundle: true,
    write: false,
    format: 'esm',
    define: { 'import.meta.hot': HOT_ID },
    banner: { js: hotBanner(url) },
    plugins: [{ name: 'ext', setup: (b) => b.onResolve({ filter: /.*/ }, (a) => ({ path: a.path, external: true })) }],
  })
  return r.outputFiles[0].text
}

const resolve = (spec: string) => (spec.startsWith('./') ? { file: `/abs/src/${spec.slice(2)}.ts`, url: `/src/${spec.slice(2)}.ts` } : null)

describe('analyzeHot', () => {
  it('finds self accepts (no args, callback, optional chaining)', async () => {
    expect(analyzeHot(await esm('import.meta.hot.accept()'), resolve)).toMatchObject({ self: true, deps: [] })
    expect(analyzeHot(await esm('import.meta.hot?.accept((m) => console.log(m))'), resolve)).toMatchObject({ self: true, deps: [] })
    expect(analyzeHot(await esm('if (import.meta.hot) { import.meta.hot.dispose(() => {}) }'), resolve)).toMatchObject({ self: false, deps: [] })
  })

  it('resolves dep accepts and rewrites them to the URLs updates are matched by', async () => {
    const r = analyzeHot(await esm(`import.meta.hot.accept('./dep', (m) => {})\nimport.meta.hot.accept(['./a', "./b", 'pkg'], ([a, b]) => {})`), resolve)
    expect(r.self).toBe(false)
    expect(r.deps).toEqual(['/abs/src/dep.ts', '/abs/src/a.ts', '/abs/src/b.ts'])
    expect(r.code).toContain(`${HOT_ID}.accept("/src/dep.ts"`)
    expect(r.code).toContain(`${HOT_ID}.accept(["/src/a.ts", "/src/b.ts", "pkg"]`)
    const t = analyzeHot(await esm('import.meta.hot.accept(`./dep`, () => {})'), resolve)
    expect(t).toMatchObject({ self: false, deps: ['/abs/src/dep.ts'] })
    // esbuild escapes non-ASCII (\xE9): still a dep, rewritten
    const u = analyzeHot(await esm("import.meta.hot.accept('./café', () => {})"), resolve)
    expect(u).toMatchObject({ self: false, deps: ['/abs/src/café.ts'] })
    expect(u.code).toContain('accept("/src/café.ts"')
  })

  it('the banner binds the context to the module URL and keeps imports hoistable', async () => {
    const code = await esm('import x from "./x"\nimport.meta.hot.accept()\nexport default x')
    expect(code.split('\n')[0]).toBe(hotBanner('/src/a.js'))
    expect(code).toContain(`${HOT_ID}.accept()`)
  })
})

describe('ModuleGraph with import.meta.hot', () => {
  const g = new ModuleGraph()
  g.setEntries('/index.html', ['/main.js'])
  g.setImports('/main.js', ['/msg.js', '/mid.js', '/self.js'])
  g.setImports('/mid.js', ['/inv.js'])
  g.setImports('/self.js', ['/util.js'])
  g.ensure('/main.js').hot = { self: false, deps: new Set(['/msg.js']) }
  g.ensure('/mid.js').hot = { self: true, deps: new Set() }
  g.ensure('/inv.js').hot = { self: true, deps: new Set() }
  g.ensure('/self.js').hot = { self: true, deps: new Set() }

  it('a dep accepted by its importer (even an entry) is re-imported for it; the importer is not re-run', () => {
    const r = g.propagate('/msg.js')!
    expect(r.updates).toEqual([{ kind: 'hot', file: '/main.js', accepted: '/msg.js' }])
    expect([...r.chain]).toEqual(['/msg.js'])
  })

  it('a self-accepting module is its own boundary; its deps re-run with it', () => {
    expect(g.propagate('/util.js')).toEqual({ updates: [{ kind: 'hot', file: '/self.js', accepted: '/self.js' }], chain: new Set(['/util.js', '/self.js']) })
  })

  it('invalidate() propagates from the importers', () => {
    expect(g.invalidate('/inv.js')).toEqual({ updates: [{ kind: 'hot', file: '/mid.js', accepted: '/mid.js' }], chain: new Set(['/mid.js']) })
    expect(g.invalidate('/mid.js')).toBe(null) // its importer is the entry, which doesn't accept it
    expect(g.invalidate('/nope.js')).toBe(null)
  })

  it('invalidate() hands the module to an importer that accepts it (not re-run)', () => {
    expect(g.invalidate('/msg.js')).toEqual({ updates: [{ kind: 'hot', file: '/main.js', accepted: '/msg.js' }], chain: new Set() })
  })

  it("the dev server's own self-accept (Preact boundary) is not used for an entry", () => {
    const h = new ModuleGraph()
    h.setEntries('/index.html', ['/main.tsx'])
    h.setImports('/main.tsx', ['/App.tsx'])
    h.ensure('/main.tsx').hot = { self: false, deps: new Set(), auto: true }
    h.ensure('/App.tsx').hot = { self: false, deps: new Set(), auto: true }
    expect(h.propagate('/App.tsx')!.updates).toEqual([{ kind: 'hot', file: '/App.tsx', accepted: '/App.tsx' }])
    expect(h.propagate('/main.tsx')).toBe(null)
    h.ensure('/main.tsx').hot!.self = true // an explicit accept() opts the entry in
    expect(h.propagate('/main.tsx')!.updates).toEqual([{ kind: 'hot', file: '/main.tsx', accepted: '/main.tsx' }])
  })
})

describe('client: createHotContext', () => {
  /** Run the client module with stubbed browser globals. */
  async function client() {
    const posted: string[] = []
    const g = globalThis as Record<string, unknown>
    const saved = { BroadcastChannel: g.BroadcastChannel, window: g.window, fetch: g.fetch, location: g.location }
    g.BroadcastChannel = class {
      onmessage: unknown
    }
    g.window = { addEventListener() {} }
    g.fetch = vi.fn(async (u: string) => (posted.push(u), { ok: true, text: async () => '' }))
    g.location = { pathname: '/', href: '/', replace: vi.fn() }
    const src = clientCode('ch', '/__cresslet__/x/1')
    const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`)
    return { mod, posted, restore: () => Object.assign(g, saved) }
  }

  it('keeps data across instances; invalidate() outside an update is ignored; on/off/send are no-ops', async () => {
    const { mod, posted, restore } = await client()
    try {
      const a = mod.createHotContext('/src/a.js')
      a.data.n = 1
      const self = vi.fn()
      a.accept(self)
      a.dispose((d: Record<string, number>) => void (d.disposed = 1))
      const b = mod.createHotContext('/src/a.js') // the module ran again
      expect(b.data).toBe(a.data)
      expect(b.data.n).toBe(1)
      const before = posted.length
      b.invalidate() // outside an update: ignored
      expect(posted.length).toBe(before)
      for (const k of ['on', 'off', 'send']) expect(() => b[k]('vite:beforeUpdate', () => {})).not.toThrow()
    } finally {
      restore()
    }
  })
})

describe('Preact refresh pass', () => {
  it('component modules accept themselves through import.meta.hot (flush, or invalidate on an export change)', async () => {
    const out = await esbuild.build({
      stdin: { contents: "import { useState } from 'preact/hooks'\nexport default function App() { const [n] = useState(0); return <p>{n}</p> }\n", loader: 'tsx', sourcefile: '/src/App.tsx' },
      bundle: true,
      write: false,
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'preact',
      plugins: [{ name: 'ext', setup: (b) => b.onResolve({ filter: /.*/ }, (a) => ({ path: a.path, external: true })) }],
    })
    const r = refreshTransform(out.outputFiles[0].text, '/src/App.tsx', PREFRESH_UTILS_URL, HOT_ID)
    expect(r.boundary).toBe(true)
    expect(r.code).toContain(`from "${PREFRESH_UTILS_URL}"`)
    expect(r.code).toContain(`${HOT_ID}.accept((m) => { if (!m) return; if (__cresslet_refresh.canRefresh("/src/App.tsx", m)) __cresslet_refresh.flush(); else ${HOT_ID}.invalidate(); });`)
    expect(analyzeHot(r.code, () => null).self).toBe(true)
  })

  it("prefresh's runtime imports the app's optimized preact", () => {
    expect(prefreshCoreModule('import{options as o}from"preact";import {Component} from "preact";')).toBe('import{options as o}from"/@modules/preact";import {Component} from "/@modules/preact";')
  })
})

// The SFC compile runs in the CSS worker (plain CommonJS): here in real Node against the repo's vue / svelte.
const worker = createRequire(import.meta.url)('../src/css/worker.cjs') as { compileSfc(req: SfcRequest): Promise<SfcResult> }
const repoModules = fileURLToPath(new URL('../node_modules', import.meta.url))
function project(packages: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'cresslet-sfc-'))
  mkdirSync(join(dir, 'node_modules'))
  for (const p of packages) symlinkSync(join(repoModules, p), join(dir, 'node_modules', p))
  writeFileSync(join(dir, 'package.json'), '{}')
  return dir
}
function files(root: string, tree: Record<string, string>): void {
  for (const [f, s] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), s)
  }
}

describe('single-file components (worker)', () => {
  it('Svelte 5: client code with its own import.meta.hot accept; its CSS returned', async () => {
    const root = project(['svelte'])
    const r = await worker.compileSfc({ root, file: join(root, 'src/App.svelte'), hmrId: 'x', source: '<script lang="ts">let n: number = $state(0)</script><button onclick={() => n++}>{n}</button><style>button{color:red}</style>' })
    expect(r.lang).toBe('js')
    expect(r.code).toContain("from 'svelte/internal/client'")
    expect(r.code).toMatch(/import\.meta\.hot\.accept\(/)
    expect(r.styles).toHaveLength(1)
    expect(r.styles[0]).toMatch(/button\.svelte-\w+\s*\{\s*color:\s*red/)
  })

  it('Svelte: production output, <style lang="scss">, @imports inlined after scoping (a package one too)', async () => {
    const root = project(['svelte', 'sass'])
    files(root, { 'src/theme.css': '.theme { background: url(./img/a.png) }', 'node_modules/ui/package.json': '{"name":"ui","style":"ui.css"}', 'node_modules/ui/ui.css': '.ui { color: blue }' })
    const source = '<p class="a">hi</p>\n<style lang="scss">@import "./theme.css"; @import "ui/ui.css"; $c: red; .a { color: $c; }</style>'
    const r = await worker.compileSfc({ root, file: join(root, 'src/A.svelte'), hmrId: 'x', source, env: 'production' })
    expect(r.code).not.toMatch(/import\.meta\.hot|\$\.add_locations|HMR/)
    const css = r.styles.join('\n')
    expect(css).toMatch(/\.a\.svelte-\w+\s*\{\s*color:\s*red/)
    expect(css).toContain('.theme { background: url(./img/a.png) }') // global (as vite-plugin-svelte), url() relative to the component
    expect(css).toContain('.ui { color: blue }')
    expect(css).not.toContain('@import')
    expect(r.deps.sort()).toEqual([join(root, 'node_modules/ui/ui.css'), join(root, 'src/theme.css')])
    const dev = await worker.compileSfc({ root, file: join(root, 'src/A.svelte'), hmrId: 'x', source })
    expect(dev.styles[0]).toContain('url(/src/img/a.png)') // dev: root-relative, for a <style> on the page
  })

  it('Svelte: .svelte.js rune modules compile with compileModule', async () => {
    const root = project(['svelte'])
    const r = await worker.compileSfc({ root, file: join(root, 'src/count.svelte.js'), hmrId: 'x', source: 'let c = $state(0)\nexport const get = () => c\nexport const inc = () => c++\n', env: 'production' })
    expect(r.code).toContain("from 'svelte/internal/client'")
    expect(r.code).toMatch(/\$\.state\(0\)/)
    expect(r.styles).toEqual([])
  })

  it('Svelte: a compile error carries its location', async () => {
    const root = project(['svelte'])
    await expect(worker.compileSfc({ root, file: '/src/Bad.svelte', hmrId: 'x', source: '<p>{oops</p>' })).rejects.toThrow(/\/src\/Bad\.svelte:1:\d+: /)
  })

  it('Vue: script and template compiled apart (re-render on template edits), scoped + Sass styles injected', async () => {
    const root = project(['vue', 'sass'])
    const sfc = (tpl: string, script = '') => `<script setup lang="ts">\nimport { ref } from 'vue'\nconst count = ref<number>(0)${script}\n</script>\n<template><button @click="count++">${tpl} {{ count }}</button></template>\n<style scoped lang="scss">$c: red; button { color: $c; background: url(./icon.svg?x#y); } a { background: url('../up.png') } b { background: url(/abs.png) url(data:x) } i { background: url("./a b.svg"); content: "url(text)" }</style>\n<style>@import "./theme.css";</style>\n`
    const a = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: sfc('a') })
    expect(a.lang).toBe('ts')
    expect(a.code).toContain('_sfc_main.render = _sfc_render')
    expect(a.code).toContain('_sfc_main.__scopeId = "data-v-abc"')
    expect(a.styles).toHaveLength(2) // one sheet per block: an @import must start one
    const [scss, plain] = a.styles
    expect(scss).toContain('button[data-v-abc]')
    expect(scss).toContain('color: red')
    // relative url()s resolve from the component, not the page
    expect(scss).toContain('url(/src/icon.svg?x#y)')
    expect(scss).toContain('url("/up.png")') // (Sass prints double quotes)
    expect(scss).toContain('url(/abs.png) url(data:x)')
    expect(scss).toContain('url("/src/a b.svg")')
    expect(scss).toContain('content: "url(text)"')
    expect(plain.trim()).toBe('@import "/src/theme.css";') // not found: left to the browser (rebased)
    expect(a.code).toContain('__VUE_HMR_RUNTIME__.rerender(')
    const hashOf = (code: string) => /__cressletScript = "(\w+)"/.exec(code)![1]
    const b = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: sfc('b') })
    expect(hashOf(b.code)).toBe(hashOf(a.code)) // template-only edit: same script
    const c = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: sfc('a', '\nconst x = 1') })
    expect(hashOf(c.code)).not.toBe(hashOf(a.code))
  })

  it('Vue: a scoped style scopes its @imported sheets (relative and package ones), which are deps', async () => {
    const root = project(['vue'])
    files(root, {
      'src/theme.css': '@import "./deep.css" screen and (min-width: 1px); @import url(https://example.com/f.css); .theme { background: url(./img/a.png) }',
      'src/deep.css': '.deep { color: green }',
      'src/styles/cycle.css': '@import "../cyc.css"; .c2 { color: red }',
      'src/cyc.css': '@import "./styles/cycle.css"; .c1 { color: red }',
      'node_modules/ui/package.json': '{"name":"ui","exports":{".":{"style":"./dist/ui.css"}}}',
      'node_modules/ui/dist/ui.css': '.ui { background: url(./ui.png) }',
    })
    const source = '<template><p class="theme">x</p></template>\n<style scoped>@import "./theme.css" layer(base); @import "ui"; @import "./cyc.css" supports(display: grid); @import "tailwindcss"; p { color: red }</style>'
    const r = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source, env: 'production' })
    const [css] = r.styles
    // the remote import and Tailwind's stay, hoisted (an @import must start the sheet), with the conditions it was under
    expect(css.indexOf('@import url("https://example.com/f.css") layer(base);')).toBe(0)
    expect(css).toContain('@import "tailwindcss";')
    const flat = css.replace(/\s+/g, ' ')
    expect(flat).toContain('@layer base { @media screen and (min-width: 1px) { .deep[data-v-abc] { color: green } } .theme[data-v-abc] { background: url(./img/a.png) } }')
    expect(flat).toContain('.ui[data-v-abc] { background: url(../node_modules/ui/dist/ui.png) }') // relative to the component (production)
    expect(flat).toContain('@supports (display: grid) { .c2[data-v-abc] { color: red } .c1[data-v-abc] { color: red } }') // (a cycle: each file once)
    expect(flat).toContain('p[data-v-abc] { color: red }')
    expect(r.deps.sort()).toEqual(['node_modules/ui/dist/ui.css', 'src/cyc.css', 'src/deep.css', 'src/styles/cycle.css', 'src/theme.css'].map((f) => join(root, f)))
    // production: no HMR, no file path
    expect(r.code).not.toMatch(/__hmrId|__file|import\.meta\.hot/)
    expect(r.code).toContain('export default _sfc_main')
  })

  it('style @imports: comments and queries allowed, each file once, a remote import under conditions keeps them', async () => {
    const root = project(['vue'])
    files(root, {
      'src/a.css': '@import "./shared.css"; .a { color: red }',
      'src/b.css': '@import "./shared.css"; .b { color: red }',
      'src/shared.css': '.shared { color: blue }',
      'src/remote.css': '@import url(https://example.com/r.css); .r { color: red }',
      'src/remote2.css': '@import url(https://example.com/r2.css) screen; .r2 { color: red }',
    })
    const source = '<template><p/></template>\n<style scoped>@import /* x */ "./a.css?v=1"; @import "./b.css"; @import "./remote.css" print; @import "./remote2.css" print; p { color: red }</style>'
    const [css] = (await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source, env: 'production' })).styles
    expect(css.match(/\.shared\[data-v-abc\]/g)).toHaveLength(1)
    expect(css).toContain('.a[data-v-abc]')
    expect(css).toContain('@import url("https://example.com/r.css") print;')
    expect(css).toMatch(/@media print \{\s*\.r\[data-v-abc\]/)
    expect(css).toContain('@import "./remote2.css" print;') // both conditional: not inlined
    expect(css).not.toContain('.r2')
    // the same file under other conditions is inlined again; a discarded expansion doesn't count as inlined
    files(root, { 'src/c.css': '@import "./shared.css"; @import url(https://example.com/c.css) screen;' })
    const again = '<template><p/></template>\n<style scoped>@import "./a.css" screen; @import "./b.css" print; @import "./c.css" print; @import "./shared.css";</style>'
    const flat = (await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: again, env: 'production' })).styles[0].replace(/\s+/g, ' ')
    expect(flat).toMatch(/@media screen \{ \.shared\[data-v-abc\][^}]*\} \.a\[/)
    expect(flat).toMatch(/@media print \{ \.shared\[data-v-abc\][^}]*\} \.b\[/)
    expect(flat).toContain('@import "./c.css" print;')
    expect(flat.trim()).toMatch(/\} \.shared\[data-v-abc\] \{ color: blue \}$/) // the direct import, after c.css was left out
    // a diamond under the same conditions: once (postcss-import), so a.css's later rule still wins
    files(root, { 'src/d.css': '@import "./shared.css"; .shared { color: red }' })
    const diamond = (await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: '<template><p/></template>\n<style scoped>@import "./d.css"; @import "./shared.css";</style>', env: 'production' })).styles[0]
    expect(diamond.replace(/\s+/g, ' ').trim()).toBe('.shared[data-v-abc] { color: blue } .shared[data-v-abc] { color: red }')
    // a `@layer` statement after an import stays after the rules inlined for it (layer order)
    files(root, { 'src/reset.css': '.card { color: red }' })
    const layered = (await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: '<template><p/></template>\n<style>@import "./reset.css" layer(reset); @layer app; @layer app { .card { color: blue } }</style>', env: 'production' })).styles[0]
    expect(layered.indexOf('@layer reset')).toBeLessThan(layered.indexOf('@layer app;'))
  })

  it('Vue: a src= stylesheet keeps one base: Tailwind directives rebased to the component; composes resolve beside it', async () => {
    const root = project(['vue'])
    files(root, { 'styles/use.css': '@reference "./theme/palette.css"; @source "../content"; .x { @apply bg-brand; background: url(./img.png) }', 'styles/card.css': '.card { composes: base from "./base.css"; color: red }', 'styles/base.css': '.base { margin: 0 }' })
    const r = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: '<template><p/></template>\n<style src="../styles/use.css"></style>\n<style module src="../styles/card.css"></style>', env: 'production' })
    expect(r.styles[0]).toContain('@reference "../styles/theme/palette.css"')
    expect(r.styles[0]).toContain('@source "../content"')
    expect(r.styles[0]).toContain('url(../styles/img.png)')
    expect(r.code).toMatch(/"card":"card_\w+ base_\w+"/)
    // an @imported sheet's directives too
    files(root, { 'styles/shared.css': '@reference "./theme/palette.css"; .s { background: url(./s.png) }' })
    const imported = await worker.compileSfc({ root, file: join(root, 'src/B.vue'), hmrId: 'b', source: '<template><p/></template>\n<style>@import "../styles/shared.css";</style>', env: 'production' })
    expect(imported.styles[0]).toContain('@reference "../styles/theme/palette.css"')
    expect(imported.styles[0]).toContain('url(../styles/s.png)')
  })

  it('Vue production: root-relative template assets are bundled, public/ ones stay URLs; Tailwind import options stay', async () => {
    const root = project(['vue'])
    files(root, { 'public/vite.svg': '<svg/>', 'src/logo.svg': '<svg/>', 'src/x.css': '.x { color: red }' })
    const source = '<template><img src="/vite.svg"><img src="/src/logo.svg"></template>\n<style>@import "./x.css" theme(reference);</style>'
    const prod = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'a', source, env: 'production' })
    expect(prod.code).toContain('const _imports_0 = "/vite.svg"')
    expect(prod.code).toContain('import _imports_1 from "./logo.svg"')
    // left for Tailwind, by its absolute path (in dev too: a root-relative URL isn't a file Tailwind can open)
    expect(prod.styles[0]).toContain(`@import "${join(root, 'src/x.css')}" theme(reference);`)
    const dev = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'a', source })
    expect(dev.code).toContain('src: "/src/logo.svg"') // dev: the page loads it from the server
    expect(dev.styles[0]).toContain(`@import "${join(root, 'src/x.css')}" theme(reference);`)
    // a missing relative sheet is a dep: creating it recompiles the component
    const missing = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'a', source: '<template><p/></template>\n<style scoped>@import "./fresh.css";</style>' })
    expect(missing.deps).toEqual([join(root, 'src/fresh.css')])
  })

  it('Vue: a src= template resolves its includes and asset URLs from its own file', async () => {
    const root = project(['vue', 'pug'])
    files(root, { 'src/parts/view.pug': 'div\n  include ./nested.pug\n  img(src="./logo.svg")\n', 'src/parts/nested.pug': 'p.nested nested\n', 'src/parts/view.html': '<img src="./logo.svg"><img src="../top.svg">' })
    const pug = await worker.compileSfc({ root, file: join(root, 'src/A.vue'), hmrId: 'a', source: '<template src="./parts/view.pug"></template>' })
    expect(pug.code).toContain('class: "nested"')
    expect(pug.code).toContain('import _imports_0 from "./parts/logo.svg"')
    const html = await worker.compileSfc({ root, file: join(root, 'src/B.vue'), hmrId: 'b', source: '<template src="./parts/view.html"></template>' })
    expect(html.code).toContain('import _imports_0 from "./parts/logo.svg"')
    expect(html.code).toContain('import _imports_1 from "./top.svg"')
  })

  it('Vue: <style module>, src= blocks, <template lang="pug">, prop types imported from another file', async () => {
    const root = project(['vue', 'pug', 'sass'])
    files(root, {
      'src/types.ts': 'export interface Props { msg: string; count?: number }\n',
      'src/parts/tpl.html': '<h1 :class="$style.big">{{ msg }}</h1>',
      'src/parts/look.scss': '$c: blue; .look { color: $c; background: url(./bg.png) }',
      'src/parts/script.ts': 'export default { name: "FromSrc" }\n',
    })
    const typed = await worker.compileSfc({
      root,
      file: join(root, 'src/A.vue'),
      hmrId: 'abc',
      source: '<script setup lang="ts">\nimport type { Props } from \'./types\'\ndefineProps<Props>()\n</script>\n<template src="./parts/tpl.html"></template>\n<style module>.big { font-size: 2em }</style>\n<style module="extra">.big { color: red }</style>\n<style src="./parts/look.scss" scoped></style>\n',
    })
    expect(typed.code).toMatch(/msg: \{ type: String, required: true \}/)
    expect(typed.code).toMatch(/count: \{ type: Number, required: false \}/)
    expect(typed.code).toContain('_ctx.$style.big')
    const mods = JSON.parse(/__cssModules = (.*)\n/.exec(typed.code)![1])
    expect(Object.keys(mods)).toEqual(['$style', 'extra'])
    expect(mods.$style.big).not.toBe(mods.extra.big) // per block
    expect(typed.styles[0].replace(/\s+/g, ' ')).toContain(`.${mods.$style.big} { font-size: 2em }`)
    expect(typed.styles[2]).toMatch(/\.look\[data-v-abc\] \{\s*color: blue;\s*background: url\("?\/src\/parts\/bg\.png"?\)/) // from its own dir
    expect(typed.deps.sort()).toEqual(['src/parts/look.scss', 'src/parts/tpl.html', 'src/types.ts'].map((f) => join(root, f)))
    // the class map is part of the script revision: a new one reloads, the same one re-renders
    const hashOf = (code: string) => /__cressletScript = "(\w+)"/.exec(code)![1]
    const again = await worker.compileSfc({ root, file: join(root, 'src/A.vue'), hmrId: 'abc', source: '<script setup lang="ts">\nimport type { Props } from \'./types\'\ndefineProps<Props>()\n</script>\n<template src="./parts/tpl.html"></template>\n<style module>.big { font-size: 3em }</style>\n<style module="extra">.big { color: red }</style>\n<style src="./parts/look.scss" scoped></style>\n' })
    expect(hashOf(again.code)).toBe(hashOf(typed.code))
    // an edited type file is read again
    writeFileSync(join(root, 'src/types.ts'), 'export interface Props { msg: number }\n')
    expect((await worker.compileSfc({ root, file: join(root, 'src/A.vue'), hmrId: 'abc', source: '<script setup lang="ts">\nimport type { Props } from \'./types\'\ndefineProps<Props>()\n</script>\n<template><p/></template>' })).code).toMatch(/msg: \{ type: Number, required: true \}/)
    // a type from a package: the project's TypeScript resolves it (loaded only then)
    const withTs = project(['vue', 'typescript'])
    files(withTs, { 'node_modules/shapes/package.json': '{"name":"shapes","types":"index.d.ts"}', 'node_modules/shapes/index.d.ts': 'export interface Shape { sides: number }\n' })
    const pkgTyped = await worker.compileSfc({ root: withTs, file: join(withTs, 'src/T.vue'), hmrId: 't', source: '<script setup lang="ts">\nimport type { Shape } from \'shapes\'\ndefineProps<Shape>()\n</script>\n<template><p/></template>' })
    expect(pkgTyped.code).toMatch(/sides: \{ type: Number, required: true \}/)
    const pug = await worker.compileSfc({ root, file: join(root, 'src/P.vue'), hmrId: 'p', source: '<template lang="pug">\np.hi(:title="t") {{ t }}\n  input(disabled)\n</template>\n<script>export default { data: () => ({ t: 1 }) }</script>' })
    expect(pug.code).toMatch(/_createElementBlock\("p", \{\s*class: "hi",\s*title: _ctx\.t/)
    expect(pug.code).toContain('disabled: ""') // doctype html: a boolean attribute, not disabled="disabled"
    const src = await worker.compileSfc({ root, file: join(root, 'src/S.vue'), hmrId: 's', source: '<script src="./parts/script.ts"></script>\n<template><p>x</p></template>' })
    // a copy (components sharing it don't clash), its named exports too; TypeScript template expressions
    expect(src.code).toContain('import _sfc_src from "./parts/script.ts"\nexport * from "./parts/script.ts"\nconst _sfc_main = typeof _sfc_src')
    const srcTs = await worker.compileSfc({ root, file: join(root, 'src/S.vue'), hmrId: 's', source: '<script lang="ts" src="./parts/script.ts"></script>\n<template><p>{{ (1 as number) + 1 }}</p></template>' })
    expect(srcTs.lang).toBe('ts')
    expect(src.deps).toEqual([]) // an import (its edits reload the component, as its other imports' do)
    await expect(worker.compileSfc({ root: project(['vue']), file: '/src/Q.vue', hmrId: 'q', source: '<template lang="pug">p hi</template>' })).rejects.toThrow(/npm install pug/)
    await expect(worker.compileSfc({ root, file: join(root, 'src/M.vue'), hmrId: 'm', source: '<template src="./nope.html"></template>' })).rejects.toThrow(/<template src="\.\/nope\.html">: file not found/)
  })

  it('Vue: a template error carries its location; a missing compiler says what to install', async () => {
    const root = project(['vue'])
    await expect(worker.compileSfc({ root, file: '/src/Bad.vue', hmrId: 'x', source: '<template><div></template>' })).rejects.toThrow(/\/src\/Bad\.vue:1:\d+: /)
    await expect(worker.compileSfc({ root: project([]), file: '/src/A.vue', hmrId: 'x', source: '<template><p/></template>' })).rejects.toThrow(/npm install vue/)
  })
})

describe('single-file components over the worker protocol', () => {
  it('nodeCssBackend.compile gets its reply (request fields never clobber the message id)', async () => {
    const workerPath = fileURLToPath(new URL('../src/css/worker.cjs', import.meta.url))
    const spawn: CssWorkerSpawn = (io) => {
      const p = spawnProcess(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'] })
      p.stdout.setEncoding('utf8').on('data', io.stdout)
      p.stderr.setEncoding('utf8').on('data', io.stderr)
      return { write: (l) => void p.stdin.write(l), kill: () => void p.kill(), exited: new Promise((r) => p.on('exit', (code) => r(code ?? 1))) }
    }
    const backend = nodeCssBackend({} as never, { spawn, timeoutMs: 10_000 })
    try {
      const root = project(['svelte'])
      const r = await backend.compile!({ root, file: join(root, 'src/A.svelte'), hmrId: 'x', source: '<p>hi</p>' })
      expect(r.code).toContain('svelte/internal/client')
    } finally {
      backend.close()
    }
  })
})

it('splitQuery: a leading # is a package subpath import (Svelte runtime: #client/constants), not a fragment', () => {
  expect(splitQuery('#client/constants')).toEqual(['#client/constants', ''])
  expect(splitQuery('#a?raw')).toEqual(['#a', '?raw'])
  expect(splitQuery('./x.svg#icon')).toEqual(['./x.svg', '#icon'])
})
