// Built-in vite-like dev server over the VFS.
import type { Plugin } from 'esbuild-wasm'
import type { Container } from '../container'
import { formatErrors, isNodeBuiltin, loadEsbuild, splitQuery } from '../esbuild'
import { dirname, extname, join, normalize } from '../path'
import { BROWSER_OPTS, isBare, resolveModule } from '../resolve'
import { clientCode, errorModule, styleModule } from './client'
import { DepOptimizer, scanImports } from './deps'
import { ASSET_EXT, envDefines, jsxOptions, loadEnv, matchPaths, mimeType, readProjectConfig, SCRIPT_EXT, type ProjectConfig } from './project'
import { findModuleScripts } from '../build/html'
import { ModuleGraph, type HmrUpdate } from './hmr'
import { refreshRuntimeModule, refreshTransform, refreshUtilsCode, REFRESH_RUNTIME_URL, REFRESH_UTILS_URL } from './refresh'
import refreshRuntimeCjs from 'react-refresh/cjs/react-refresh-runtime.development.js?raw'

export interface DevServerOptions {
  root?: string
  port?: number
  middleware?: (req: Request) => Promise<Response | undefined> | Response | undefined
}

export interface DevServerHandle {
  url: string
  port: number
  close(): void
}

const NO_CACHE = { 'cache-control': 'no-cache, no-store' }
const JS = { 'content-type': 'text/javascript; charset=utf-8', ...NO_CACHE }

