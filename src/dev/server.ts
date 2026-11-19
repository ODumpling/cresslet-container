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
  const channelName = `clover:${c.instanceId}:${port}`
  const bc = new BroadcastChannel(channelName)
  const vfs = c.vfs
  const fs = c.resolveFs
  let cfg: ProjectConfig = readProjectConfig(vfs, root)
  let env = loadEnv(vfs, root, 'development')
  let defines = { ...envDefines(env), 'process.env.NODE_ENV': '"development"' }
  const deps = new DepOptimizer(vfs, fs, root, { wasmURL: c.esbuildWasmUrl, define: { 'process.env.NODE_ENV': '"development"' } })
  deps.onStale = () => scheduleReload('dependencies re-optimized')
  const transformCache = new Map<string, { mtime: number; code: string }>()

  // ---- file watching -> live reload ----
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let depsTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleReload = (_why: string) => {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      bc.postMessage({ type: 'reload' })
    }, 60)
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
    scheduleReload(file)
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
  const rewrite = (spec: string, importer: string): string => {
    if (/^(https?:|data:|blob:|\/\/|\/@)/.test(spec)) return spec
    const [clean, query] = splitQuery(spec)
    const local = resolveLocal(spec, importer)
    if (local) return toUrl(local) + flagFor(local, query)
    if (isNodeBuiltin(clean)) return '/@clover/empty'
    if (/\.(css)$/.test(clean)) return `/@modules/${clean}${query ? query + '&import' : '?import'}`
    return `/@modules/${clean}${query}`
  }

  // ---- transforms ----
  const importsPlugin = (importer: string): Plugin => ({
    name: 'clover-dev-imports',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === 'entry-point') return { path: a.path, namespace: 'clover-entry' }
        try {
          const url = rewrite(a.path, a.importer && a.importer !== '<stdin>' ? a.importer : importer)
          if (url.startsWith('/@modules/')) {
            const s = splitQuery(url.slice('/@modules/'.length))[0]
            if (!s.endsWith('.css')) deps.add([s])
          }
          return { path: url, external: true }
        } catch (e) {
          return { errors: [{ text: e instanceof Error ? e.message : String(e) }] }
        }
      })
      build.onLoad({ filter: /.*/, namespace: 'clover-entry' }, (a) => ({ contents: vfs.readText(a.path), loader: loaderOf(a.path), resolveDir: dirname(a.path) }))
    },
  })

  const loaderOf = (p: string) => {
    const e = extname(p)
    return e === '.tsx' ? 'tsx' : e === '.ts' || e === '.mts' || e === '.cts' ? 'ts' : e === '.jsx' ? 'jsx' : 'jsx'
  }

  const transformScript = async (abs: string): Promise<string> => {
    const st = vfs.stat(abs)
    const hit = transformCache.get(abs)
    if (hit && hit.mtime === st.mtimeMs) return hit.code
    const es = await loadEsbuild(c.esbuildWasmUrl)
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
      plugins: [importsPlugin(abs)],
      logLevel: 'silent',
      absWorkingDir: root,
    })
    const code = r.outputFiles[0].text
    transformCache.set(abs, { mtime: st.mtimeMs, code })
    return code
  }

  const transformInline = async (code: string, htmlPath: string): Promise<string> => {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    const r = await es.build({
      stdin: { contents: code, resolveDir: dirname(htmlPath), loader: 'tsx', sourcefile: htmlPath },
      bundle: true,
      write: false,
      format: 'esm',
      target: 'es2022',
      ...jsxOptions(cfg),
      define: defines,
      plugins: [importsPlugin(htmlPath)],
      logLevel: 'silent',
    })
    return r.outputFiles[0].text
  }

  const cssModule = async (abs: string, asModule: boolean): Promise<string> => {
    const es = await loadEsbuild(c.esbuildWasmUrl)
    const urlPlugin: Plugin = {
      name: 'clover-css-urls',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (a) => {
          if (a.kind === 'entry-point') return { path: a.path, namespace: 'clover-entry' }
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
            if (a.kind === 'import-rule') return { path: target, namespace: 'clover-entry' }
            return { path: toUrl(target), external: true }
          }
          if (a.kind === 'composes-from') {
            const t = resolveLocal(a.path, importer)
            return t ? { path: t, namespace: 'clover-entry' } : { path: a.path, external: true }
          }
          return { path: a.path, external: true }
        })
        build.onLoad({ filter: /.*/, namespace: 'clover-entry' }, (a) => ({
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
      return styleModule(css, toUrl(abs), js)
    }
    const r = await es.build({ entryPoints: [abs], bundle: true, write: false, outdir: '/__dev__', plugins: [urlPlugin], logLevel: 'silent' })
    const css = r.outputFiles[0]?.text ?? ''
    return asModule ? styleModule(css, toUrl(abs)) : css
  }

  const transformHtml = async (abs: string): Promise<string> => {
    let html = vfs.readText(abs)
    html = html.replace(/%(\w+)%/g, (m, k) => (k in env ? String(env[k]) : m))
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
    const tag = `<script type="module" src="/@clover/client"></script>`
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
      if (pathname === '/@clover/client') return new Response(clientCode(channelName), { headers: JS })
      if (pathname === '/@clover/empty') return new Response('export default {}', { headers: JS })
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
        try {
          return new Response(await transformScript(abs), { headers: JS })
        } catch (e) {
          return new Response(errorModule(formatErrors(e)), { headers: JS })
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

  const fileResponse = (abs: string) => new Response(vfs.readFile(abs) as BodyInit, { headers: { 'content-type': mimeType(abs), ...NO_CACHE } })

  const url = c.ports.open(port, handler, 'dev-server')
  return {
    url,
    port,
    close() {
      watcher.close()
      bc.close()
      c.ports.close(port)
    },
  }
}

