'use strict'
// CSS worker: Sass / Less (the project's own `sass` / `less`), then PostCSS (the project's own `postcss` + config
// plugins) and Tailwind CSS v4 (the project's own `tailwindcss`, via its pure-JS `compile()` API) over the VFS.
// Runs as a long-lived `node` process in cresslet's node worker (requests/responses as JSON lines on stdin/stdout),
// and in plain Node for the unit tests (`handle()`).
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
/** Where a stylesheet `@import` of path `p` may be (what resolution tries, and what a failure records). */
const stylesheetPaths = (p) => [p, p + '.css', path.join(p, 'index.css')]

function resolveStylesheet(id, base) {
  const tryFile = (p) => stylesheetPaths(p).find(isFile)
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
/** Sass/Less source: a url() built from a variable or interpolation is resolved by the compiler, not a path here. */
const isDynamicUrl = (u) => /^[$@]/.test(u) || u.includes('#{') || u.includes('@{')

/**
 * Inlined `@import`s: make relative `url()`s relative to the importing stylesheet again (as vite does), package CSS
 * included. A CSS tokenizer's view of url(): unquoted, or a single/double-quoted string (spaces, escapes); comments,
 * other strings and `@import` preludes (resolved by the compiler against their own file) are left alone.
 * `o.sass`: Sass source (url()s from variables/interpolation left alone, `//` comments skipped, relative plain-CSS
 * `@import`s rebased: `./x`, or a bare `x.css` that is beside it); `o.indented`: the indented syntax (a prelude ends at the line's end); `o.cssImports`: CSS
 * that Sass loads (every relative `@import` in it is plain CSS, rebased).
 */
function rebaseUrls(css, fromDir, toDir, o = {}) {
  if (fromDir === toDir && !o.toUrl) return css
  let out = ''
  let last = 0
  const n = css.length
  let importUrl = false
  /** A bare `x` / `x.css` that is a file beside this stylesheet (not a package specifier). */
  const beside = (ref) => {
    const p = path.resolve(fromDir, ref.replace(/[?#].*$/s, ''))
    return isFile(p) || isFile(p + '.css')
  }
  const rebase = (ref) => {
    const m = /^([^?#]*)(.*)$/s.exec(ref)
    if (o.toUrl) return o.toUrl(path.resolve(fromDir, m[1])) + m[2] // (a URL for the page instead of a relative path)
    let rel = path.relative(toDir, path.resolve(fromDir, m[1]))
    if (!rel.startsWith('.')) rel = './' + rel
    return rel + m[2]
  }
  for (let i = 0; i < n; ) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      // (the indented syntax's `/*` may have no `*/`: it ends with its indented lines; the line end is near enough)
      const e = css.indexOf('*/', i + 2)
      const nl = o.indented ? css.indexOf('\n', i) : -1
      i = nl >= 0 && (e < 0 || nl < e) ? nl : e < 0 ? n : e + 2
    } else if (o.sass && ch === '/' && css[i + 1] === '/') {
      const e = css.indexOf('\n', i)
      i = e < 0 ? n : e // a Sass line comment
    } else if (ch === '"' || ch === "'") i = skipString(css, i)
    else if (ch === '@' && /^@import\b/i.test(css.slice(i, i + 8))) {
      // to the end of the prelude. In Sass, plain-CSS imports (`x.css`, `url(...)`, with a media query) stay in the
      // output, to be resolved from the entry: an explicitly relative one is rebased (a package specifier such as
      // `tailwindcss/utilities.css` is left alone; Sass resolves the other imports itself)
      const imports = o.sass || o.cssImports
      const end = (k) => k >= n || css[k] === ';' || css[k] === '{' || (o.indented ? css[k] === '\n' : css[k] === '}')
      for (i += 7; !end(i); ) {
        if (imports && /^url\(/i.test(css.slice(i, i + 4))) {
          importUrl = true // the url() branch below rebases it (a bare one only if it is a file beside this one)
          break
        }
        if (css[i] !== '"' && css[i] !== "'") {
          i++
          continue
        }
        const e = skipString(css, i)
        const ref = unescapeCss(css.slice(i + 1, e - 1))
        // what follows it (spaces and comments skipped): a media query / supports() / layer() makes it plain CSS
        let k = e
        for (;;) {
          if (k < n && (o.indented ? /[ \t]/ : /\s/).test(css[k])) k++ // (SCSS: a media query may start on the next line)
          else if (css[k] === '/' && css[k + 1] === '*') k = css.indexOf('*/', k + 2) < 0 ? n : css.indexOf('*/', k + 2) + 2
          else if (o.sass && css[k] === '/' && css[k + 1] === '/') k = css.indexOf('\n', k) < 0 ? n : css.indexOf('\n', k)
          else break
        }
        const plain = o.cssImports || /\.css(?:[?#].*)?$/i.test(ref) || !(end(k) || css[k] === ',' || css[k] === '\n' || css[k] === '\r')
        // explicitly relative, or a bare path that is a file beside this one (not a package specifier)
        const local = /^\.\.?\//.test(ref) || (isRelativeUrl(ref) && beside(ref))
        if (imports && plain && local && !isDynamicUrl(ref)) {
          out += css.slice(last, i) + css[i] + escapeString(rebase(ref), css[i]) + css[i]
          last = e
        }
        i = e
      }
    } else if ((ch === 'u' || ch === 'U') && /^url\(/i.test(css.slice(i, i + 4)) && !/[\w-]/.test(css[i - 1] || '')) {
      let j = i + 4
      while (j < n && /\s/.test(css[j])) j++
      let ref, q, end
      if (css[j] === '"' || css[j] === "'") {
        q = css[j]
        const e = skipString(css, j)
        ref = unescapeCss(css.slice(j + 1, e - 1))
        end = e
        while (end < n && /\s/.test(css[end])) end++
        if (css[end] !== ')') {
          i = end
          continue
        }
      } else {
        q = ''
        end = j
        while (end < n && css[end] !== ')' && !/[\s"'(]/.test(css[end])) end += css[end] === '\\' ? escapeLength(css, end) : 1
        end = Math.min(end, n)
        ref = unescapeCss(css.slice(j, end))
        let k = end
        while (k < n && /\s/.test(css[k])) k++
        if (css[k] !== ')') {
          i = k
          continue
        }
        end = k
      }
      const inImport = importUrl
      importUrl = false
      if (isRelativeUrl(ref) && !(o.sass && isDynamicUrl(ref)) && !(inImport && !/^\.\.?\//.test(ref) && !beside(ref))) {
        const next = rebase(ref)
        const quote = q || (/[\s"'()\\\x00-\x1f\x7f]/.test(next) ? '"' : '')
        out += css.slice(last, i) + `url(${quote}${quote ? escapeString(next, quote) : next}${quote})`
        last = end + 1
      }
      i = end + 1
    } else i++
  }
  return out + css.slice(last)
}

/** A CSS string/url token's value: `\\` + 1-6 hex digits (+ one whitespace) is a code point, `\\` + newline nothing. */
function unescapeCss(s) {
  return s.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/gi, (_, hex, nl, ch) => {
    if (hex) {
      const cp = parseInt(hex, 16)
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp)
    }
    return nl ? '' : ch
  })
}

/** A CSS string's content: the quote and backslashes escaped, control characters (newlines) as hex escapes. */
const escapeString = (s, quote) => s.replace(/[\\"'\x00-\x1f\x7f]/g, (c) => (c === quote || c === '\\' ? '\\' + c : c === '"' || c === "'" ? c : `\\${c.charCodeAt(0).toString(16)} `))

/** Length of the escape at `css[i]` (a backslash): hex digits and their one whitespace, or one character. */
function escapeLength(css, i) {
  const m = /^\\(?:[0-9a-f]{1,6}(?:\r\n|[ \t\r\n\f])?|[\s\S])/i.exec(css.slice(i, i + 9))
  return m ? m[0].length : 1
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
  return exts ? (path.extname(p) ? [p] : [p, ...exts.map((e) => p + e)]) : stylesheetPaths(p)
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
            for (const a of attempted(id, base)) record(a)
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

/** Thrown by the Tailwind plugin of a discovery request: the rest of the chain never sees its (empty) output. */
const DISCOVERED = Symbol('discovered')

/** Stand-in for `@tailwindcss/postcss` (which needs native oxide + lightningcss): same plugin, our compiler. */
function tailwindPostcss() {
  return {
    postcssPlugin: '@tailwindcss/postcss',
    async Once(root, { result, postcss }) {
      const ctx = result.opts.cresslet
      const from = result.opts.from
      const css = root.toString()
      if (!ctx || !TAILWIND_RE.test(css)) return
      const built = await tailwind(ctx.req, css, from, ctx.out)
      if (ctx.req.discover) throw DISCOVERED
      const parsed = postcss.parse(built, { from })
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
    require.cache[p] = /** @type {NodeJS.Module} */ ({ id: p, filename: p, path: path.dirname(p), loaded: true, exports: Object.assign(tailwindPostcss, { default: tailwindPostcss }), children: [], paths: [] })
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

/** Stylesheets a preprocessor compiles first (keep in sync with PREPROCESSED_RE in pipeline.ts). */
const PREPROCESSED_RE = /\.(s[ac]ss|less)$/

/** A preprocessor from the project's own deps. */
function loadPreprocessor(root, name, file) {
  try {
    return interop(projectRequire(root)(name))
  } catch (e) {
    throw new Error(`${path.basename(file)} needs the \`${name}\` package (npm install -D ${name}): ${e.message}`)
  }
}

/**
 * Where a Sass load of path `p` (no extension, or .sass/.scss/.css) may be, as Sass looks: tiers in order, the first
 * tier with a file wins and more than one file in it is ambiguous. `.import` files first for `@import`; then the path
 * with extensions (.sass/.scss, else .css), each as a partial too; then the directory's index files.
 */
function sassTiers(p, fromImport) {
  const both = (q) => [q, path.join(path.dirname(q), '_' + path.basename(q))]
  const withExts = (q) => [[...both(q + '.sass'), ...both(q + '.scss')], both(q + '.css')]
  const ext = path.extname(p)
  if (ext === '.sass' || ext === '.scss' || ext === '.css') return [...(fromImport ? [both(p.slice(0, -ext.length) + '.import' + ext)] : []), both(p)]
  return [...(fromImport ? withExts(p + '.import') : []), ...withExts(p), ...(fromImport ? withExts(path.join(p, 'index.import')) : []), ...withExts(path.join(p, 'index'))]
}

/**
 * Sass (the project's `sass`, pure JS): its loads go through one importer over the file system, which records what
 * the output read (and, for a failed load, every path it tried), resolves package paths from node_modules (`~` too),
 * and rebases relative url()s in loaded files to the entry stylesheet (as vite does).
 */
async function compileSass(req, out) {
  const sass = loadPreprocessor(req.root, 'sass', req.file)
  const { pathToFileURL, fileURLToPath } = require('url')
  const toDir = path.dirname(req.file)
  const syntaxOf = (p) => (p.endsWith('.sass') ? 'indented' : p.endsWith('.css') ? 'css' : 'scss')
  const find = (p, fromImport) => {
    for (const tier of sassTiers(p, fromImport)) {
      const found = tier.filter(isFile)
      for (const c of tier) if (!found.includes(c)) out.attempted.add(c)
      if (found.length > 1) {
        for (const f of found) out.attempted.add(f) // removing one resolves it
        throw new Error(`It's not clear which file to import. Found:\n${found.map((f) => '  ' + path.relative(toDir, f)).join('\n')}`)
      }
      if (found.length) return found[0]
    }
    return null
  }
  const importer = {
    canonicalize(url, ctx) {
      if (url.startsWith('file:')) {
        const f = find(fileURLToPath(url), ctx.fromImport)
        return f && pathToFileURL(f)
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null // pkg:, http: ...: not ours
      if (/^(?:\.\.?)?\//.test(url)) return null // `../x`, `/x` that missed: not a package (Sass passes `./x` as `x`)
      // a package path (`bootstrap/scss/bootstrap`, `~bootstrap/...`): node_modules from the importing file up
      const id = url.replace(/^~\/?/, '')
      const from = ctx.containingUrl && ctx.containingUrl.protocol === 'file:' ? path.dirname(fileURLToPath(ctx.containingUrl)) : req.root
      const name = id.startsWith('@') ? id.split('/').slice(0, 2).join('/') : id.split('/')[0]
      for (let dir = from; ; dir = path.dirname(dir)) {
        const pkgDir = path.join(dir, 'node_modules', name)
        const f = find(path.join(dir, 'node_modules', id), ctx.fromImport)
        if (f) return pathToFileURL(f)
        // a bare package (`@use "bootstrap"`): its package.json `sass` / `style` entry, as vite does
        if (id === name && isFile(path.join(pkgDir, 'package.json'))) {
          const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
          const entry = [pkg.sass, pkg.style].find((e) => typeof e === 'string' && /\.(s[ac]ss|css)$/.test(e))
          if (entry && isFile(path.join(pkgDir, entry))) return pathToFileURL(path.join(pkgDir, entry))
          out.attempted.add(path.join(pkgDir, 'package.json'))
        }
        if (dir === path.dirname(dir)) return null
      }
    },
    load(url) {
      const p = fileURLToPath(url)
      const syntax = syntaxOf(p)
      out.deps.add(p)
      // a .css file Sass loads: CSS (no `//` comments), and each of its @imports is plain CSS left in the output
      const o = syntax === 'css' ? { cssImports: true } : { sass: true, indented: syntax === 'indented' }
      return { contents: rebaseUrls(fs.readFileSync(p, 'utf8'), path.dirname(p), toDir, o), syntax }
    },
  }
  try {
    const r = await sass.compileStringAsync(req.css, {
      url: pathToFileURL(req.file),
      syntax: syntaxOf(req.file),
      importer,
      importers: [importer],
      style: 'expanded',
      sourceMap: false,
      logger: {
        // packages' own warnings (Bootstrap's deprecations, on every rebuild) are not the project's to fix
        warn(m, o) {
          const at = o && o.span && o.span.url && o.span.url.protocol === 'file:' ? fileURLToPath(o.span.url) : null
          const top = (o && o.stack ? o.stack.split('\n')[0] : '') || at || ''
          if (/(?:^|[\\/])node_modules[\\/]/.test(top)) return
          out.warnings.push(at ? `${m} (${at}:${o.span.start.line + 1})` : m)
        },
        debug: () => {},
      },
    })
    return r.css
  } catch (e) {
    for (const p of out.attempted) out.deps.add(p)
    if (e && e.span && e.span.url && String(e.span.url).startsWith('file:')) out.deps.add(fileURLToPath(e.span.url))
    throw e
  }
}

/**
 * Less (the project's `less`, pure JS): relative url()s in imported files are rewritten to the entry stylesheet;
 * `@plugin` runs project code, so `cssPlugins: false` refuses it. Inline JavaScript stays off (Less's default).
 */
async function compileLess(req, out) {
  const less = loadPreprocessor(req.root, 'less', req.file)
  // every file Less loads (imports, plugins) and, for one it can't find, the paths it tried: also when the compile fails
  class Tracking extends less.FileManager {
    supports(filename) {
      return !/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(filename) // URLs: Less's own URL file manager
    }
    supportsSync(filename) {
      return this.supports(filename)
    }
    loadFile(filename, dir, options, env, cb) {
      const done = (r) => (r && typeof r.filename === 'string' && path.isAbsolute(r.filename) && out.deps.add(r.filename), r)
      const failed = (e) => {
        const tried = e && typeof e.message === 'string' && /wasn't found\. Tried - (.*)$/s.exec(e.message)
        if (tried) for (const p of tried[1].split(',')) if (path.isAbsolute(p.trim())) out.attempted.add(p.trim())
        return e
      }
      // Less's FileManager answers by promise, or (sync imports) by its return value / the callback
      const r = super.loadFile(filename, dir, options, env, cb && ((e, x) => cb(e && failed(e), e ? x : done(x))))
      if (r && typeof r.then === 'function') return r.then(done, (e) => Promise.reject(failed(e)))
      if (r) r.error ? failed(r.error) : done(r)
      return r
    }
  }
  const plugins = [{ install: (_less, pm) => pm.addFileManager(new Tracking()) }]
  if (req.plugins === false) {
    const refuse = (id) => {
      throw new Error(`@plugin '${id}' not loaded: project CSS plugins are disabled (boot({ cssPlugins: false }))`)
    }
    plugins.push({
      install(_less, pm) {
        pm.Loader = { loadPlugin: async (id) => refuse(id), loadPluginSync: refuse, evalPlugin: () => refuse('(inline)') }
      },
    })
  }
  try {
    const r = await less.render(req.css, { filename: req.file, rewriteUrls: 'all', javascriptEnabled: false, plugins, paths: [path.join(req.root, 'node_modules')] })
    for (const p of r.imports || []) if (path.isAbsolute(p)) out.deps.add(p)
    for (const p of out.attempted) out.deps.add(p) // an `(optional)` import not found: creating it re-serves
    return r.css
  } catch (e) {
    if (e && typeof e.filename === 'string' && path.isAbsolute(e.filename)) out.deps.add(e.filename)
    // a missing import: creating one of the paths it tried retries the stylesheet
    for (const p of out.attempted) out.deps.add(p)
    if (!e || typeof e !== 'object' || e.line == null) throw e
    // file:line:col, the message, and the lines around it (Less errors carry them apart)
    const lines = (e.extract || []).map((l, i) => (l == null ? null : `${String(e.line - 1 + i).padStart(4)} | ${l}`)).filter((l) => l != null && !l.startsWith('   0 |'))
    throw new Error(`${e.filename || req.file}:${e.line}:${(e.column ?? 0) + 1}: ${e.message}${lines.length ? '\n' + lines.join('\n') : ''}`)
  }
}

/** Compile Sass/Less to CSS (anything else passes through). */
function preprocess(req, out) {
  if (/\.s[ac]ss$/.test(req.file)) return compileSass(req, out)
  if (req.file.endsWith('.less')) return compileLess(req, out)
  return req.css
}

/**
 * req: { root, file, css, candidates?, postcssConfig?: abs path | null, env?: 'development' | 'production' }
 * -> { css, deps: abs paths the output depends on, dirs: content directories (PostCSS `dir-dependency`),
 *      tailwind: [{ sources, root }] (one per Tailwind v4 compile), warnings }
 */
let lastEnv = null
async function handle(req) {
  // plugins and configs see the request's mode (a production build: NODE_ENV=production); packages that read it when
  // loaded are loaded again when it changes (a build during dev reloads them; switching is rare)
  const env = req.env || 'development'
  if (lastEnv !== null && lastEnv !== env) {
    // modules, and every plugin/compiler instance made from them, go together (no old plugins on a fresh postcss)
    for (const k of Object.keys(require.cache)) if (k !== __filename) delete require.cache[k]
    configs.clear()
    compilers.clear()
  }
  lastEnv = env
  process.env.NODE_ENV = env
  const out = { deps: new Set(), dirs: new Set(), tailwind: [], warnings: [], attempted: new Set() }
  try {
    candidatesOf(req) // record the delta first: it was sent once, whatever happens to this request
    // Sass/Less first, then PostCSS/Tailwind on their output (as vite does)
    const source = await preprocess(req, out)
    let css
    if (req.postcssConfig && req.plugins !== false) {
      let postcss
      try {
        postcss = interop(projectRequire(req.root)('postcss'))
      } catch {
        throw new Error(`${path.basename(req.postcssConfig)} found, but the \`postcss\` package is not installed (npm install -D postcss)`)
      }
      const { plugins: list } = loadConfig(req.postcssConfig, req.root, req.env || 'development', !!req.tailwind)
      let res
      try {
        res = await postcss(list).process(source, { from: req.file, to: req.file, map: false, cresslet: { req, out } })
      } catch (e) {
        if (e !== DISCOVERED) throw e
        return { css: '', deps: [...out.deps], dirs: [], tailwind: out.tailwind, warnings: [] }
      }
      css = res.css
      for (const m of res.messages) {
        if (m.type === 'dependency' && m.file) out.deps.add(m.file)
        // Tailwind v3 (and other content-scanning plugins) report their content globs
        else if (m.type === 'dir-dependency' && m.dir) out.dirs.add(m.dir)
      }
      for (const w of res.warnings()) out.warnings.push(w.toString())
    } else if (req.tailwind !== false && TAILWIND_RE.test(source)) css = await tailwind(req, source, req.file, out)
    else css = source // a preprocessed stylesheet without Tailwind syntax (or in a project without Tailwind)
    return { css, deps: [...out.deps], dirs: [...out.dirs], tailwind: out.tailwind, warnings: out.warnings }
  } catch (e) {
    throw Object.assign(e && typeof e === 'object' ? e : new Error(String(e)), { deps: [...out.deps], dirs: [...out.dirs] })
  }
}

// ---- single-file components (.vue / .svelte / .svelte.js modules), with the project's own compiler ----

const hash = (s) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}
/** A compiler error with its location (Svelte / Vue errors carry one) as `file:line:col: message` + code frame. */
function located(e, file) {
  if (!e || typeof e !== 'object') return new Error(String(e))
  const loc = e.start || (e.loc && e.loc.start)
  if (loc && !e.cresslet) {
    /** @type {Error & { cresslet?: boolean }} */
    const err = new Error(`${file}:${loc.line}:${loc.column + (e.start ? 1 : 0)}: ${e.message}${e.frame ? '\n' + e.frame : ''}`)
    err.cresslet = true
    return err
  }
  return e
}
const missing = (pkg, e) => (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).includes(pkg) ? new Error(`compiling this file needs the \`${pkg.split('/')[0]}\` package: npm install ${pkg.split('/')[0]}`) : e)

/**
 * A stylesheet's leading statements (`@charset`, `@layer a, b;`, `@import`s; comments between them dropped), then the
 * rest. A statement ends at its `;` outside strings and parentheses.
 */
function leadingStatements(css) {
  const items = []
  const n = css.length
  let i = 0
  for (;;) {
    let j = i
    while (j < n) {
      if (/\s/.test(css[j])) j++
      else if (css[j] === '/' && css[j + 1] === '*') j = css.indexOf('*/', j + 2) < 0 ? n : css.indexOf('*/', j + 2) + 2
      else break
    }
    const m = /^@(import|charset|layer)\b/i.exec(css.slice(j, j + 9))
    if (!m) break
    let k = j + m[0].length
    for (let depth = 0; k < n; k++) {
      const ch = css[k]
      if (ch === '"' || ch === "'") k = skipString(css, k) - 1
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (depth <= 0 && (ch === ';' || ch === '{' || ch === '}')) break
    }
    if (css[k] !== ';') break // `@layer x { ... }`: a block, not a statement
    items.push({ name: m[1].toLowerCase(), text: css.slice(j, k + 1), prelude: css.slice(j + m[0].length, k).trim() })
    i = k + 1
  }
  return { items, rest: css.slice(i) }
}

/** An `@import` prelude: its URL, then `layer` / `layer(name)`, `supports(...)` and a media query list. */
function parseImport(prelude) {
  prelude = prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
  const m = /^(?:url\(\s*(?:"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|([^)\s"']*))\s*\)|"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)')\s*/i.exec(prelude)
  if (!m) return null
  const spec = unescapeCss(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5])
  let rest = prelude.slice(m[0].length)
  let layer = null
  let supports = null
  const l = /^layer(?:\(\s*([^)]*?)\s*\)|(?![\w(-]))\s*/i.exec(rest)
  if (l) {
    layer = l[1] || ''
    rest = rest.slice(l[0].length)
  }
  if (/^supports\(/i.test(rest)) {
    let k = 'supports'.length
    for (let depth = 0; k < rest.length; k++) {
      if (rest[k] === '(') depth++
      else if (rest[k] === ')' && --depth === 0) break
    }
    supports = rest.slice('supports'.length, k + 1) // `supports(display: grid)` -> `@supports (display: grid)`
    rest = rest.slice(k + 1).trim()
  }
  return { spec, layer, supports, media: rest.trim() }
}

/** The local stylesheet an SFC style's `@import` names (beside it first, then root-relative / a package), or null to leave it. */
function importTarget(spec, dir, root) {
  // remote, or Tailwind's own (`tailwindcss`, `tailwindcss/theme.css`: Tailwind resolves those); a query is dropped
  spec = spec.replace(/[?#].*$/s, '')
  if (!spec || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(spec) || /^tailwindcss(?:\/|$)/.test(spec)) return null
  let p
  try {
    if (spec.startsWith('/')) p = stylesheetPaths(path.join(root, spec)).find(isFile)
    else p = stylesheetPaths(path.resolve(dir, spec)).find(isFile) || (/^\.\.?\//.test(spec) ? null : resolveStylesheet(spec, dir))
  } catch {
    return null
  }
  return p && /\.css$/i.test(p) && isFile(p) ? p : null
}

/** An import's conditions as written after its URL (`layer(x) supports(...) screen`), or '' for none. */
const conditions = (imp) => [imp.layer === null ? '' : imp.layer ? `layer(${imp.layer})` : 'layer', imp.supports ? `supports${imp.supports}` : '', imp.media].filter(Boolean).join(' ')

/**
 * Inline a component style's local and package `@import`s (recursively), as vite's postcss-import does: a Vue scoped
 * style scopes their rules, the build bundles them, and each file is a dependency (`out.deps`). Their `url()`s are
 * rebased to `dir`; a media query / `supports()` / `layer()` wraps the rules. A file is inlined once (a repeat or a
 * cycle is skipped). Remote and unresolved imports, and Tailwind's, stay (hoisted to the top: an `@import` must start
 * its sheet; one under a conditional import gets its conditions, or, when both have some, that import isn't inlined).
 */
function inlineImports(css, dir, root, out, seen = [], done = new Set(), scope = '') {
  const { items, rest } = leadingStatements(css)
  if (!items.some((it) => it.name === 'import')) return css
  const head = []
  const body = []
  for (const it of items) {
    if (it.name !== 'import') {
      // a `@layer a, b;` after an import stays after the rules inlined for it (layer order); a nested `@charset` goes
      if (it.name === 'layer') (body.length ? body : head).push(it.text)
      else if (!seen.length) head.push(it.text)
      continue
    }
    const imp = parseImport(it.prelude)
    const p = imp && importTarget(imp.spec, dir, root)
    // Tailwind's import options (`theme(reference)`, `prefix(tw)`, `source(...)`): left for Tailwind, with the file's
    // absolute path (in dev the sheet's relative URLs become the page's, which Tailwind can't open)
    if (p && /\b(?:theme|prefix|source)\(/i.test(imp.media)) {
      out.deps.add(p)
      head.push(`@import "${escapeString(p, '"')}" ${conditions(imp)};`)
      continue
    }
    if (!p) {
      // a missing relative sheet: creating it recompiles the component (which then inlines it)
      const miss = imp && /^\.\.?\//.test(imp.spec) && path.resolve(dir, imp.spec.replace(/[?#].*$/s, ''))
      if (miss) for (const f of path.extname(miss) ? [miss] : stylesheetPaths(miss)) out.deps.add(f)
      head.push(it.text)
      continue
    }
    const cond = conditions(imp)
    // under the conditions of every import above it (the same file under other ones is inlined again)
    const eff = [scope, cond].filter(Boolean).join('\0')
    const key = `${p}\0${eff}`
    if (seen.includes(p) || done.has(key)) continue // a cycle, or already inlined
    out.deps.add(p)
    const mine = new Set(done) // what this expansion inlines counts only if it is kept
    const inner = leadingStatements(rebaseDirectives(rebaseUrls(inlineImports(fs.readFileSync(p, 'utf8'), path.dirname(p), root, out, [...seen, p], mine, eff), path.dirname(p), dir, { cssImports: true }), path.dirname(p), dir))
    const kept = []
    for (const x of inner.items) {
      if (x.name !== 'import') continue
      const ix = cond && parseImport(x.prelude)
      if (!cond) kept.push(x.text)
      else if (ix && !conditions(ix)) kept.push(`@import url("${escapeString(ix.spec, '"')}") ${cond};`)
      else kept.push(null)
    }
    if (kept.includes(null)) {
      head.push(it.text) // both conditional: left to the browser / bundler
      continue
    }
    for (const k of mine) done.add(k)
    done.add(key)
    head.push(...kept)
    let block = inner.items.filter((x) => x.name === 'layer').map((x) => x.text + '\n').join('') + inner.rest
    if (imp.media) block = `@media ${imp.media} {\n${block}\n}`
    if (imp.supports) block = `@supports ${imp.supports} {\n${block}\n}`
    if (imp.layer !== null) block = `@layer${imp.layer ? ' ' + imp.layer : ''} {\n${block}\n}`
    body.push(block)
  }
  return [...head, ...body, rest].join('\n')
}

/**
 * An inlined or `src=` stylesheet's relative Tailwind directives (`@reference`, `@source`, `@config`, `@plugin`) made
 * relative to the component, which the pipeline compiles it as (like its `url()`s): one base for everything in it.
 */
function rebaseDirectives(css, fromDir, toDir) {
  return css.replace(/(@(?:reference|source|config|plugin)\s+(?:not\s+)?)(["'])(\.\.?\/[^"'\n]*)\2/g, (_, pre, q, ref) => {
    let rel = path.relative(toDir, path.resolve(fromDir, ref))
    if (!rel.startsWith('.')) rel = './' + rel
    return pre + q + rel + q
  })
}

/** Sass/Less for a component's `<style lang>` (plain CSS and PostCSS pass through). */
async function styleLang(req, lang, source, file, out) {
  if (/^(css|postcss|pcss)$/.test(lang)) return source
  if (!/^(scss|sass|less)$/.test(lang)) throw new Error(`${req.file}: <style lang="${lang}"> is not supported (Sass and Less are)`)
  return preprocess({ root: req.root, file: file.endsWith('.' + lang) ? file : `${file}.${lang}`, css: source, plugins: req.plugins }, out)
}

const sfcOut = () => ({ deps: new Set(), dirs: new Set(), tailwind: [], warnings: [], attempted: new Set() })

/**
 * Svelte: the project's `svelte/compiler`, client output (dev mode with HMR in the dev server). `<style lang="scss">` /
 * Less go through the project's preprocessor first; the CSS is returned (`styles`) for the caller to inject or bundle.
 * Svelte 5 emits its own `import.meta.hot` code (`hmr: true`); Svelte 4 compiles without (its components full-reload).
 * `.svelte.js` / `.svelte.ts` modules (runes outside components; the caller strips TypeScript) use `compileModule`.
 */
async function compileSvelte(req) {
  let svelte
  try {
    svelte = projectRequire(req.root)('svelte/compiler')
  } catch (e) {
    throw missing('svelte/compiler', e)
  }
  const v5 = parseInt(svelte.VERSION, 10) >= 5
  const prod = req.env === 'production'
  if (!req.file.endsWith('.svelte')) {
    if (!v5 || !svelte.compileModule) throw new Error(`${req.file}: .svelte.js modules need Svelte 5`)
    let r
    try {
      r = svelte.compileModule(req.source, { filename: req.file, generate: 'client', dev: !prod })
    } catch (e) {
      throw located(e, req.file)
    }
    return { code: r.js.code, lang: 'js', deps: [], styles: [], warnings: (r.warnings || []).map((w) => w.message) }
  }
  const out = sfcOut()
  let source = req.source
  if (/<style\b[^>]*\slang\s*=/i.test(source)) {
    try {
      const style = async ({ content, attributes }) => (typeof attributes.lang === 'string' ? { code: await styleLang(req, attributes.lang, content, req.file, out) } : undefined)
      source = (await svelte.preprocess(source, { style }, { filename: req.file })).code
    } catch (e) {
      throw located(e, req.file)
    }
  }
  let r
  try {
    r = svelte.compile(source, v5 ? { filename: req.file, generate: 'client', dev: !prod, hmr: !prod, css: 'external' } : { filename: req.file, generate: 'dom', dev: !prod, css: 'external' })
  } catch (e) {
    throw located(e, req.file)
  }
  // (after scoping: imported rules stay global, as with vite-plugin-svelte)
  const css = r.css && r.css.code ? inlineImports(r.css.code, path.dirname(req.file), req.root, out) : ''
  return { code: r.js.code, lang: 'js', deps: [...out.deps], styles: css ? [css] : [], warnings: [...out.warnings, ...(r.warnings || []).map((w) => w.message)] }
}

/**
 * compiler-sfc instance -> whether it may load TypeScript. `vue/compiler-sfc` registers `require('typescript')`,
 * which it then loads for any imported type; ours loads the project's only once a type imported from a package needs
 * its resolver (relative ones are read through `typeFs`).
 */
const vueTs = new WeakMap()
function vueTypescript(sfc, root) {
  let st = vueTs.get(sfc)
  if (!st) {
    vueTs.set(sfc, (st = { load: false, root }))
    sfc.registerTS(() => (st.load ? projectRequire(st.root)('typescript') : undefined))
  }
  st.root = root // (one compiler-sfc may serve projects that share it)
  return st
}
const typeFs = {
  fileExists: isFile,
  readFile: (f) => {
    try {
      return fs.readFileSync(f, 'utf8')
    } catch {
      return undefined
    }
  },
  realpath: (f) => {
    try {
      return fs.realpathSync(f)
    } catch {
      return f
    }
  },
}

/**
 * Vue: the project's `vue/compiler-sfc`. Script (incl. `<script setup>`) and template are compiled separately (the
 * render function reads setup bindings through `$setup`), so in the dev server a template-only edit re-renders the
 * component in place (state kept); any other edit reloads it through Vue's HMR runtime. `<style>` blocks (scoped,
 * `module`, Sass/Less) are returned (`styles`), their `@import`s inlined first. `src=` blocks, `<template lang="pug">`
 * (the project's preprocessor) and types imported from other files in `defineProps<T>()` work; the files they read are
 * `deps`. `env: 'production'`: no HMR code, `isProd` output.
 */
async function compileVue(req) {
  let sfc
  try {
    sfc = projectRequire(req.root)('vue/compiler-sfc')
  } catch (e) {
    throw missing('vue/compiler-sfc', e)
  }
  const prod = req.env === 'production'
  const dir = path.dirname(req.file)
  const { descriptor, errors } = sfc.parse(req.source, { filename: req.file, sourceMap: false })
  if (errors.length) throw located(errors[0], req.file)
  const id = req.hmrId
  const out = sfcOut()
  /** A `src=` block's file: relative to the component, or a package's. (The parsed descriptor is cached: not changed.) */
  const srcFile = (block, tag) => {
    let p
    try {
      p = tag === 'style' ? resolveStylesheet(block.src, dir) : /^\.{0,2}\//.test(block.src) ? path.resolve(dir, block.src) : projectRequire(req.root).resolve(block.src)
    } catch {}
    if (!p || !isFile(p)) throw new Error(`${req.file}: <${tag} src="${block.src}">: file not found`)
    if (tag !== 'script') out.deps.add(p) // (a script is an import: its edits reload the component, like its imports')
    return p
  }
  const scoped = descriptor.styles.some((s) => s.scoped)
  const { script, scriptSetup } = descriptor
  let ts = [script, scriptSetup].some((b) => b && b.lang === 'ts')
  let code = 'const _sfc_main = {}'
  let bindings
  if (script && script.src) {
    if (scriptSetup) throw new Error(`${req.file}: <script src> can't be combined with <script setup>`)
    srcFile(script, 'script')
    // a copy (components sharing one script file each get their own render / scope id), its named exports too
    const spec = JSON.stringify(script.src)
    code = `import _sfc_src from ${spec}\nexport * from ${spec}\nconst _sfc_main = typeof _sfc_src === 'function' ? _sfc_src : Object.assign({}, _sfc_src)`
    ts = script.lang === 'ts' || /\.[cm]?ts$/.test(script.src) // (TypeScript in the template's expressions)
  } else if (script || scriptSetup) {
    const compile = () => sfc.compileScript(descriptor, { id, isProd: prod, inlineTemplate: false, genDefaultAs: '_sfc_main', sourceMap: false, fs: typeFs })
    const tsState = vueTypescript(sfc, req.root)
    let s
    try {
      try {
        s = compile()
      } catch (e) {
        // a type imported from a package needs TypeScript's resolver: the project's `typescript`, loaded only then
        if (tsState.load || !/TypeScript is required/.test(String(e && e.message))) throw e
        tsState.load = true
        s = compile()
      }
    } catch (e) {
      throw located(e, req.file)
    }
    code = s.content
    bindings = s.bindings
    // type files are re-read on the next compile (compiler-sfc caches them by name)
    for (const d of s.deps || []) out.deps.add(d), sfc.invalidateTypeCache && sfc.invalidateTypeCache(d)
  }
  const styles = []
  const modules = {}
  for (let i = 0; i < descriptor.styles.length; i++) {
    const st = descriptor.styles[i]
    const from = st.src ? srcFile(st, 'style') : req.file
    const lang = st.lang || (st.src && (/\.(s[ac]ss|less)$/.exec(from) || [])[1]) || 'css'
    const fromDir = path.dirname(from)
    let css = await styleLang(req, lang, st.src ? fs.readFileSync(from, 'utf8') : st.content, from, out)
    css = inlineImports(css, fromDir, req.root, out) // before scoping: an imported sheet's rules are scoped too
    if (fromDir !== dir) css = rebaseDirectives(rebaseUrls(css, fromDir, dir, { cssImports: true }), fromDir, dir)
    const name = st.module ? (typeof st.module === 'string' ? st.module : '$style') : null
    const r = await sfc.compileStyleAsync({
      source: css,
      filename: from, // (a `<style module src>`'s `composes: x from "./y.css"` resolves beside it)
      id: `data-v-${id}`,
      scoped: !!st.scoped,
      isProd: prod,
      modules: !!name,
      // stable per component and block: an edit that keeps the class names keeps the map (re-render, not reload)
      modulesOptions: name ? { generateScopedName: (local) => `${local}_${hash(`${id}:${i}`)}` } : undefined,
    })
    if (r.errors.length) throw located(r.errors[0], req.file)
    if (name) modules[name] = { ...modules[name], ...r.modules }
    styles.push(r.code)
  }
  const cssModules = Object.keys(modules).length ? `_sfc_main.__cssModules = ${JSON.stringify(modules)}\n` : ''
  // (a removed <template> must reload: re-rendering with no render function keeps the old one; a new class map too)
  const scriptHash = hash(code + (scoped ? '\0scoped' : '') + (descriptor.template ? '\0template' : '') + '\0' + cssModules)
  const tpl = descriptor.template
  if (tpl) {
    const tplFile = tpl.src ? srcFile(tpl, 'template') : null
    const lang = tpl.lang || (tplFile && /\.pug$/.test(tplFile) ? 'pug' : undefined)
    const pre =
      lang && lang !== 'html'
        ? {
            preprocessLang: lang,
            preprocessCustomRequire: (m) => {
              try {
                return projectRequire(req.root)(m)
              } catch (e) {
                throw missing(m, e)
              }
            },
            // (an `include` resolves from the template's own file)
            preprocessOptions: { ...(lang === 'pug' ? { doctype: 'html' } : {}), filename: tplFile || req.file },
          }
        : {}
    // production: root-relative asset URLs (`<img src="/src/logo.svg">`) are bundled too, as @vitejs/plugin-vue does
    const assets = prod ? { transformAssetUrls: { includeAbsolute: true } } : {}
    const t = sfc.compileTemplate({ source: tplFile ? fs.readFileSync(tplFile, 'utf8') : tpl.content, filename: req.file, id, scoped, slotted: descriptor.slotted, isProd: prod, ...pre, ...assets, compilerOptions: { bindingMetadata: bindings, scopeId: scoped ? `data-v-${id}` : undefined, expressionPlugins: ts ? ['typescript'] : undefined } })
    if (t.errors.length) throw typeof t.errors[0] === 'string' ? new Error(`${req.file}: ${t.errors[0]}`) : located(t.errors[0], req.file)
    const relTo = (abs) => {
      const rel = path.relative(dir, abs)
      return rel.startsWith('.') ? rel : './' + rel
    }
    // asset URLs the template imports: a `src=` template's relative ones are relative to its own file; a root-relative
    // one is a project file (bundled), or one in public/ (left as the URL: it is copied to the output root)
    const render = t.code
      .replace(/\nexport (function|const) render\b/, '\n$1 _sfc_render')
      .replace(/^import (_imports_\d+) from (['"])((?:\.\.?)?\/[^'"]*)\2/gm, (m, name, q, ref) => {
        if (!ref.startsWith('/')) return tplFile && path.dirname(tplFile) !== dir ? `import ${name} from ${JSON.stringify(relTo(path.resolve(path.dirname(tplFile), ref)))}` : m
        const clean = ref.replace(/[?#].*$/s, '')
        if (isFile(path.join(req.root, 'public', clean))) return `const ${name} = ${JSON.stringify(ref)}`
        return isFile(path.join(req.root, clean)) ? `import ${name} from ${JSON.stringify(relTo(path.join(req.root, clean)) + ref.slice(clean.length))}` : m
      })
    code += '\n' + render + '\n_sfc_main.render = _sfc_render'
  }
  code += `\n${scoped ? `_sfc_main.__scopeId = ${JSON.stringify(`data-v-${id}`)}\n` : ''}${cssModules}`
  if (!prod)
    code += `_sfc_main.__hmrId = ${JSON.stringify(id)}
_sfc_main.__file = ${JSON.stringify(req.file)}
_sfc_main.__cressletScript = ${JSON.stringify(scriptHash)}
if (import.meta.hot && typeof __VUE_HMR_RUNTIME__ !== 'undefined') {
  __VUE_HMR_RUNTIME__.createRecord(_sfc_main.__hmrId, _sfc_main)
  import.meta.hot.accept((mod) => {
    const next = mod && mod.default
    if (!next) return // the update failed (its error is on the overlay)
    if (next.__cressletScript === _sfc_main.__cressletScript) __VUE_HMR_RUNTIME__.rerender(next.__hmrId, next.render)
    else __VUE_HMR_RUNTIME__.reload(next.__hmrId, next)
  })
}
`
  code += 'export default _sfc_main\n'
  return { code, lang: ts ? 'ts' : 'js', deps: [...out.deps], styles, warnings: out.warnings }
}

/**
 * req: { op: 'sfc', root, file, source, hmrId, env?: 'development' | 'production' }
 * -> { code, lang: 'js' | 'ts', deps: files it read besides itself, styles: CSS of its style blocks, warnings }
 * Development: the styles' relative `url()`s / `@import`s are made root-relative (they go in `<style>`s on the page);
 * production: they stay relative to the component (the build bundles them).
 */
async function compileSfc(req) {
  try {
    const r = /\.svelte(?:\.[cm]?[jt]s)?$/.test(req.file) ? await compileSvelte(req) : await compileVue(req)
    if (req.env !== 'production') {
      const urlOf = (p) => (p.startsWith(req.root + '/') ? p.slice(req.root.length) : '/@fs' + p)
      r.styles = r.styles.map((s) => rebaseUrls(s, path.dirname(req.file), null, { cssImports: true, toUrl: urlOf }))
    }
    return r
  } catch (e) {
    throw Object.assign(e && typeof e === 'object' ? e : new Error(String(e)), { deps: [], dirs: [] })
  }
}

/** Forget a session's compilers and candidate sets. */
function release(session) {
  for (const k of compilers.keys()) if (k.startsWith(session + '\0')) compilers.delete(k)
  for (const k of sets.keys()) if (k.startsWith(session + ':')) sets.delete(k)
}

function serve() {
  let buf = ''
  /** @type {Promise<unknown>} */
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
        () => (msg.op === 'sfc' ? compileSfc(msg) : handle(msg)).then(
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

module.exports = { handle, compileSfc, inlineImports, release, resolveStylesheet, exportTarget, rebaseUrls, sassTiers, formatError, MARK, TAILWIND_RE, PREPROCESSED_RE }
if (require.main === module) serve()
