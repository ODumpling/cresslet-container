'use strict'
// CSS worker: PostCSS (the project's own `postcss` + config plugins) and Tailwind CSS v4 (the project's own
// `tailwindcss`, via its pure-JS `compile()` API) over the VFS. Runs as a long-lived `node` process in cresslet's node
// worker (requests/responses as JSON lines on stdin/stdout), and in plain Node for the unit tests (`handle()`).
// Content scanning (Tailwind's native "oxide" scanner) is done by the caller: requests carry the candidate list.
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

/** Marks protocol lines on stdout (plugins may console.log). */
const MARK = '\u0000cresslet-css\u0000'
/** CSS that needs Tailwind (keep in sync with TAILWIND_RE in pipeline.ts). */
const TAILWIND_RE = /@(?:import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']|tailwind\b|theme\b|apply\b|utility\b|variant\b|custom-variant\b|plugin\b|config\b|source\b|reference\b)|--(?:theme|spacing|alpha)\(/

/** file -> { css, compiler, deps: Map<path, mtime> } */
const compilers = new Map()
/** config path -> { mtime, config } */
const configs = new Map()

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return -1
  }
}
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}
const projectRequire = (root) => createRequire(path.join(root, 'package.json'))
const interop = (m) => (m && m.__esModule && 'default' in m ? m.default : m)

/** Pick a package.json `exports` target for CSS: the `style` condition first. */
function exportTarget(exp, sub) {
  if (exp == null) return null
  const cond = (v) => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(cond).find(Boolean) ?? null
    if (v && typeof v === 'object') for (const k of ['style', 'default', 'import', 'require']) if (k in v) return cond(v[k])
    return null
  }
  const keys = typeof exp === 'object' && !Array.isArray(exp) ? Object.keys(exp) : []
  if (!keys.some((k) => k.startsWith('.'))) return sub === '.' ? cond(exp) : null
  if (sub in exp) return cond(exp[sub])
  for (const k of keys) {
    const star = k.indexOf('*')
    if (star < 0) continue
    const pre = k.slice(0, star)
    const post = k.slice(star + 1)
    if (sub.startsWith(pre) && sub.endsWith(post) && sub.length >= pre.length + post.length) {
      const t = cond(exp[k])
      return t && t.replace('*', sub.slice(pre.length, sub.length - post.length))
    }
  }
  return null
}

/** Resolve a CSS `@import` the way vite/@tailwindcss/node do: relative paths, or packages via `style`/exports. */
function resolveStylesheet(id, base) {
  const tryFile = (p) => [p, p + '.css', path.join(p, 'index.css')].find(isFile)
  if (id.startsWith('.') || id.startsWith('/')) {
    const f = tryFile(path.resolve(base, id))
    if (f) return f
    throw new Error(`Can't resolve '${id}' from ${base}`)
  }
  const parts = id.split('/')
  const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
  const sub = id.slice(name.length)
  for (let dir = base; ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, 'node_modules', name)
    const pj = path.join(pkgDir, 'package.json')
    if (isFile(pj)) {
      const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
      const t = exportTarget(pkg.exports, '.' + sub)
      if (t) return path.join(pkgDir, t)
      if (!pkg.exports) {
        const f = sub ? tryFile(path.join(pkgDir, sub)) : tryFile(path.join(pkgDir, pkg.style || 'index.css'))
        if (f) return f
      }
      throw new Error(`Can't resolve '${id}': no stylesheet in ${pkgDir}`)
    }
    if (dir === path.dirname(dir)) break
  }
  throw new Error(`Can't resolve '${id}' from ${base} (is it installed?)`)
}

