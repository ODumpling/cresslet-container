// Production build of an index.html app: bundle module scripts with esbuild-wasm, hash assets, rewrite html.
import type { Plugin } from 'esbuild-wasm'
import type { Container } from '../container'
import { bundleVfs, formatErrors } from '../esbuild'
import { basename, dirname, extname, join, normalize } from '../path'
import { BROWSER_OPTS, resolveModule } from '../resolve'
import { envDefines, jsxOptions, loadEnv, matchPaths, readProjectConfig, type ProjectConfig } from '../dev/project'
import { contentHash, findTags, isLocalRef, rewriteHtmlForBuild } from './html'

export interface BuildOptions {
  root?: string
  outDir?: string
  minify?: boolean
  sourcemap?: boolean
}

const PROD_RESOLVE = { ...BROWSER_OPTS, conditions: ['browser', 'import', 'module', 'production', 'default'] }

export function pathsPlugin(c: Container, cfg: ProjectConfig): Plugin {
  return {
    name: 'cresslet-tsconfig-paths',
    setup(build) {
      if (!cfg.paths.length) return
      build.onResolve({ filter: /.*/ }, (a) => {
        const cands = matchPaths(cfg, a.path)
        if (!cands) return undefined
        for (const cand of cands) {
          try {
            const r = resolveModule(c.resolveFs, cand, '/', PROD_RESOLVE)
            if (r) return { path: r, namespace: 'cresslet-vfs' }
          } catch {
            /* next */
          }
        }
        return undefined
      })
    },
  }
}

export async function build(c: Container, o: BuildOptions = {}): Promise<{ files: string[] }> {
  const vfs = c.vfs
  const root = normalize(o.root ? (o.root.startsWith('/') ? o.root : join(c.workdir, o.root)) : c.workdir)
  const outDir = normalize(join(root, o.outDir ?? 'dist'))
  const htmlPath = join(root, 'index.html')
  if (!vfs.isFile(htmlPath)) throw new Error(`build: ${htmlPath} not found`)
  const cfg = readProjectConfig(vfs, root)
  const env = loadEnv(vfs, root, 'production')
  let html = vfs.readText(htmlPath).replace(/%(\w+)%/g, (m, k) => (k in env ? String(env[k]) : m))

  const tags = findTags(html)
  const localPath = (ref: string) => normalize(ref.startsWith('/') ? join(root, ref.split(/[?#]/)[0]) : join(root, ref.split(/[?#]/)[0]))
  const scriptRefs = tags.filter((t) => t.name === 'script' && t.attrs.type === 'module' && isLocalRef(t.attrs.src ?? '')).map((t) => t.attrs.src)
  const styleRefs = tags
    .filter((t) => t.name === 'link' && /\bstylesheet\b/i.test(t.attrs.rel ?? '') && isLocalRef(t.attrs.href ?? '') && extname(t.attrs.href.split('?')[0]) === '.css')
    .map((t) => t.attrs.href)
    .filter((h) => vfs.isFile(localPath(h)) && !vfs.isFile(join(root, 'public', h)))
  const entryFor = new Map<string, string>() // abs -> ref
  for (const r of [...scriptRefs, ...styleRefs]) entryFor.set(localPath(r), r)
  if (!scriptRefs.length && !styleRefs.length) throw new Error('build: index.html has no <script type="module" src> entries')

  let result
  try {
    result = await bundleVfs(vfs, {
      cwd: root,
      wasmURL: c.esbuildWasmUrl,
      entryPoints: [...entryFor.keys()],
      outdir: outDir,
      splitting: true,
      format: 'esm',
      target: 'es2020',
      minify: o.minify ?? true,
      sourcemap: o.sourcemap ? 'linked' : false,
      entryNames: 'assets/[name]-[hash]',
      chunkNames: 'assets/[name]-[hash]',
      assetNames: 'assets/[name]-[hash]',
      publicPath: '/',
      metafile: true,
      ...jsxOptions(cfg),
      tsconfigRaw: cfg.tsconfigRaw as never,
      define: { ...envDefines(env), 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
      loader: { '.module.css': 'local-css' },
      plugins: [pathsPlugin(c, cfg)],
      vfsPlugin: { resolve: PROD_RESOLVE },
    })
  } catch (e) {
    throw new Error(`build failed:\n${formatErrors(e)}`)
  }

  vfs.rm(outDir, { recursive: true, force: true })
  const files: string[] = []
  for (const f of result.outputFiles) {
    vfs.writeFile(f.path, f.contents.slice(), { mkdirp: true })
    files.push(f.path)
  }

  // map entries -> outputs
  const url = (abs: string) => '/' + abs.slice(outDir.length + 1)
  const scripts: Record<string, string> = {}
  const styles: Record<string, string> = {}
  const extraCss: string[] = []
  for (const [out, meta] of Object.entries(result.metafile!.outputs)) {
    if (!meta.entryPoint) continue
    const absOut = out.startsWith('/') ? out : normalize(join(root, out))
    const entryAbs = meta.entryPoint.replace(/^cresslet-vfs:/, '')
    const ref = entryFor.get(normalize(entryAbs.startsWith('/') ? entryAbs : join(root, entryAbs)))
    if (!ref) continue
    if (absOut.endsWith('.css')) styles[ref] = url(absOut)
    else {
      scripts[ref] = url(absOut)
      if (meta.cssBundle) extraCss.push(url(meta.cssBundle.startsWith('/') ? meta.cssBundle : normalize(join(root, meta.cssBundle))))
    }
  }

  // copy public/
  const pub = join(root, 'public')
  if (vfs.isDir(pub)) {
    for (const f of vfs.walk(pub)) {
      const dest = join(outDir, f.slice(pub.length + 1))
      vfs.writeFile(dest, vfs.readFile(f).slice(), { mkdirp: true })
      files.push(dest)
    }
  }

  // other local assets referenced from html (icons, images) that are not in public/
  const assets: Record<string, string> = {}
  for (const t of tags) {
    const ref = t.name === 'link' ? t.attrs.href : t.name !== 'script' ? t.attrs.src : undefined
    if (!ref || !isLocalRef(ref) || styles[ref] || assets[ref]) continue
    if (vfs.isFile(join(pub, ref))) continue
    const abs = localPath(ref)
    if (!vfs.isFile(abs)) continue
    const data = vfs.readFile(abs)
    const ext = extname(abs)
    const name = `assets/${basename(abs, ext)}-${contentHash(data)}${ext}`
    vfs.writeFile(join(outDir, name), data.slice(), { mkdirp: true })
    files.push(join(outDir, name))
    assets[ref] = '/' + name
  }

  html = rewriteHtmlForBuild(html, { scripts, styles, assets, extraCss })
  vfs.writeFile(join(outDir, 'index.html'), html, { mkdirp: true })
  files.push(join(outDir, 'index.html'))
  void dirname
  return { files: [...new Set(files)].sort() }
}
