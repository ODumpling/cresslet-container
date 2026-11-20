// Dependency pre-bundling (vite "optimizeDeps"-like): every bare import used by the app is bundled from
// node_modules in ONE esbuild run with code splitting, so shared deps (react, ...) exist exactly once.
// CJS entries get named exports via cjs-module-lexer. Served at /@modules/<spec>, chunks at /@modules/chunk-*.js.
import type { Plugin } from 'esbuild-wasm'
import { parse as lexCjs } from 'cjs-lexer-js'
import type { VFS } from '../vfs'
import { bundleVfs, loadEsbuild, splitQuery, type VfsPluginOptions } from '../esbuild'
import { BROWSER_OPTS, resolveModule, type ResolveFs } from '../resolve'
import { isEsmFile } from '../esm'
import { dirname, join, normalize } from '../path'

const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval'.split(' '),
)
const IDENT = /^[A-Za-z_$][\w$]*$/

export interface DepsResult {
  id: number
  /** spec -> output text */
  entries: Map<string, string>
  /** chunk file name -> text */
  chunks: Map<string, string>
  errors: Map<string, string>
}

export class DepOptimizer {
  private specs = new Set<string>()
  private current: Promise<DepsResult> | null = null
  private builtFor = new Set<string>()
  private buildId = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingResolve: ((r: Promise<DepsResult>) => void)[] = []
  /** Called when already-served modules became stale (page must reload). */
  onStale?: () => void
  private lastServed = 0

  constructor(
    private vfs: VFS,
    private fs: ResolveFs,
    private root: string,
    private opts: { wasmURL?: string; define: Record<string, string>; conditions?: string[]; preprocess?: (file: string, text: string) => Promise<string> },
  ) {}

  has(spec: string): boolean {
    return this.specs.has(spec)
  }

  /** Add specs (e.g. from the initial scan) without serving. */
  add(specs: Iterable<string>): void {
    let changed = false
    for (const s of specs) if (!this.specs.has(s)) (this.specs.add(s), (changed = true))
    if (changed) this.schedule()
  }

  invalidate(): void {
    this.current = null
    this.builtFor.clear()
    this.lastServed = 0
  }

  async get(spec: string): Promise<{ code: string } | { error: string }> {
    if (!this.specs.has(spec)) {
      this.specs.add(spec)
      this.schedule()
    }
    const r = await this.result()
    this.markServed(r.id)
    const code = r.entries.get(spec)
    return code !== undefined ? { code } : { error: r.errors.get(spec) ?? `failed to pre-bundle ${spec}` }
  }

  async chunk(name: string): Promise<string | undefined> {
    const r = await this.result()
    this.markServed(r.id)
    return r.chunks.get(name)
  }

  private markServed(id: number) {
    if (this.lastServed && this.lastServed !== id) this.onStale?.()
    this.lastServed = id
  }

  private result(): Promise<DepsResult> {
    const missing = [...this.specs].some((s) => !this.builtFor.has(s))
    if (this.current && !missing && !this.timer) return this.current
    return new Promise((resolve) => {
      this.pendingResolve.push((p) => resolve(p))
      this.schedule()
    })
  }

