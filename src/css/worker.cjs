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

/** `${session}\0${file}` -> { css, compiler, deps: Map<path, signature>, set: candidate set it was built with } */
const compilers = new Map()
/** candidate set id (`${session}:${scanner}`) -> Set (requests carry only what's new) */
const sets = new Map()
/** `${config}\0${env}\0${tailwind}` -> { sig, config, plugins } */
const configs = new Map()

/** A file's revision: mtime+size for packages, size+content hash for project files (two edits in one ms). */
const sig = (p) => {
  try {
    const st = fs.statSync(p)
    if (p.includes('/node_modules/')) return `${st.mtimeMs}:${st.size}`
    const b = fs.readFileSync(p)
    let h = 0x811c9dc5
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193)
    return `${st.size}:${(h >>> 0).toString(36)}`
  } catch {
    return 'missing'
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

/** Whether a url() reference is relative to its stylesheet (not absolute, data:, a fragment, protocol-relative, ...). */
const isRelativeUrl = (u) => !!u && !/^(?:[a-z][a-z\d+.-]*:|\/|#|~|%23)/i.test(u) && !u.startsWith('{{')

/**
 * Inlined `@import`s: make relative `url()`s relative to the importing stylesheet again (as vite does), package CSS
 * included. A CSS tokenizer's view of url(): unquoted, or a single/double-quoted string (spaces, escapes); comments,
 * other strings and `@import` preludes (resolved by the compiler against their own file) are left alone.
 */
function rebaseUrls(css, fromDir, toDir) {
  if (fromDir === toDir) return css
  let out = ''
  let last = 0
  const n = css.length
  const rebase = (ref) => {
    const m = /^([^?#]*)(.*)$/s.exec(ref)
    let rel = path.relative(toDir, path.resolve(fromDir, m[1]))
    if (!rel.startsWith('.')) rel = './' + rel
    return rel + m[2]
  }
  for (let i = 0; i < n; ) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
    } else if (ch === '"' || ch === "'") i = skipString(css, i)
    else if (ch === '@' && /^@import\b/i.test(css.slice(i, i + 8))) {
      // to the end of the prelude
      for (i += 7; i < n && css[i] !== ';' && css[i] !== '{'; ) i = css[i] === '"' || css[i] === "'" ? skipString(css, i) : i + 1
    } else if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] || '')) {
      let j = i + 4
      while (j < n && /\s/.test(css[j])) j++
      let ref, q, end
      if (css[j] === '"' || css[j] === "'") {
        q = css[j]
        const e = skipString(css, j)
        ref = css.slice(j + 1, e - 1).replace(/\\(.)/g, '$1')
        end = e
        while (end < n && /\s/.test(css[end])) end++
        if (css[end] !== ')') {
          i = end
          continue
        }
      } else {
        q = ''
        end = j
        while (end < n && css[end] !== ')' && !/[\s"'(]/.test(css[end])) end++
        ref = css.slice(j, end).replace(/\\(.)/g, '$1')
        let k = end
        while (k < n && /\s/.test(css[k])) k++
        if (css[k] !== ')') {
          i = k
          continue
        }
        end = k
      }
      if (isRelativeUrl(ref)) {
        const next = rebase(ref)
        const quote = q || (/[\s"'()\\]/.test(next) ? '"' : '')
        out += css.slice(last, i) + `url(${quote}${quote ? next.replace(/[\\"']/g, (c) => (c === quote || c === '\\' ? '\\' + c : c)) : next}${quote})`
        last = end + 1
      }
      i = end + 1
    } else i++
  }
  return out + css.slice(last)
}

function skipString(css, i) {
  const q = css[i]
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === '\\') j++
    else if (css[j] === q || css[j] === '\n') return j + 1
  }
  return css.length
}

/** Drop the project's own modules (configs, plugins and their helpers) from require.cache: the next require re-runs them. */
function dropProjectModules(root) {
  let real = root
  try {
    real = fs.realpathSync(root)
  } catch {}
  const pres = [root, real].map((r) => (r.endsWith('/') ? r : r + '/'))
  for (const k of Object.keys(require.cache)) if (pres.some((p) => k.startsWith(p)) && !k.includes('/node_modules/')) delete require.cache[k]
}

/** Paths a failed relative `@import` / `@plugin` / `@config` might be created at. */
function attempted(id, base, exts) {
  if (!id.startsWith('.') && !id.startsWith('/')) return []
  const p = path.resolve(base, id)
  return path.extname(p) ? [p] : [p, ...exts.map((e) => p + e)]
}

function stale(deps) {
  for (const [p, m] of deps) if (sig(p) !== m) return true
  return false
}

/** The request's candidates: its whole candidate set when it names one (requests carry deltas). */
function candidatesOf(req) {
  if (!req.candidateSet) return req.candidates || []
  let s = sets.get(req.candidateSet)
  if (!s || req.candidatesReset) sets.set(req.candidateSet, (s = new Set()))
  for (const c of req.candidates || []) s.add(c)
  return s
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
  const key = `${req.session || ''}\0${from}`
  const set = req.candidateSet || null
  let e = compilers.get(key)
  // a compiler accumulates candidates: a different candidate set (its source rules changed) needs a fresh one
  if (!e || e.css !== css || stale(e.deps) || (!req.discover && e.set !== undefined && e.set !== set)) {
    dropProjectModules(req.root)
    const deps = new Map()
    const record = (p) => deps.set(p, sig(p))
    try {
      const compiler = await tw.compile(css, {
        base: path.dirname(from),
        from,
        loadStylesheet: async (id, base) => {
          let p
          try {
            p = resolveStylesheet(id, base)
          } catch (err) {
            for (const a of attempted(id, base, ['.css'])) record(a)
            throw err
          }
          record(p)
          return { path: p, base: path.dirname(p), content: rebaseUrls(fs.readFileSync(p, 'utf8'), path.dirname(p), path.dirname(from)) }
        },
        loadModule: async (id, base, hint) => {
          if (req.plugins === false) throw new Error(`@${hint === 'config' ? 'config' : 'plugin'} '${id}' not loaded: project CSS plugins are disabled (boot({ cssPlugins: false }))`)
          let p
          try {
            p = createRequire(path.join(base, '__cresslet__.js')).resolve(id)
          } catch (err) {
            for (const a of attempted(id, base, ['.js', '.cjs', '.mjs', '.ts', '.mts', '.cts'])) record(a)
            throw err
          }
          record(p)
          return { path: p, base: path.dirname(p), module: interop(require(p)) }
        },
      })
      e = { css, compiler, deps, set: undefined }
    } catch (err) {
      for (const p of deps.keys()) out.deps.add(p)
      throw err
    }
    compilers.set(key, e)
  }
  for (const p of e.deps.keys()) out.deps.add(p)
  out.tailwind.push({ sources: e.compiler.sources, root: e.compiler.root })
  if (req.discover) return ''
  e.set = set
  return e.compiler.build([...candidatesOf(req)])
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

/** Whether a project's tailwindcss is v4 (has the compile() API). */
function tailwindV4(root) {
  try {
    return typeof projectRequire(root)('tailwindcss').compile === 'function'
  } catch {
    return false
  }
}

const TAILWIND_PLUGINS = new Set(['tailwindcss', '@tailwindcss/postcss'])
const pluginName = (p) => (p && (p.postcssPlugin || (typeof p === 'function' && p.name))) || ''

/** A PostCSS config's plugin instances, cached with the config (per env, and whether Tailwind v4 joins them). */
function loadConfig(file, root, env, tailwind) {
  const key = `${file}\0${env}\0${tailwind ? 1 : 0}`
  const s = sig(file)
  const hit = configs.get(key)
  if (hit && hit.sig === s) return hit
  dropProjectModules(root)
  const r = projectRequire(root)
  // configs that `import tailwindcss from '@tailwindcss/postcss'` get the stand-in
  try {
    const p = r.resolve('@tailwindcss/postcss')
    require.cache[p] = { id: p, filename: p, path: path.dirname(p), loaded: true, exports: Object.assign(tailwindPostcss, { default: tailwindPostcss }), children: [], paths: [] }
  } catch {}
  let config = interop(require(file))
  if (typeof config === 'function') config = config({ env, cwd: root })
  const list = plugins(config, root)
  // Tailwind v4 without a Tailwind plugin in the config (it came from @tailwindcss/vite, say): compile it first, as
  // the vite plugin would, then the config's plugins; an explicit `tailwindcss` (v3) plugin keeps its place
  if (tailwind && !list.some((p) => TAILWIND_PLUGINS.has(pluginName(p))) && tailwindV4(root)) list.unshift(tailwindPostcss())
  const e = { sig: s, config, plugins: list }
  configs.set(key, e)
  return e
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
  // plugins and configs see the request's mode (a production build: NODE_ENV=production)
  process.env.NODE_ENV = req.env || 'development'
  const out = { deps: new Set(), dirs: new Set(), tailwind: [], warnings: [] }
  try {
    candidatesOf(req) // record the delta first: it was sent once, whatever happens to this request
    let css
    if (req.postcssConfig && req.plugins !== false) {
      let postcss
      try {
        postcss = interop(projectRequire(req.root)('postcss'))
      } catch {
        throw new Error(`${path.basename(req.postcssConfig)} found, but the \`postcss\` package is not installed (npm install -D postcss)`)
      }
      const { plugins: list } = loadConfig(req.postcssConfig, req.root, req.env || 'development', !!req.tailwind)
      const res = await postcss(list).process(req.css, { from: req.file, to: req.file, map: false, cresslet: { req, out } })
      css = res.css
      for (const m of res.messages) {
        if (m.type === 'dependency' && m.file) out.deps.add(m.file)
        // Tailwind v3 (and other content-scanning plugins) report their content globs
        else if (m.type === 'dir-dependency' && m.dir) out.dirs.add(m.dir)
      }
      for (const w of res.warnings()) out.warnings.push(w.toString())
    } else css = await tailwind(req, req.css, req.file, out)
    return { css, deps: [...out.deps], dirs: [...out.dirs], tailwind: out.tailwind, warnings: out.warnings }
  } catch (e) {
    throw Object.assign(e && typeof e === 'object' ? e : new Error(String(e)), { deps: [...out.deps], dirs: [...out.dirs] })
  }
}

/** Forget a session's compilers and candidate sets. */
function release(session) {
  for (const k of compilers.keys()) if (k.startsWith(session + '\0')) compilers.delete(k)
  for (const k of sets.keys()) if (k.startsWith(session + ':')) sets.delete(k)
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
      if (msg.op === 'release') {
        queue = queue.then(() => release(msg.session))
        continue
      }
      queue = queue.then(
        () => handle(msg).then(
          (r) => reply({ id: msg.id, ok: true, ...r }),
          (e) => reply({ id: msg.id, ok: false, error: formatError(e), deps: e.deps, dirs: e.dirs }),
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

module.exports = { handle, release, resolveStylesheet, exportTarget, rebaseUrls, formatError, MARK, TAILWIND_RE }
if (require.main === module) serve()
