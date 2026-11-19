// Lazy esbuild-wasm singleton + VFS resolve/load plugin.
import * as esbuild from 'esbuild-wasm'
import type { BuildOptions, Loader, Plugin } from 'esbuild-wasm'
import type { VFS } from './vfs'
import { toText } from './vfs'
import { dirname, extname, normalize } from './path'
import { BROWSER_OPTS, isBare, resolveModule, ResolveError, type ResolveOptions } from './resolve'

export type { BuildOptions, BuildResult, Plugin, Loader, Metafile, OutputFile } from 'esbuild-wasm'

export const ESBUILD_VERSION = esbuild.version
export const DEFAULT_WASM_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${esbuild.version}/esbuild.wasm`

let init: Promise<typeof esbuild> | null = null

export function loadEsbuild(wasmURL = DEFAULT_WASM_URL): Promise<typeof esbuild> {
  if (!init) {
    init = esbuild
      .initialize({ wasmURL, worker: typeof Worker !== 'undefined' })
      .then(() => esbuild)
      .catch((e) => {
        // initialize() may only be called once per realm; tolerate a prior call.
        if (String(e).includes('more than once')) return esbuild
        init = null
        throw e
      })
  }
  return init
}

export const LOADERS: Record<string, Loader> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.css': 'css',
  '.txt': 'text',
  '.svg': 'file',
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.gif': 'file',
  '.webp': 'file',
  '.avif': 'file',
  '.ico': 'file',
  '.woff': 'file',
  '.woff2': 'file',
  '.ttf': 'file',
  '.otf': 'file',
  '.eot': 'file',
  '.mp4': 'file',
  '.webm': 'file',
  '.mp3': 'file',
  '.wav': 'file',
  '.wasm': 'file',
}

export function loaderFor(path: string): Loader {
  return LOADERS[extname(path).toLowerCase()] ?? 'js'
}

const NODE_BUILTINS = new Set(
  'assert buffer child_process cluster console constants crypto dgram dns domain events fs fs/promises http http2 https module net os path path/posix process punycode querystring readline repl stream stream/promises string_decoder sys timers timers/promises tls tty url util util/types v8 vm worker_threads zlib async_hooks perf_hooks inspector diagnostics_channel'.split(
    ' ',
  ),
)
export const isNodeBuiltin = (s: string): boolean => s.startsWith('node:') || NODE_BUILTINS.has(s)

export interface VfsPluginOptions {
  resolve?: ResolveOptions
  /** Return a path to mark external (string), or undefined to resolve normally. */
  external?: (spec: string, importer: string, kind: string) => string | undefined | false
  /** Node builtins: 'empty' (browser shim) or 'external'. */
  builtins?: 'empty' | 'external'
}

/** Resolve + load everything from the VFS. */
export function vfsPlugin(vfs: VFS, opts: VfsPluginOptions = {}): Plugin {
  const ropts = opts.resolve ?? BROWSER_OPTS
  const fsAdapter = { isFile: (p: string) => vfs.isFile(p), isDir: (p: string) => vfs.isDir(p), readText: (p: string) => vfs.tryReadText(p) }
  return {
    name: 'cresslet-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === 'cresslet-empty') return undefined
        const spec = args.path
        if (/^(https?:|data:)/.test(spec) || spec.startsWith('//')) return { path: spec, external: true }
        const importer = args.importer || ''
        const ext = opts.external?.(spec, importer, args.kind)
        if (typeof ext === 'string') return { path: ext, external: true }
        if (isBare(spec) && isNodeBuiltin(spec)) {
          if (opts.builtins === 'external') return { path: spec, external: true }
          return { path: spec, namespace: 'cresslet-empty' }
        }
        const fromDir = args.resolveDir || (importer ? dirname(importer) : '/')
        const [clean, query] = splitQuery(spec)
        try {
          const r = resolveModule(fsAdapter, clean, fromDir, ropts)
          if (r === false) return { path: spec, namespace: 'cresslet-empty' }
          return { path: r, namespace: 'cresslet-vfs', suffix: query }
        } catch (e) {
          if (e instanceof ResolveError) return { errors: [{ text: e.message }] }
          throw e
        }
      })
      build.onLoad({ filter: /.*/, namespace: 'cresslet-empty' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
      build.onLoad({ filter: /.*/, namespace: 'cresslet-vfs' }, (args) => {
        const loader = (build.initialOptions.loader?.[extname(args.path)] as Loader | undefined) ?? loaderFor(args.path)
        const data = vfs.readFile(args.path)
        return {
          contents: loader === 'file' || loader === 'binary' || loader === 'dataurl' || loader === 'base64' ? data : toText(data),
          loader,
          resolveDir: dirname(args.path),
        }
      })
    },
  }
}

export function splitQuery(p: string): [string, string] {
  const i = p.search(/[?#]/)
  return i < 0 ? [p, ''] : [p.slice(0, i), p.slice(i)]
}

/** Run esbuild over the VFS. Paths in entryPoints are resolved against `cwd`. */
export async function bundleVfs(
  vfs: VFS,
  options: BuildOptions & { cwd?: string; wasmURL?: string; vfsPlugin?: VfsPluginOptions },
): Promise<esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }> {
  const { cwd = '/', wasmURL, vfsPlugin: vopts, ...rest } = options
  const es = await loadEsbuild(wasmURL)
  const fix = (p: string) => (p.startsWith('/') || /^[\w-]{2,}:/.test(p) ? p : normalize(`${cwd}/${p}`))
  let entryPoints = rest.entryPoints
  if (Array.isArray(entryPoints)) entryPoints = (entryPoints as (string | { in: string; out: string })[]).map((e) => (typeof e === 'string' ? fix(e) : { ...e, in: fix(e.in) })) as string[]
  else if (entryPoints && typeof entryPoints === 'object')
    entryPoints = Object.fromEntries(Object.entries(entryPoints).map(([k, v]) => [k, fix(v as string)]))
  const result = await es.build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    ...rest,
    entryPoints,
    absWorkingDir: cwd,
    outdir: rest.outdir ? fix(rest.outdir) : rest.outfile ? undefined : '/__out__',
    outfile: rest.outfile ? fix(rest.outfile) : undefined,
    write: false,
    plugins: [...(rest.plugins ?? []), vfsPlugin(vfs, vopts)],
  })
  return result as esbuild.BuildResult & { outputFiles: esbuild.OutputFile[] }
}

export function formatErrors(e: unknown): string {
  const errs = (e as { errors?: esbuild.Message[] }).errors
  if (Array.isArray(errs) && errs.length) {
    return errs
      .map((m) => {
        const loc = m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ` : ''
        const snippet = m.location?.lineText ? `\n    ${m.location.lineText}\n    ${' '.repeat(m.location.column)}^` : ''
        return `${loc}${m.text}${snippet}`
      })
      .join('\n')
  }
  return e instanceof Error ? e.message : String(e)
}