  private schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const specs = [...this.specs]
      const p = this.build(specs)
      this.current = p
      for (const s of specs) this.builtFor.add(s)
      for (const r of this.pendingResolve.splice(0)) r(p)
    }, 25)
  }

  private async build(specs: string[]): Promise<DepsResult> {
    const id = ++this.buildId
    const errors = new Map<string, string>()
    const ropts = { ...BROWSER_OPTS, conditions: this.opts.conditions ?? BROWSER_OPTS.conditions }
    const entryPoints: { in: string; out: string }[] = []
    const virtual = new Map<string, string>()
    for (const spec of specs) {
      if (spec.endsWith('.css')) continue
      let file: string | false
      try {
        file = resolveModule(this.fs, spec, this.root, ropts)
      } catch (e) {
        errors.set(spec, `Failed to resolve import "${spec}". Is it installed? (npm install ${spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')})`)
        continue
      }
      if (file === false) {
        virtual.set(spec, 'export default {}')
        entryPoints.push({ in: `cresslet-dep:${spec}`, out: spec })
        continue
      }
      const code = this.vfs.readText(file)
      if (isEsmFile(this.fs, file, code)) entryPoints.push({ in: file, out: spec })
      else {
        const names = await this.cjsExports(file, ropts)
        const named = [...names].filter((n) => IDENT.test(n) && !RESERVED.has(n) && n !== '__esModule')
        virtual.set(
          spec,
          `import * as __m from ${JSON.stringify(file)};\nexport default (__m.default ?? __m);\n` + (named.length ? `export const { ${named.join(', ')} } = __m;\n` : ''),
        )
        entryPoints.push({ in: `cresslet-dep:${spec}`, out: spec })
      }
    }
    const result: DepsResult = { id, entries: new Map(), chunks: new Map(), errors }
    if (!entryPoints.length) return result
    const depPlugin: Plugin = {
      name: 'cresslet-deps',
      setup(build) {
        build.onResolve({ filter: /^cresslet-dep:/ }, (a) => ({ path: a.path.slice('cresslet-dep:'.length), namespace: 'cresslet-dep' }))
        build.onLoad({ filter: /.*/, namespace: 'cresslet-dep' }, (a) => ({ contents: virtual.get(a.path) ?? '', loader: 'js', resolveDir: '/' }))
        // CSS imported from JS inside deps: inject as <style> (Sass/Less compiled first)
        build.onLoad({ filter: /\.(css|s[ac]ss|less)$/, namespace: 'cresslet-vfs' }, async (a) => {
          const es = await loadEsbuild()
          let text = new TextDecoder().decode(vfsRead(a.path))
          if (!a.path.endsWith('.css')) {
            if (!preprocess) throw new Error(`${a.path}: no Sass/Less compiler here`)
            text = await preprocess(a.path, text)
          }
          // relative url()s point at the package's files: served from the root (`/node_modules/...`) or `/@fs`
          const urlOf = (p: string) => (p.startsWith(root + '/') ? p.slice(root.length) : `/@fs${p}`)
          const out = await es.build({
            stdin: { contents: text, loader: 'css', resolveDir: dirname(a.path), sourcefile: a.path },
            bundle: true,
            write: false,
            logLevel: 'silent',
            plugins: [
              {
                name: 'cresslet-dep-css-urls',
                setup(b) {
                  b.onResolve({ filter: /.*/ }, (r) => {
                    const [clean, query] = splitQuery(r.path)
                    if (!clean || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(clean)) return { path: r.path, external: true }
                    const file = normalize(join(r.resolveDir, clean))
                    // the package's own `@import "./x.css"` (e.g. left by Sass): inlined, as the page can't resolve it
                    // (an extensionless one Sass keeps for its media query, `@import "./x" print`, stays external)
                    if (r.kind === 'import-rule' && !clean.startsWith('/') && clean.endsWith('.css') && vfs.isFile(file)) return { path: file, namespace: 'cresslet-dep-css' }
                    if (r.kind !== 'url-token') return { path: r.path, external: true }
                    return { path: vfs.isFile(file) ? urlOf(file) + query : r.path, external: true }
                  })
                  b.onLoad({ filter: /.*/, namespace: 'cresslet-dep-css' }, (l) => ({ contents: vfs.readText(l.path), loader: 'css', resolveDir: dirname(l.path) }))
                },
              },
            ],
          })
          const css = out.outputFiles[0]?.text ?? ''
          return {
            contents: `const s=document.createElement('style');s.setAttribute('data-cresslet-dep',${JSON.stringify(a.path)});s.textContent=${JSON.stringify(css)};document.head.appendChild(s);`,
            loader: 'js',
          }
        })
      },
    }
    const vfsRead = (p: string) => this.vfs.readFile(p)
    const preprocess = this.opts.preprocess
    const vfs = this.vfs
    const root = this.root
    const vopts: VfsPluginOptions = { resolve: ropts }
    try {
      const out = await bundleVfs(this.vfs, {
        cwd: this.root,
        wasmURL: this.opts.wasmURL,
        entryPoints,
        outdir: '/@modules',
        splitting: true,
        format: 'esm',
        target: 'es2022',
        chunkNames: 'chunk-[hash]',
        define: { 'process.env.NODE_ENV': JSON.stringify(this.opts.define['process.env.NODE_ENV'] ? JSON.parse(this.opts.define['process.env.NODE_ENV']) : 'development'), global: 'globalThis', ...this.opts.define },
        loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl', '.webp': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
        metafile: true,
        plugins: [depPlugin],
        vfsPlugin: vopts,
        logLevel: 'silent',
      })
      const byOut = new Map(entryPoints.map((e) => [`/@modules/${e.out}.js`, e.out]))
      for (const f of out.outputFiles) {
        const spec = byOut.get(f.path)
        if (spec !== undefined) result.entries.set(spec, f.text)
        else if (f.path.endsWith('.js')) result.chunks.set(f.path.slice(f.path.lastIndexOf('/') + 1), f.text)
      }
    } catch (e) {
      const { formatErrors } = await import('../esbuild')
      const msg = `Pre-bundling dependencies failed:\n${formatErrors(e)}`
      for (const ep of entryPoints) errors.set(ep.out, msg)
    }
    return result
  }

  /** Named exports of a CJS module, following `module.exports = require(...)` re-exports. */
  private async cjsExports(file: string, ropts: typeof BROWSER_OPTS, depth = 0, seen = new Set<string>()): Promise<Set<string>> {
    const names = new Set<string>()
    if (depth > 8 || seen.has(file)) return names
    seen.add(file)
    let code = this.vfs.readText(file)
    try {
      // resolve NODE_ENV branches first (react's index.js picks dev/prod build)
      const es = await loadEsbuild(this.opts.wasmURL)
      code = (await es.transform(code, { define: { 'process.env.NODE_ENV': '"development"' }, minifySyntax: true, loader: 'js', logLevel: 'silent' })).code
    } catch {
      /* lex the raw code */
    }
    let lexed: { exports: string[]; reexports: string[] }
    try {
      lexed = lexCjs(code)
    } catch {
      return names
    }
    for (const n of lexed.exports) names.add(n)
    for (const r of lexed.reexports) {
      try {
        const f = resolveModule(this.fs, r, dirname(file), ropts)
        if (f) for (const n of await this.cjsExports(f, ropts, depth + 1, seen)) names.add(n)
      } catch {
        /* ignore */
      }
    }
    return names
  }
}