export async function createDevServer(c: Container, o: DevServerOptions = {}): Promise<DevServerHandle> {
  const root = normalize(o.root ? (o.root.startsWith('/') ? o.root : join(c.workdir, o.root)) : c.workdir)
  const port = o.port ?? c.ports.free(5173)
  const channelName = `cresslet:${c.instanceId}:${port}`
  const bc = new BroadcastChannel(channelName)
  const vfs = c.vfs
  const fs = c.resolveFs
  let cfg: ProjectConfig = readProjectConfig(vfs, root)
  let env = loadEnv(vfs, root, 'development')
  let defines = { ...envDefines(env), 'process.env.NODE_ENV': '"development"' }
  const deps = new DepOptimizer(vfs, fs, root, { wasmURL: c.esbuildWasmUrl, define: { 'process.env.NODE_ENV': '"development"' } })
  deps.onStale = () => scheduleReload('dependencies re-optimized')
  /** Transformed scripts, with what the graph needs to re-learn them after a full reload resets it. */
  const transformCache = new Map<string, { mtime: number; code: string; imports: Set<string>; boundary: boolean }>()
  /** Bumped per module by each HMR flush: an in-flight transform from an older generation must not be cached or report errors. */
  const generation = new Map<string, number>()
  const bump = (f: string) => generation.set(f, (generation.get(f) ?? 0) + 1)
  /** Bumped by every full reload (graph reset): work started for the previous page must not touch the new one's state. */
  let pageGen = 0
  /** Generation of the transform that last published a module's graph edges/accept (current page only). */
  const published = new Map<string, number>()
  /** Modules with a transform in flight (current page): a change to one isn't "never served", even without a graph node. */
  const inflight = new Map<string, number>()
  /** Whether a transform of `f` started at generation `gen` during page `page` is still current. */
  const fresh = (f: string, gen: number, page: number) => page === pageGen && (generation.get(f) ?? 0) === gen
  let lastError = ''
  let lastErrorFile = ''

  // ---- file watching -> HMR, else live reload ----
  const graph = new ModuleGraph()
  /** Last HMR timestamp per module: imports of it are rewritten to `?t=<ts>` so re-executed importers get the new copy. */
  const hmrStamp = new Map<string, number>()
  /** Modules with a relative import that didn't resolve (yet). */
  const unresolved = new Set<string>()
  /** Files served as-is (e.g. a runtime `fetch('/data.json')`): outside the module graph, but the page uses them. */
  const served = new Set<string>()
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let depsTimer: ReturnType<typeof setTimeout> | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Set<string>()
  let closed = false
  const post = (m: unknown) => {
    if (!closed) bc.postMessage(m)
  }
  const scheduleReload = (_why: string) => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      pending.clear()
      lastError = lastErrorFile = '' // the page starts over; a still-broken module reports again when requested
      graph.reset() // so is its module graph: edges/boundaries are re-learnt from what the new page requests
      pageGen++
      published.clear()
      inflight.clear()
      post({ type: 'reload' })
    }, 60)
  }
  const scheduleHmr = (abs: string) => {
    pending.add(abs)
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flushHmr, 60)
  }
  const flushHmr = () => {
    flushTimer = null
    if (reloadTimer || !pending.size) return
    // a module that failed to transform may be fixed by this change (e.g. a newly created import target)
    if (lastErrorFile) {
      const n = graph.nodes.get(lastErrorFile)
      // deleted, or no longer imported by anything: its error is no longer the page's problem
      if (!vfs.isFile(lastErrorFile) || (n && !n.importers.size && !graph.isEntry(lastErrorFile))) lastError = lastErrorFile = ''
      else if (!n) return scheduleReload('recovering from an error')
      else pending.add(lastErrorFile)
    }
    const files = [...pending]
    pending.clear()
    for (const f of files) bump(f)
    // deleted/renamed modules: forget them (all of them, before anything returns) so stale edges don't steer later updates
    const gone = files.filter((f) => graph.nodes.has(f) && !vfs.isFile(f))
    for (const f of gone) {
      graph.remove(f)
      published.delete(f)
      hmrStamp.delete(f)
      transformCache.delete(f)
      unresolved.delete(f)
      if (f === lastErrorFile) lastError = lastErrorFile = ''
    }
    if (gone.length) return scheduleReload(gone[0])
    const updates = new Map<string, HmrUpdate>()
    const chain = new Set<string>()
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      // a module whose first transform is in flight has no node yet, but the page is about to run it
      if (!graph.nodes.has(f) && !inflight.has(f)) {
        // never served to the page, so it can't affect it, unless it's something loaded outside the module graph
        // or a module whose import of it failed to resolve
        if (vfs.isDir(f)) continue
        if (served.has(f)) return scheduleReload(f)
        if (!SCRIPT_EXT.test(f) && !f.endsWith('.css')) {
          if (ASSET_EXT.test(f)) return scheduleReload(f)
          continue // README, dotfiles, editor temp files...
        }
        for (const u of unresolved) if (!files.includes(u)) files.push(u)
        continue
      }
      const r = graph.propagate(f)
      if (!r) return scheduleReload(f)
      for (const u of r.updates) updates.set(u.file, u)
      for (const m of r.chain) chain.add(m)
    }
    if (!updates.size) return
    const t = Date.now()
    for (const m of chain) {
      hmrStamp.set(m, t)
      transformCache.delete(m)
      bump(m)
    }
    post({ type: 'update', updates: [...updates.values()].map((u) => ({ kind: u.kind, url: toUrl(u.file) + (u.kind === 'css' ? '?import' : ''), t })) })
  }
  const watcher = vfs.watch(root, { recursive: true }, (_ev, file) => {
    if (file.startsWith('node_modules/') || file === 'node_modules') {
      // deps changed (npm install): rebuild lazily, then reload once things settle
      if (depsTimer) clearTimeout(depsTimer)
      depsTimer = setTimeout(() => {
        depsTimer = null
        deps.invalidate()
        transformCache.clear()
        scheduleReload('node_modules changed')
      }, 400)
      return
    }
    if (/^(\.git|dist)\//.test(file)) return
    if (/^(tsconfig.*\.json|jsconfig\.json|package\.json)$/.test(file)) cfg = readProjectConfig(vfs, root)
    if (/^\.env/.test(file)) {
      env = loadEnv(vfs, root, 'development')
      defines = { ...envDefines(env), 'process.env.NODE_ENV': '"development"' }
      transformCache.clear()
    }
    if (/^(tsconfig.*\.json|jsconfig\.json|package\.json|\.env.*)$/.test(file) || /\.html?$/.test(file) || file.startsWith('public/')) return scheduleReload(file)
    scheduleHmr(join(root, file))
  })

  // ---- resolution helpers ----
  const toUrl = (abs: string): string => (abs.startsWith(root + '/') ? abs.slice(root.length) : `/@fs${abs}`)
  const fromUrl = (p: string): string => (p.startsWith('/@fs/') ? p.slice(4) : join(root, p))

  const resolveLocal = (spec: string, importer: string): string | null => {
    const [clean] = splitQuery(spec)
    const aliased = matchPaths(cfg, clean)
    if (aliased) {
      for (const cand of aliased) {
        try {
          const r = resolveModule(fs, cand, '/', BROWSER_OPTS)
          if (r) return r
        } catch {
          /* next */
        }
      }
    }
    if (isBare(clean)) return null
    const fromDir = importer ? dirname(importer) : root
    const r = resolveModule(fs, clean.startsWith('/') && !clean.startsWith(root + '/') ? join(root, clean) : clean, fromDir, BROWSER_OPTS)
    return r || null
  }

  const flagFor = (abs: string, query: string): string => {
    if (/[?&](url|raw|inline)\b/.test(query)) return query
    if (SCRIPT_EXT.test(abs)) return query
    return query ? `${query}&import` : '?import'
  }

  /** Rewrite one import specifier from `importer` to a URL the browser can fetch. */
  const rewrite = (spec: string, importer: string, onLocal?: (abs: string) => void): string => {
    if (/^(https?:|data:|blob:|\/\/|\/@)/.test(spec)) return spec
    const [clean, query] = splitQuery(spec)
    const local = resolveLocal(spec, importer)
    if (local) {
      onLocal?.(local)
      const q = flagFor(local, query)
      const t = hmrStamp.get(local)
      return toUrl(local) + (t ? `${q ? q + '&' : '?'}t=${t}` : q)
    }
    if (isNodeBuiltin(clean)) return '/@cresslet/empty'
    if (/\.(css)$/.test(clean)) return `/@modules/${clean}${query ? query + '&import' : '?import'}`
    return `/@modules/${clean}${query}`
  }

  // ---- transforms ----
  const importsPlugin = (importer: string, locals?: Set<string>, onUnresolved?: () => void): Plugin => ({
    name: 'cresslet-dev-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point') return { path: a.path, namespace: 'cresslet-entry' }
        try {
          let local = false
          const url = rewrite(a.path, a.importer && a.importer !== '<stdin>' ? a.importer : importer, (l) => ((local = true), locals?.add(l)))
          if (!local && /^\.\.?\//.test(a.path)) onUnresolved?.()
          if (url.startsWith('/@modules/')) {
            const s = splitQuery(url.slice('/@modules/'.length))[0]
            if (!s.endsWith('.css')) deps.add([s])
          }
          return { path: url, external: true }
        } catch (e) {
          return { errors: [{ text: e instanceof Error ? e.message : String(e) }] }
        }
      })
      build.onLoad({ filter: /.*/, namespace: 'cresslet-entry' }, (a) => ({ contents: vfs.readText(a.path), loader: loaderOf(a.path), resolveDir: dirname(a.path) }))
    },
  })

  const SCRIPT_LOADERS = new Set(['ts', 'tsx', 'jsx', 'js'])
  /** esbuild's JSX output (automatic or classic runtime): a module without it is not a component module. */
  const JSX_CALL = /(?<![\w$.])(?:jsxs?|jsxDEV|createElement)\d*\s*\(|(?<![\w$.])React\d*\.createElement\s*\(/ // not document.createElement
  const loaderOf = (p: string) => {
    const e = extname(p)
    return e === '.tsx' ? 'tsx' : e === '.ts' || e === '.mts' || e === '.cts' ? 'ts' : e === '.jsx' ? 'jsx' : 'jsx'
  }

  const transformScript = async (abs: string): Promise<string> => {
    const st = vfs.stat(abs)
    const gen = generation.get(abs) ?? 0
    const page = pageGen
    const hit = transformCache.get(abs)
    if (hit && hit.mtime === st.mtimeMs) {
      publish(abs, hit.imports, hit.boundary, gen, page)
      return hit.code
    }
    inflight.set(abs, (inflight.get(abs) ?? 0) + 1)
    try {
      return await buildScript(abs, st.mtimeMs, gen, page)
    } finally {
      const k = (inflight.get(abs) ?? 0) - 1
      if (page === pageGen) k > 0 ? inflight.set(abs, k) : inflight.delete(abs) // a reset already cleared it
    }
  }
  const buildScript = async (abs: string, mtime: number, gen: number, page: number): Promise<string> => {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    const locals = new Set<string>()
    unresolved.delete(abs)
    const r = await es.build({
      entryPoints: [abs],
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      outdir: '/__dev__',
      sourcemap: 'inline',
      sourcesContent: true,
      ...jsxOptions(cfg),
      tsconfigRaw: cfg.tsconfigRaw as never,
      define: defines,
      plugins: [importsPlugin(abs, locals, () => unresolved.add(abs))],
      logLevel: 'silent',
      absWorkingDir: root,
    })
    let code = r.outputFiles[0].text
    let boundary = false
    // every script esbuild loads (incl. .ts hook modules, .js JSX): hooks need signatures wherever they're defined
    if (cfg.refresh && SCRIPT_LOADERS.has(loaderOf(abs))) {
      const rr = refreshTransform(code, toUrl(abs))
      code = rr.code
      // only component modules can be boundaries: a .ts/.js module exporting API_URL / an enum must not self-accept
      boundary = rr.boundary && (loaderOf(abs) === 'jsx' || loaderOf(abs) === 'tsx') && JSX_CALL.test(r.outputFiles[0].text)
    }
    // the graph describes the code the page actually runs, even if the file changed meanwhile
    publish(abs, locals, boundary, gen, page)
    // changed while this transform was in flight: serve it, but don't cache stale code
    if (!fresh(abs, gen, page)) return code
    transformCache.set(abs, { mtime, code, imports: locals, boundary })
    return code
  }
  /**
   * Record a transform's edges/accept, unless it is from a previous page (after a full reload) or a newer transform of
   * the module already published; a stale transform still publishes when nothing newer has (its code is what runs).
   */
  const publish = (abs: string, imports: Set<string>, boundary: boolean, gen: number, page: number) => {
    if (page !== pageGen || gen < (published.get(abs) ?? -1)) return
    published.set(abs, gen)
    graph.setImports(abs, imports)
    graph.ensure(abs).accept = boundary ? 'self' : null
  }

  const transformInline = async (code: string, htmlPath: string): Promise<string> => {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    const locals = new Set<string>()
    const r = await es.build({
      stdin: { contents: code, resolveDir: dirname(htmlPath), loader: 'tsx', sourcefile: htmlPath },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      ...jsxOptions(cfg),
      define: defines,
      plugins: [importsPlugin(htmlPath, locals)],
      logLevel: 'silent',
    })
    for (const l of locals) graph.ensure(l).importers.add(htmlPath)
    return r.outputFiles[0].text
  }

  const cssModule = async (abs: string, asModule: boolean): Promise<string> => {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    const cssDeps = new Set<string>()
    const urlPlugin: Plugin = {
      name: 'cresslet-css-urls',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (a) => {
          if (a.kind === 'entry-point' || a.importer === '<stdin>') return { path: a.path, namespace: 'cresslet-entry' }
          if (/^(https?:|data:|\/\/|#)/.test(a.path)) return { path: a.path, external: true }
          const importer = a.importer || abs
          if (a.kind === 'url-token' || a.kind === 'import-rule') {
            const [clean] = splitQuery(a.path)
            let target: string | null = null
            try {
              target = isBare(clean) && !matchPaths(cfg, clean) ? (resolveModule(fs, clean, dirname(importer), { ...BROWSER_OPTS, conditions: ['style', ...BROWSER_OPTS.conditions] }) as string) : resolveLocal(clean, importer)
            } catch {
              target = null
            }
            if (!target) {
              const pub = join(root, 'public', clean)
              if (clean.startsWith('/') && vfs.isFile(pub)) return { path: clean, external: true }
              return { path: a.path, external: true }
            }
            if (a.kind === 'import-rule') return cssDeps.add(target), { path: target, namespace: 'cresslet-entry' }
            return { path: toUrl(target), external: true }
          }
          if (a.kind === 'composes-from') {
            const t = resolveLocal(a.path, importer)
            if (t) cssDeps.add(t)
            return t ? { path: t, namespace: 'cresslet-entry' } : { path: a.path, external: true }
          }
          return { path: a.path, external: true }
        })
        build.onLoad({ filter: /.*/, namespace: 'cresslet-entry' }, (a) => ({
          contents: vfs.readText(a.path),
          loader: /\.module\.css$/.test(a.path) ? 'local-css' : 'css',
          resolveDir: dirname(a.path),
        }))
      },
    }
    if (/\.module\.css$/.test(abs)) {
      const r = await es.build({
        stdin: { contents: `export { default } from ${JSON.stringify(abs)}`, resolveDir: root, loader: 'js' },
        bundle: true,
        write: false,
        format: 'esm',
        outdir: '/__dev__',
        plugins: [urlPlugin],
        logLevel: 'silent',
      })
      const js = r.outputFiles.find((f) => f.path.endsWith('.js'))!.text
      const css = r.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? ''
      cssDeps.delete(abs)
      trackCss(abs, cssDeps, null) // class names are exports: updates go through the importing component
      return styleModule(css, toUrl(abs), js)
    }
    const r = await es.build({ entryPoints: [abs], bundle: true, write: false, outdir: '/__dev__', plugins: [urlPlugin], logLevel: 'silent' })
    const css = r.outputFiles[0]?.text ?? ''
    if (abs.startsWith(root + '/')) trackCss(abs, cssDeps, asModule ? 'self' : 'link')
    return asModule ? styleModule(css, toUrl(abs)) : css
  }

  const trackCss = (abs: string, imports: Set<string>, accept: 'self' | 'link' | null) => {
    graph.setImports(abs, imports)
    graph.ensure(abs, 'css').accept = accept
    for (const d of imports) graph.ensure(d, 'css')
  }

  const transformHtml = async (abs: string): Promise<string> => {
    let html = vfs.readText(abs).replace(/%(\w+)%/g, (m, k) => (k in env ? String(env[k]) : m))
    graph.setEntries(
      abs,
      findModuleScripts(html).map((src) => {
        const [p] = splitQuery(src)
        return p.startsWith('/') ? fromUrl(p) : join(dirname(abs), p)
      }),
    )
    // transform inline module scripts
    const inline = /<script\b([^>]*\btype\s*=\s*["']?module["']?[^>]*)>([\s\S]*?)<\/script>/gi
    const parts: Promise<string>[] = []
    html.replace(inline, (m, attrs: string, body: string) => {
      parts.push(/\bsrc\s*=/.test(attrs) || !body.trim() ? Promise.resolve(m) : transformInline(body, abs).then((js) => `<script type="module">${js}</script>`, (e) => `<script type="module">${errorModule(formatErrors(e))}</script>`))
      return m
    })
    const done = await Promise.all(parts)
    let i = 0
    html = html.replace(inline, () => done[i++])
    let tag = `<script type="module" src="/@cresslet/client"></script>`
    // React Fast Refresh must hook React before react-dom evaluates: load the runtime ahead of the app's scripts
    if (cfg.refresh) tag += `\n    <script type="module" src="${REFRESH_UTILS_URL}"></script>`
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (h) => `${h}\n    ${tag}`)
    else html = tag + html
    return html
  }

  // ---- initial dependency scan ----
  const indexHtml = join(root, 'index.html')
  if (vfs.isFile(indexHtml)) {
    const entries = findModuleScripts(vfs.readText(indexHtml))
      .map((s) => (s.startsWith('/') ? join(root, s) : join(root, s)))
      .filter((p) => vfs.isFile(p))
    scanImports(vfs, root, entries, { wasmURL: c.esbuildWasmUrl, jsx: jsxOptions(cfg) as unknown as Record<string, string>, resolveLocal: (s, imp) => {
      try {
        return resolveLocal(s, imp || root + '/index.html')
      } catch {
        return ''
      }
    } }).then((found) => deps.add([...found].filter((s) => isBare(s) && !isNodeBuiltin(s) && !/^(https?:|data:)/.test(s))))
  }

  // ---- request handler ----
  const handler = async (req: Request): Promise<Response> => {
    if (o.middleware) {
      const r = await o.middleware(req)
      if (r) return r
    }
    const u = new URL(req.url)
    let pathname: string
    try {
      pathname = decodeURIComponent(u.pathname)
    } catch {
      pathname = u.pathname
    }
    const has = (k: string) => u.searchParams.has(k)
    try {
      if (pathname === '/@cresslet/client') return new Response(clientCode(channelName, `/__cresslet__/${c.instanceId}/${port}`), { headers: JS })
      if (pathname === '/@cresslet/last-error') return new Response(lastError, { headers: { 'content-type': 'text/plain', ...NO_CACHE } })
      if (pathname === '/@cresslet/empty') return new Response('export default {}', { headers: JS })
      if (pathname === REFRESH_UTILS_URL) return new Response(refreshUtilsCode(), { headers: JS })
      if (pathname === REFRESH_RUNTIME_URL) return new Response(refreshRuntimeModule(refreshRuntimeCjs), { headers: JS })
      if (pathname.startsWith('/@modules/')) {
        const spec = pathname.slice('/@modules/'.length)
        if (/^chunk-[\w-]+\.js$/.test(spec.split('/').pop()!) && !deps.has(spec)) {
          const text = await deps.chunk(spec.split('/').pop()!)
          if (text !== undefined) return new Response(text, { headers: JS })
        }
        if (spec.endsWith('.css')) {
          const file = resolveModule(fs, spec, root, { ...BROWSER_OPTS, conditions: ['style', ...BROWSER_OPTS.conditions] })
          if (!file) return new Response('', { headers: JS })
          return new Response(has('import') ? await cssModule(file, true) : await cssModule(file, false), { headers: has('import') ? JS : { 'content-type': 'text/css', ...NO_CACHE } })
        }
        const r = await deps.get(spec)
        return new Response('code' in r ? r.code : errorModule(r.error), { headers: JS })
      }
      let abs = fromUrl(pathname)
      const pub = join(root, 'public', pathname)
      if (!pathname.startsWith('/@fs/') && !has('import') && vfs.isFile(pub)) return fileResponse(pub)
      if (vfs.isDir(abs)) abs = join(abs, 'index.html')
      if (!vfs.isFile(abs)) {
        const accept = req.headers.get('accept') ?? ''
        if ((accept.includes('text/html') || !extname(pathname)) && req.method === 'GET' && vfs.isFile(indexHtml) && !SCRIPT_EXT.test(pathname)) abs = indexHtml
        else if (SCRIPT_EXT.test(pathname) || has('import')) return new Response(errorModule(`Failed to load ${pathname}: file not found`), { status: 404, headers: JS })
        else return new Response(`Not found: ${pathname}`, { status: 404, headers: { 'content-type': 'text/plain' } })
      }
      const ext = extname(abs)
      if (ext === '.html' || ext === '.htm') return new Response(await transformHtml(abs), { headers: { 'content-type': 'text/html; charset=utf-8', ...NO_CACHE } })
      if (has('url')) return new Response(`export default ${JSON.stringify(pathname)}`, { headers: JS })
      if (has('raw')) return new Response(`export default ${JSON.stringify(vfs.readText(abs))}`, { headers: JS })
      if (ext === '.css') return new Response(await cssModule(abs, has('import')), { headers: has('import') ? JS : { 'content-type': 'text/css; charset=utf-8', ...NO_CACHE } })
      if (has('import')) {
        if (ext === '.json') return new Response(`export default ${vfs.readText(abs)}`, { headers: JS })
        if (ASSET_EXT.test(abs) || !SCRIPT_EXT.test(abs)) return new Response(`export default ${JSON.stringify(pathname)}`, { headers: JS })
      }
      if (SCRIPT_EXT.test(abs)) {
        const gen = generation.get(abs) ?? 0
        const page = pageGen
        try {
          const code = await transformScript(abs)
          // a stale success (file changed / page reloaded meanwhile) must not clear a newer error
          if (lastErrorFile === abs && fresh(abs, gen, page)) lastError = lastErrorFile = ''
          return new Response(code, { headers: JS })
        } catch (e) {
          const msg = formatErrors(e)
          // the file changed / the page reloaded while this transform ran: its error is not the page's current problem
          if (fresh(abs, gen, page)) {
            lastError = msg
            lastErrorFile = abs
          }
          return new Response(errorModule(msg), { headers: JS })
        }
      }
      return fileResponse(abs)
    } catch (e) {
      const msg = formatErrors(e)
      return SCRIPT_EXT.test(pathname) || has('import') || pathname.startsWith('/@modules/')
        ? new Response(errorModule(msg), { headers: JS })
        : new Response(msg, { status: 500, headers: { 'content-type': 'text/plain' } })
    }
  }

  const fileResponse = (abs: string) => (served.add(abs), new Response(vfs.readFile(abs) as BodyInit, { headers: { 'content-type': mimeType(abs), ...NO_CACHE } }))

  const url = c.ports.open(port, handler, 'dev-server')
  return {
    url,
    port,
    close() {
      closed = true
      for (const t of [reloadTimer, depsTimer, flushTimer]) if (t) clearTimeout(t)
      watcher.close()
      bc.close()
      c.ports.close(port)
    },
  }
}