/** Inlined `@import`s: make relative `url()`s relative to the importing stylesheet again (as vite does). */
function rebaseUrls(css, fromDir, toDir) {
  if (fromDir === toDir || fromDir.includes('/node_modules/')) return css
  return css.replace(/url\(\s*(['"]?)(\.{1,2}\/[^'")\s]+)\1\s*\)/g, (_m, q, ref) => {
    let rel = path.relative(toDir, path.resolve(fromDir, ref))
    if (!rel.startsWith('.')) rel = './' + rel
    return `url(${q}${rel}${q})`
  })
}

function stale(deps) {
  for (const [p, m] of deps) if (mtime(p) !== m) return true
  return false
}

/** Tailwind v4: compile (cached per file + source + deps) and build with the request's candidates. */
async function tailwind(req, css, from, out) {
  const r = projectRequire(req.root)
  let tw
  try {
    tw = r('tailwindcss')
  } catch (e) {
    throw new Error(`Tailwind CSS syntax in ${from}, but the \`tailwindcss\` package can't be loaded: ${e.message}`)
  }
  if (typeof tw.compile !== 'function') {
    let v = '?'
    try {
      v = r('tailwindcss/package.json').version
    } catch {}
    throw new Error(`tailwindcss ${v}: Tailwind CSS v3 runs as a PostCSS plugin (add a postcss.config.js with { plugins: { tailwindcss: {} } }), or upgrade to v4`)
  }
  let e = compilers.get(from)
  if (!e || e.css !== css || stale(e.deps)) {
    if (e) for (const p of e.deps.keys()) if (!p.includes('/node_modules/')) delete require.cache[p]
    const deps = new Map()
    const compiler = await tw.compile(css, {
      base: path.dirname(from),
      from,
      loadStylesheet: async (id, base) => {
        const p = resolveStylesheet(id, base)
        deps.set(p, mtime(p))
        return { path: p, base: path.dirname(p), content: rebaseUrls(fs.readFileSync(p, 'utf8'), path.dirname(p), path.dirname(from)) }
      },
      loadModule: async (id, base) => {
        const p = createRequire(path.join(base, '__cresslet__.js')).resolve(id)
        deps.set(p, mtime(p))
        if (!p.includes('/node_modules/')) delete require.cache[p]
        return { path: p, base: path.dirname(p), module: interop(require(p)) }
      },
    })
    e = { css, compiler, deps }
    compilers.set(from, e)
  }
  for (const p of e.deps.keys()) out.deps.add(p)
  out.tailwind.push({ sources: e.compiler.sources, root: e.compiler.root })
  return e.compiler.build(req.candidates || [])
}

/** Stand-in for `@tailwindcss/postcss` (which needs native oxide + lightningcss): same plugin, our compiler. */
function tailwindPostcss() {
  return {
    postcssPlugin: '@tailwindcss/postcss',
    async Once(root, { result, postcss }) {
      const ctx = result.opts.cresslet
      const from = result.opts.from
      const css = root.toString()
      if (!ctx || !TAILWIND_RE.test(css)) return
      const parsed = postcss.parse(await tailwind(ctx.req, css, from, ctx.out), { from })
      root.removeAll()
      root.append(parsed.nodes)
    },
  }
}
tailwindPostcss.postcss = true

function loadConfig(file, root, env) {
  const m = mtime(file)
  const hit = configs.get(file)
  if (hit && hit.mtime === m && hit.env === env) return hit.config
  delete require.cache[file]
  const r = projectRequire(root)
  // configs that `import tailwindcss from '@tailwindcss/postcss'` get the stand-in
  try {
    const p = r.resolve('@tailwindcss/postcss')
    require.cache[p] = { id: p, filename: p, path: path.dirname(p), loaded: true, exports: Object.assign(tailwindPostcss, { default: tailwindPostcss }), children: [], paths: [] }
  } catch {}
  let config = interop(require(file))
  if (typeof config === 'function') config = config({ env, cwd: root })
  configs.set(file, { mtime: m, env, config })
  return config
}

function plugins(config, root) {
  const r = projectRequire(root)
  const load = (name, opts) => {
    if (name === '@tailwindcss/postcss') return tailwindPostcss()
    let p
    try {
      p = interop(r(name))
    } catch (e) {
      throw new Error(`PostCSS plugin '${name}' can't be loaded: ${e.message}`)
    }
    return typeof p === 'function' ? p(opts && typeof opts === 'object' && Object.keys(opts).length ? opts : undefined) : p
  }
  const list = config && config.plugins
  if (!list) return []
  if (Array.isArray(list))
    return list.filter(Boolean).map((p) => (typeof p === 'string' ? load(p) : Array.isArray(p) ? load(p[0], p[1]) : p))
  return Object.entries(list)
    .filter(([, o]) => o !== false)
    .map(([name, o]) => load(name, o))
}

/**
 * req: { root, file, css, candidates?, postcssConfig?: abs path | null, env?: 'development' | 'production' }
 * -> { css, deps: abs paths the output depends on, dirs: content directories (PostCSS `dir-dependency`),
 *      tailwind: [{ sources, root }] (one per Tailwind v4 compile), warnings }
 */
async function handle(req) {
  const out = { deps: new Set(), dirs: new Set(), tailwind: [], warnings: [] }
  let css
  if (req.postcssConfig) {
    let postcss
    try {
      postcss = interop(projectRequire(req.root)('postcss'))
    } catch {
      throw new Error(`${path.basename(req.postcssConfig)} found, but the \`postcss\` package is not installed (npm install -D postcss)`)
    }
    const config = loadConfig(req.postcssConfig, req.root, req.env || 'development')
    const res = await postcss(plugins(config, req.root)).process(req.css, { from: req.file, to: req.file, map: false, cresslet: { req, out } })
    css = res.css
    for (const m of res.messages) {
      if (m.type === 'dependency' && m.file) out.deps.add(m.file)
      // Tailwind v3 (and other content-scanning plugins) report their content globs
      else if (m.type === 'dir-dependency' && m.dir) out.dirs.add(m.dir)
    }
    for (const w of res.warnings()) out.warnings.push(w.toString())
  } else css = await tailwind(req, req.css, req.file, out)
  return { css, deps: [...out.deps], dirs: [...out.dirs], tailwind: out.tailwind, warnings: out.warnings }
}

function serve() {
  let buf = ''
  let queue = Promise.resolve()
  const reply = (m) => process.stdout.write(MARK + JSON.stringify(m) + '\n')
  process.stdin.on('data', (d) => {
    buf += String(d)
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      queue = queue.then(
        () => handle(msg).then(
          (r) => reply({ id: msg.id, ok: true, ...r }),
          (e) => reply({ id: msg.id, ok: false, error: formatError(e) }),
        ),
      )
    }
  })
  process.stdin.resume()
  reply({ id: 0, ok: true, ready: true })
}

function formatError(e) {
  if (!e || typeof e !== 'object') return String(e)
  // CssSyntaxError: file:line:col + snippet
  if (e.name === 'CssSyntaxError' && typeof e.showSourceCode === 'function') return `${e.file || ''}:${e.line}:${e.column}: ${e.reason}\n${e.showSourceCode(false)}`
  const plugin = e.plugin ? `[${e.plugin}] ` : ''
  return plugin + (e.message || String(e))
}

module.exports = { handle, resolveStylesheet, exportTarget, rebaseUrls, formatError, MARK, TAILWIND_RE }
if (require.main === module) serve()
