// Single-file components (.vue, .svelte, .svelte.js/.ts modules) for the dev server and build: compiled in the CSS
// worker with the project's own compiler; their style blocks then go through the CSS pipeline (PostCSS / Tailwind).
import type { Plugin } from 'esbuild-wasm'
import type { Container } from '../container'
import { loadEsbuild, splitQuery } from '../esbuild'
import { dirname, join } from '../path'
import type { CssError, CssPipeline, SfcResult } from './pipeline'

/** Modules compiled as components: `.vue`, `.svelte`, and Svelte's rune modules `.svelte.js` / `.svelte.ts`. */
export const SFC_RE = /\.(?:vue|svelte)$|\.svelte\.[cm]?[jt]s$/

/** A short stable id for a component file (Vue's HMR / scope id), from its root-relative URL. */
export function sfcId(url: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}

export interface SfcCompileOptions {
  root: string
  file: string
  hmrId: string
  session: string
  env: 'development' | 'production'
  tsconfigRaw?: unknown
}

/**
 * Compile one component file in the CSS worker (retried once if a CSS config change restarted it). A `.svelte.ts`
 * module has its TypeScript stripped first (Svelte's `compileModule` takes JavaScript).
 */
export async function compileSfc(c: Pick<Container, 'vfs' | 'cssWorker' | 'cssPlugins' | 'esbuildWasmUrl'>, o: SfcCompileOptions): Promise<SfcResult> {
  const w = c.cssWorker()
  if (!w.compile) throw new Error(`${o.file}: no compiler for single-file components`)
  let source = c.vfs.readText(o.file)
  if (/\.svelte\.[cm]?ts$/.test(o.file)) {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    source = (await es.transform(source, { loader: 'ts', sourcefile: o.file, tsconfigRaw: o.tsconfigRaw as never, logLevel: 'silent' })).code
  }
  const req = { root: o.root, file: o.file, source, hmrId: o.hmrId, session: o.session, env: o.env, plugins: c.cssPlugins !== false }
  try {
    return await w.compile(req)
  } catch (e) {
    if (!(e as CssError).restarted) throw e
    return w.compile(req)
  }
}

export interface SfcStyles {
  css: string[]
  /** files the PostCSS / Tailwind output depends on (stylesheets, configs, plugins) */
  deps: string[]
  dirs: string[]
  /** the Tailwind scanners whose candidates the output was built from */
  scanners: string[]
}

/**
 * The pipeline's name for a component's style block `i`: a stylesheet beside the component (the worker made a `src=`
 * sheet's relative `url()`s and Tailwind directives relative to the component).
 */
export const styleFile = (file: string, i: number): string => `${file}.${i}.css`

/** Run a component's style blocks through the CSS pipeline (PostCSS / Tailwind, when the project uses them). */
export async function processSfcStyles(pipe: CssPipeline, file: string, styles: string[]): Promise<SfcStyles> {
  const out: SfcStyles = { css: [], deps: [], dirs: [], scanners: [] }
  for (let i = 0; i < styles.length; i++) {
    const r = await pipe.process(styleFile(file, i), styles[i])
    out.css.push(r.css)
    out.deps.push(...r.deps)
    out.dirs.push(...r.dirs)
    if (r.scanner !== null && !out.scanners.includes(r.scanner)) out.scanners.push(r.scanner)
  }
  return out
}

/**
 * Dev: relative `url()`s the pipeline added (Tailwind / PostCSS output: relative to the component, like the build's) made
 * root-relative for a `<style>` on the page. The worker already did this for the component's own.
 */
export async function pageUrls(css: string, dir: string, toUrl: (abs: string) => string, wasmURL?: string): Promise<string> {
  if (!/url\(/i.test(css)) return css
  const es = await loadEsbuild(wasmURL)
  const r = await es.build({
    stdin: { contents: css, loader: 'css', resolveDir: dir, sourcefile: 'style.css' },
    bundle: true,
    write: false,
    outdir: '/__dev__',
    logLevel: 'silent',
    plugins: [
      {
        name: 'cresslet-sfc-urls',
        setup: (b) =>
          b.onResolve({ filter: /.*/ }, (a) => {
            const [clean, query] = splitQuery(a.path)
            const relative = a.kind === 'url-token' && !!clean && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(clean)
            return { path: relative ? toUrl(join(a.resolveDir, clean)) + query : a.path, external: true }
          }),
      },
    ],
  })
  return r.outputFiles[0]?.text ?? css
}

/**
 * Dev: a component's styles go in `<style>`s it owns, one per block (an `@import` must start its sheet), in order.
 * Its previous copy's extra ones are removed; a new one goes right after the component's others (or at the end of
 * `<head>`, for its first). It runs after the module body: a module that throws as it runs leaves the old styles.
 */
export function injectStyles(id: string, sheets: string[]): string {
  return `{ const sheets = ${JSON.stringify(sheets.filter(Boolean))}, have = [...document.querySelectorAll(${JSON.stringify(`style[data-cresslet-id="${id}"]`)})]
  let prev = null
  sheets.forEach((css, i) => { let el = have[i]; if (!el) { el = document.createElement('style'); el.setAttribute('data-cresslet-id', ${JSON.stringify(id)}); prev ? prev.after(el) : document.head.appendChild(el) } el.textContent = css; prev = el })
  for (const el of have.slice(sheets.length)) el.remove() }\n`
}

const STYLE_NS = 'cresslet-sfc-style'
const STYLE_SPEC = /^cresslet-sfc-style:(\d+):(.*)$/s

/**
 * Build: compile `.vue` / `.svelte` / `.svelte.js` files in production mode. Each style block is a CSS module the
 * component imports (PostCSS / Tailwind, then esbuild bundles it with its `url()`s, into the entry's stylesheet).
 */
export function sfcBuildPlugin(c: Container, root: string, pipe: CssPipeline, tsconfigRaw?: unknown): Plugin {
  const styles = new Map<string, string[]>()
  const err = (e: unknown) => ({ errors: [{ text: e instanceof Error ? e.message : String(e) }] })
  return {
    name: 'cresslet-sfc',
    setup(build) {
      build.onLoad({ filter: SFC_RE, namespace: 'cresslet-vfs' }, async (a) => {
        let r: SfcResult
        try {
          const url = a.path.startsWith(root + '/') ? a.path.slice(root.length) : a.path
          r = await compileSfc(c, { root, file: a.path, hmrId: sfcId(url), session: pipe.session, env: 'production', tsconfigRaw })
        } catch (e) {
          return err(e)
        }
        const css = r.styles ?? []
        styles.set(a.path, css)
        // after the script's imports (child components' styles first, as in dev, where each module injects its own as it runs)
        const imports = css.map((_, i) => `import ${JSON.stringify(`${STYLE_NS}:${i}:${a.path}`)}\n`).join('')
        return { contents: r.code + '\n' + imports, loader: r.lang, resolveDir: dirname(a.path), warnings: r.warnings.map((text) => ({ text: `${a.path}: ${text}` })) }
      })
      build.onResolve({ filter: /^cresslet-sfc-style:/ }, (a) => ({ path: a.path.slice(STYLE_NS.length + 1), namespace: STYLE_NS }))
      build.onLoad({ filter: /.*/, namespace: STYLE_NS }, async (a) => {
        const [, i, file] = STYLE_SPEC.exec(`${STYLE_NS}:${a.path}`)!
        try {
          const r = await pipe.process(styleFile(file, +i), styles.get(file)?.[+i] ?? '')
          return { contents: r.css, loader: 'css', resolveDir: dirname(file) }
        } catch (e) {
          return err(e)
        }
      })
    },
  }
}
