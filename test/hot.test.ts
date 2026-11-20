import { describe, expect, it, vi } from 'vitest'
import * as esbuild from 'esbuild'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('single-file components (worker)', () => {
  it('Svelte 5: client code with its own import.meta.hot accept and injected CSS', async () => {
    const root = project(['svelte'])
    const r = await worker.compileSfc({ root, file: join(root, 'src/App.svelte'), hmrId: 'x', source: '<script lang="ts">let n: number = $state(0)</script><button onclick={() => n++}>{n}</button><style>button{color:red}</style>' })
    expect(r.lang).toBe('js')
    expect(r.code).toContain("from 'svelte/internal/client'")
    expect(r.code).toMatch(/import\.meta\.hot\.accept\(/)
    expect(r.code).toContain('color:red')
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
    expect(a.code).toContain('button[data-v-abc]')
    expect(a.code).toContain('color: red')
    // relative url()s resolve from the component, not the page
    expect(a.code).toContain('url(/src/icon.svg?x#y)')
    expect(a.code).toContain('url(\\"/up.png\\")') // (Sass prints double quotes; JSON-escaped in the module)
    expect(a.code).toContain('url(/abs.png) url(data:x)')
    expect(a.code).toContain('url(\\"/src/a b.svg\\")')
    expect(a.code).toContain('content: \\"url(text)\\"')
    expect(a.code).toContain('@import \\"/src/theme.css\\"')
    expect(a.code).toContain('__VUE_HMR_RUNTIME__.rerender(')
    const hashOf = (code: string) => /__cressletScript = "(\w+)"/.exec(code)![1]
    const b = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: sfc('b') })
    expect(hashOf(b.code)).toBe(hashOf(a.code)) // template-only edit: same script
    const c = await worker.compileSfc({ root, file: join(root, 'src/App.vue'), hmrId: 'abc', source: sfc('a', '\nconst x = 1') })
    expect(hashOf(c.code)).not.toBe(hashOf(a.code))
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