/** Collect bare imports reachable from entry files (vite-like dependency scan). */
export async function scanImports(vfs: VFS, root: string, entries: string[], opts: { wasmURL?: string; jsx?: Record<string, string>; resolveLocal: (spec: string, importer: string) => string | null }): Promise<Set<string>> {
  const found = new Set<string>()
  const plugin: Plugin = {
    name: 'cresslet-scan',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point') return { path: a.path, namespace: 'scan' }
        if (/^(https?:|data:|\/\/|\/@)/.test(a.path)) return { path: a.path, external: true }
        const local = opts.resolveLocal(a.path, a.importer)
        if (local === null) {
          if (!/\.(css|scss|sass|less)$/.test(a.path)) found.add(a.path.split('?')[0])
          return { path: a.path, external: true }
        }
        if (!/\.(m?[jt]sx?|cjs|cts|mts)$/.test(local)) return { path: local, external: true }
        return { path: local, namespace: 'scan' }
      })
      build.onLoad({ filter: /.*/, namespace: 'scan' }, (a) => {
        const ext = a.path.slice(a.path.lastIndexOf('.'))
        return {
          contents: vfs.tryReadText(a.path) ?? '',
          loader: ext === '.tsx' ? 'tsx' : ext === '.ts' || ext === '.mts' || ext === '.cts' ? 'ts' : ext === '.jsx' ? 'jsx' : 'jsx',
          resolveDir: dirname(a.path),
        }
      })
    },
  }
  try {
    const es = await loadEsbuild(opts.wasmURL)
    await es.build({
      entryPoints: entries.filter((e) => vfs.isFile(e)),
      bundle: true,
      write: false,
      format: 'esm',
      outdir: '/__scan__',
      jsx: 'automatic',
      ...opts.jsx,
      plugins: [plugin],
      logLevel: 'silent',
      absWorkingDir: root,
    })
  } catch {
    /* best effort */
  }
  return found
}

