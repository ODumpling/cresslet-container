// Project config shared by dev server + build: .env, tsconfig (jsx, paths), mime types.
import type { VFS } from '../vfs'
import { dirname, extname, join, normalize } from '../path'

export function parseJsonc(text: string): unknown {
  let out = ''
  let i = 0
  let inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inStr = false
      i++
    } else if (c === '"') {
      inStr = true
      out += c
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line)
    if (!m) continue
    let v = (m[2] ?? '').trim()
    const q = v[0]
    if ((q === '"' || q === "'" || q === '`') && v.endsWith(q)) {
      v = v.slice(1, -1)
      if (q === '"') v = v.replace(/\\n/g, '\n')
    } else v = v.replace(/\s+#.*$/, '')
    out[m[1]] = v
  }
  return out
}

/** Vite-style env: .env, .env.local, .env.[mode], .env.[mode].local; only VITE_* exposed. */
export function loadEnv(vfs: VFS, root: string, mode: string, prefix = 'VITE_'): Record<string, string | boolean> {
  const all: Record<string, string> = {}
  for (const f of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const t = vfs.tryReadText(join(root, f))
    if (t != null) Object.assign(all, parseDotenv(t))
  }
  const env: Record<string, string | boolean> = { MODE: mode, DEV: mode !== 'production', PROD: mode === 'production', SSR: false, BASE_URL: '/' }
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) env[k] = v
  return env
}

export function envDefines(env: Record<string, string | boolean>): Record<string, string> {
  const d: Record<string, string> = { 'import.meta.env': JSON.stringify(env), 'import.meta.hot': 'undefined' }
  for (const [k, v] of Object.entries(env)) d[`import.meta.env.${k}`] = JSON.stringify(v)
  return d
}

export interface ProjectConfig {
  jsx: 'automatic' | 'transform' | 'preserve'
  jsxImportSource: string
  jsxFactory?: string
  jsxFragment?: string
  /** tsconfig `paths` as [prefix, replacement dirs] with '*' wildcard support */
  paths: { pattern: string; targets: string[] }[]
  tsconfigRaw: Record<string, unknown>
  /** React DOM project with React JSX: enable React Fast Refresh in the dev server. */
  refresh: boolean
  /** Preact project with Preact JSX (and no React Fast Refresh): enable prefresh in the dev server. */
  preactRefresh: boolean
}

export function readProjectConfig(vfs: VFS, root: string): ProjectConfig {
  let co: Record<string, unknown> = {}
  let baseDir = root
  const load = (file: string, depth = 0): void => {
    const t = vfs.tryReadText(file)
    if (t == null || depth > 4) return
    let j: { extends?: string; compilerOptions?: Record<string, unknown>; references?: { path: string }[] }
    try {
      j = parseJsonc(t) as typeof j
    } catch {
      return
    }
    if (typeof j.extends === 'string' && j.extends.startsWith('.')) load(normalize(join(dirname(file), j.extends.endsWith('.json') ? j.extends : j.extends + '.json')), depth + 1)
    if (j.compilerOptions) {
      co = { ...co, ...j.compilerOptions }
      if (j.compilerOptions.baseUrl || j.compilerOptions.paths) baseDir = dirname(file)
    }
    // Vite templates: tsconfig.json -> references tsconfig.app.json
    if (!j.compilerOptions && j.references) for (const r of j.references) {
      const p = normalize(join(dirname(file), r.path))
      load(p.endsWith('.json') ? p : join(p, 'tsconfig.json'), depth + 1)
    }
  }
  load(join(root, 'tsconfig.json'))
  if (!Object.keys(co).length) load(join(root, 'jsconfig.json'))
  const pkg = vfs.tryReadText(join(root, 'package.json'))
  let deps: Record<string, string> = {}
  try {
    const j = pkg ? JSON.parse(pkg) : {}
    deps = { ...j.devDependencies, ...j.dependencies }
  } catch {
    /* ignore */
  }
  let jsxImportSource = (co.jsxImportSource as string) || (deps.react ? 'react' : deps.preact ? 'preact' : deps['solid-js'] ? 'solid-js/h' : 'react')
  const tsJsx = String(co.jsx ?? '').toLowerCase()
  const classic = tsJsx === 'react' || (!!co.jsxFactory && !co.jsxImportSource)
  if (tsJsx === 'preserve' && deps.preact) jsxImportSource = 'preact'
  const baseUrl = co.baseUrl ? normalize(join(baseDir, co.baseUrl as string)) : baseDir
  const paths = Object.entries((co.paths as Record<string, string[]>) ?? {}).map(([pattern, targets]) => ({
    pattern,
    targets: targets.map((t) => normalize(join(baseUrl, t))),
  }))
  const pick = ['experimentalDecorators', 'emitDecoratorMetadata', 'useDefineForClassFields', 'verbatimModuleSyntax', 'preserveValueImports', 'importsNotUsedAsValues']
  const tsconfigRaw = { compilerOptions: Object.fromEntries(pick.filter((k) => k in co).map((k) => [k, co[k]])) }
  const refresh = !!deps['react-dom'] && (classic ? !co.jsxFactory || /^React\./.test(String(co.jsxFactory)) : jsxImportSource === 'react')
  return {
    jsx: classic ? 'transform' : 'automatic',
    jsxImportSource,
    jsxFactory: co.jsxFactory as string | undefined,
    jsxFragment: co.jsxFragmentFactory as string | undefined,
    paths,
    tsconfigRaw,
    refresh,
    preactRefresh: !refresh && !!deps.preact && (classic ? /^(h|preact\.h|createElement|preact\.createElement)$/.test(String(co.jsxFactory ?? '')) : jsxImportSource === 'preact'),
  }
}

/** Apply tsconfig paths; returns candidate absolute paths (unresolved) or null. */
export function matchPaths(cfg: ProjectConfig, spec: string): string[] | null {
  for (const { pattern, targets } of cfg.paths) {
    const star = pattern.indexOf('*')
    if (star < 0) {
      if (spec === pattern) return targets
      continue
    }
    const pre = pattern.slice(0, star)
    const post = pattern.slice(star + 1)
    if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
      const mid = spec.slice(pre.length, spec.length - post.length)
      return targets.map((t) => t.replace('*', mid))
    }
  }
  return null
}

export function jsxOptions(cfg: ProjectConfig) {
  return cfg.jsx === 'automatic'
    ? { jsx: 'automatic' as const, jsxImportSource: cfg.jsxImportSource }
    : { jsx: 'transform' as const, jsxFactory: cfg.jsxFactory ?? 'React.createElement', jsxFragment: cfg.jsxFragment ?? 'React.Fragment' }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json',
}
export const mimeType = (p: string): string => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

export const SCRIPT_EXT = /\.(m?[jt]sx?|cjs|cts|mts)$/
export const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf|wasm|txt)$/i
