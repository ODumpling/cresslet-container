// npm install: resolve tree, prune, fetch + extract tarballs into the VFS, link .bin entries.
import semver from 'semver'
import type { VFS } from '../vfs'
import { dirname, join, relative } from '../path'
import type { Writer } from '../process'
import type { Registry } from './registry'
import { packageDeps, parseSpec, pickVersion, resolveTree, type Link, type Placement } from './resolver'
import { findWorkspaces, lockContents, lockOutOfSync, nameFromPath, readLock, writeLock, type Lockfile } from './lockfile'
import { gunzip, untar } from './tar'

export interface InstallOptions {
  cwd: string
  add?: string[]
  remove?: string[]
  dev?: boolean
  exact?: boolean
  /** `npm ci`: the lockfile must exist and match package.json; node_modules is removed first. */
  ci?: boolean
  out: Writer
  signal?: AbortSignal
}

export interface PackageJsonLike {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
  [k: string]: unknown
}

const DIM = '\x1b[2m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

export function readPkg(vfs: VFS, cwd: string): PackageJsonLike | null {
  const t = vfs.tryReadText(join(cwd, 'package.json'))
  if (t == null) return null
  return JSON.parse(t)
}

export function writePkg(vfs: VFS, cwd: string, pkg: PackageJsonLike): void {
  vfs.writeFile(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

/** Split 'name@range' / '@scope/name@range'. */
export function splitPkgSpec(s: string): { name: string; spec: string } {
  const at = s.indexOf('@', s.startsWith('@') ? 1 : 0)
  if (at < 0) return { name: s, spec: '' }
  return { name: s.slice(0, at), spec: s.slice(at + 1) }
}

export async function install(vfs: VFS, registry: Registry, o: InstallOptions): Promise<{ added: number; removed: number; warnings: string[] }> {
  const t0 = Date.now()
  const pkg = readPkg(vfs, o.cwd) ?? (o.add?.length ? { name: 'project', version: '1.0.0' } : null)
  if (!pkg) throw new Error(`ENOENT: no package.json in ${o.cwd} (run \`npm init -y\`)`)
  const warnings: string[] = []
  const warn = (m: string) => (warnings.push(m), o.out.write(`${YELLOW}npm warn${RESET} ${m}\n`))
  // before anything changes: `npm ci` fails on an unreadable lockfile, `npm install` warns and writes a new one
  let found: ReturnType<typeof readLock> = null
  let unreadable: string | null = null
  try {
    found = readLock(vfs, o.cwd)
  } catch (e) {
    if (o.ci) throw e
    unreadable = errorText(e)
    warn(`${unreadable}: resolving and writing a new package-lock.json`)
  }

  const workspaces = findWorkspaces(vfs, o.cwd, pkg)

  // --- edit package.json ---
  for (const name of o.remove ?? []) for (const f of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) if (pkg[f]) delete pkg[f]![name]
  if (o.add?.length) {
    for (const raw of o.add) {
      const { name, spec } = splitPkgSpec(raw)
      // an optional dependency stays one (as in npm) unless -D moves it
      const field = o.dev ? 'devDependencies' : pkg.optionalDependencies?.[name] !== undefined ? 'optionalDependencies' : 'dependencies'
      pkg[field] ??= {}
      const parsed = parseSpec(name, spec)
      if ('skip' in parsed) {
        warn(`skipping non-registry dependency ${raw}`)
        pkg[field]![name] = spec
        continue
      }
      // a workspace of this project is linked, not fetched (as npm, even when it isn't published)
      const ws = parsed.pkg === name ? workspaces.find((w) => w.name === name) : undefined
      if (ws && (!spec || semver.satisfies(ws.version, parsed.range, { loose: true, includePrerelease: true }))) {
        pkg[field]![name] = spec || (o.exact ? ws.version : `^${ws.version}`)
        if (pkg[otherOf(field)]) delete pkg[otherOf(field)]![name]
        continue
      }
      const p = await registry.packument(parsed.pkg)
      const v = pickVersion(p, parsed.range)
      if (!v) throw new Error(`No matching version found for ${raw}`)
      const explicit = spec && semver.validRange(spec) && !p['dist-tags'][spec]
      const saved = explicit ? spec : o.exact ? v : `^${v}`
      pkg[field]![name] = spec.startsWith('npm:') ? `npm:${parsed.pkg}@${saved}` : saved
      if (pkg[otherOf(field)]) delete pkg[otherOf(field)]![name]
    }
    for (const f of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) if (pkg[f]) pkg[f] = sortKeys(pkg[f]!)
  }

  // --- resolve: from the lockfile when it matches package.json, else fresh (keeping locked versions that still fit) ---
  const wsRoot = workspaceRootOf(vfs, o.cwd)
  if (wsRoot) warn(`${o.cwd} is a workspace of ${wsRoot}: run npm install there (this installs it on its own, without a lockfile)`)
  const edited = !!(o.add?.length || o.remove?.length)
  const stale = found ? lockOutOfSync(found.lock, pkg, workspaces) : null
  if (o.ci) {
    if (!found) throw new Error('`npm ci` can only install with an existing package-lock.json or npm-shrinkwrap.json (run `npm install` to create one)')
    if (stale) throw new Error(`\`npm ci\` can only install packages when your package.json and ${found.file} are in sync: ${stale}. Update the lockfile with \`npm install\`.`)
  }
  const roots = ['', ...workspaces.map((w) => w.path)]
  let placements: Placement[]
  let links: Link[]
  const notPresent = new Set<Placement>() // optional packages that failed (packument or tarball): not installed
  let platform: Placement[] = []
  let bundled = new Set<string>() // extracted with their parent: not pruned
  const fromLock = !!found && !stale && !edited
  if (found && fromLock) {
    const c = lockContents(found.lock, new Set(workspaces.map((w) => w.path)))
    for (const w of c.warnings) warn(w)
    // (a failed lookup for a package already on disk changes nothing: it needs no tarball)
    for (const p of await fillFromRegistry(registry, c.needsManifest, warn)) if (readIdent(vfs, join(o.cwd, p.path)) !== `${p.pkg}@${p.version}`) notPresent.add(p)
    if (registry.base && registry.base !== NPMJS) for (const p of c.placements) p.manifest.dist.tarball = p.manifest.dist.tarball.replace(NPMJS + '/', registry.base + '/')
    placements = c.placements
    links = c.links
    bundled = c.bundled
  } else {
    if (found && stale && !edited) o.out.write(`${DIM}${found.file} is out of date (${stale}); resolving${RESET}\n`)
    // the edited edges resolve fresh: packages being added (at the root), and direct deps whose spec became a
    // different dist-tag (`latest` -> `next`); other requesters of the same packages keep their pins
    const freshPaths = new Set((o.add ?? []).map((a) => `node_modules/${splitPkgSpec(a).name}`))
    for (const [path, p] of [['', pkg], ...workspaces.map((w) => [w.path, w.pkg] as const)] as const)
      for (const f of ['dependencies', 'devDependencies', 'optionalDependencies'] as const)
        for (const [n, spec] of Object.entries(p[f] ?? {})) if (!semver.validRange(spec, { loose: true }) && found?.lock.packages?.[path]?.[f]?.[n] !== spec) freshPaths.add(`${path ? path + '/' : ''}node_modules/${n}`)
    const locked = found ? lockedAt(found.lock, freshPaths) : undefined
    const r = await resolveTree(packageDeps(pkg), registry, { workspaces, locked, fresh: freshPaths })
    for (const w of r.warnings) warn(w)
    placements = r.placements
    links = r.links
    platform = r.platform
  }
  if (o.signal?.aborted) throw new Error('aborted')
  // saved once resolving worked: a failed add/remove (offline, no such version) leaves package.json as it was
  if (o.add?.length || o.remove?.length) writePkg(vfs, o.cwd, pkg)
  links = links.filter((l) => {
    if (vfs.isDir(join(o.cwd, l.target))) return true
    warn(`skipping link ${l.path} -> ${l.target}: no such directory`)
    return false
  })
  if (o.ci) for (const r of roots) vfs.rm(join(o.cwd, r, 'node_modules'), { recursive: true, force: true })

  // --- prune + diff against what is on disk ---
  const nm = join(o.cwd, 'node_modules')
  const want = new Map<string, string>([...placements.map((p) => [p.path, `${p.pkg}@${p.version}`] as const), ...links.map((l) => [l.path, LINK + linkTarget(l)] as const)])
  const installed = listInstalled(vfs, o.cwd, roots)
  let removed = 0
  for (const [path, have] of installed) {
    const w = want.get(path)
    if (w !== have && !bundled.has(path)) {
      vfs.rm(join(o.cwd, path), { recursive: true, force: true })
      if (w === undefined) removed++
    }
  }
  for (const l of links) {
    const abs = join(o.cwd, l.path)
    if (installed.get(l.path) === LINK + linkTarget(l)) continue
    // (not made through a symlink on the way, as for packages)
    const nmDir = l.path.startsWith('node_modules/') ? 'node_modules' : l.path.slice(0, l.path.indexOf('/node_modules/') + '/node_modules'.length)
    if (realOf(vfs, join(abs, '..')) !== join(realOf(vfs, join(o.cwd, nmDir)), l.path.slice(nmDir.length), '..')) {
      warn(`skipping link ${l.path}: it goes through a symlink`)
      continue
    }
    vfs.mkdir(join(abs, '..'), { recursive: true })
    vfs.symlink(linkTarget(l), abs)
  }
  // a placement reached through a symlink below its root's node_modules (followed if the user linked that) is never
  // read, written or removed: whatever is there belongs to someone else
  for (const p of placements) {
    const nmDir = p.path.startsWith('node_modules/') ? 'node_modules' : p.path.slice(0, p.path.indexOf('/node_modules/') + '/node_modules'.length)
    if (realOf(vfs, join(o.cwd, p.path)) === realOf(vfs, join(o.cwd, nmDir)) + p.path.slice(nmDir.length)) continue
    warn(`skipping ${p.pkg}@${p.version}: ${p.path} goes through a symlink`)
    notPresent.add(p)
  }
  const todo = placements.filter((p) => !notPresent.has(p) && readIdent(vfs, join(o.cwd, p.path)) !== `${p.pkg}@${p.version}`)

  // --- fetch + extract ---
  if (todo.length) o.out.write(`${DIM}fetching ${todo.length} package${todo.length === 1 ? '' : 's'}…${RESET}\n`)
  await pool(todo, 16, async (p) => {
    if (o.signal?.aborted) throw new Error('aborted')
    let tgz: Uint8Array
    try {
      tgz = await registry.tarball(p.manifest.dist.tarball, p.manifest.dist.integrity)
    } catch (e) {
      if (!p.optional) throw e
      notPresent.add(p)
      return void warn(`optional dependency ${p.pkg}@${p.version} failed: ${e instanceof Error ? e.message : e}`)
    }
    const entries = untar(await gunzip(tgz), 1)
    const dir = join(o.cwd, p.path)
    // nothing is written through a symlink (one an archive made, or one already there): its dir is reached through
    // real dirs only from its root's node_modules (followed if the user linked that), and every entry stays in it
    // (checked above; an archive extracted earlier in this install may have added a link on the way since)
    const nm = p.path.startsWith('node_modules/') ? 'node_modules' : p.path.slice(0, p.path.indexOf('/node_modules/') + '/node_modules'.length)
    if (realOf(vfs, dir) !== realOf(vfs, join(o.cwd, nm)) + p.path.slice(nm.length)) {
      warn(`skipping ${p.pkg}@${p.version}: ${p.path} goes through a symlink`)
      return void notPresent.add(p)
    }
    vfs.mkdir(dir, { recursive: true })
    const realDir = vfs.realpath(dir)
    const under = (real: string) => real === realDir || real.startsWith(realDir + '/')
    for (const e of entries) {
      const fp = join(dir, e.path)
      // its dir must be exactly where it says: no symlink on the way (one of the archive's own included)
      if (realOf(vfs, join(fp, '..')) !== join(realDir, e.path, '..') || (e.type !== 'symlink' && isLink(vfs, fp))) {
        warn(`skipping ${e.path} in ${p.pkg}@${p.version}: it would be written outside the package`)
        continue
      }
      if (e.type === 'dir') vfs.mkdir(fp, { recursive: true })
      else if (e.type === 'file') vfs.writeFile(fp, e.data.slice(), { mkdirp: true })
      else if (e.type === 'symlink' && e.linkname) {
        // an archive's symlink stays inside its package (resolved from where it really is, past its earlier links):
        // one out (`node_modules -> ../../src`) would be followed later
        // (both as written and from its real dir, which the check above makes the same place)
        if (e.linkname.startsWith('/') || !under(join(realDir, e.path, '..', e.linkname)) || !`${join(fp, '..', e.linkname)}/`.startsWith(dir + '/')) {
          warn(`skipping ${e.path} in ${p.pkg}@${p.version}: it links outside the package`)
          continue
        }
        vfs.mkdir(join(fp, '..'), { recursive: true })
        vfs.rm(fp, { force: true })
        vfs.symlink(e.linkname, fp)
      }
    }
    if (!vfs.isFile(join(dir, 'package.json'))) vfs.writeFile(join(dir, 'package.json'), JSON.stringify({ name: p.pkg, version: p.version }))
    if (p.manifest.hasInstallScript) warn(`skipped install scripts for ${p.pkg}@${p.version}`)
  })

  // what failed to download (optional) isn't there, and neither is what can't work without it: an optional package
  // that requires a missing one goes too (as npm drops a failed optional branch). No bins for them, not counted
  if (notPresent.size) {
    const at = new Map(placements.map((p) => [p.path, p]))
    const lookup = (from: string, name: string) => {
      for (let base = from; ; ) {
        const k = `${base ? base + '/' : ''}node_modules/${name}`
        if (at.has(k)) return at.get(k)
        if (!base) return undefined
        // up: past `node_modules/x`, else from a workspace dir to the enclosing workspace (or the root)
        const i = base.lastIndexOf('/node_modules/')
        base = i >= 0 ? base.slice(0, i) : base.startsWith('node_modules/') ? '' : (workspaces.map((w) => w.path).filter((w) => base.startsWith(w + '/')).sort((a, b) => b.length - a.length)[0] ?? '')
      }
    }
    for (let changed = true; changed; ) {
      changed = false
      for (const p of placements) {
        if (notPresent.has(p) || !p.optional) continue
        const opt = p.manifest.optionalDependencies ?? {}
        const peerMeta = p.manifest.peerDependenciesMeta ?? {}
        const required = [...Object.keys(p.manifest.dependencies ?? {}).filter((n) => !(n in opt)), ...Object.keys(p.manifest.peerDependencies ?? {}).filter((n) => !peerMeta[n]?.optional)]
        const missing = required.find((n) => notPresent.has(lookup(p.path, n)!))
        if (!missing) continue
        notPresent.add(p)
        if (vfs.exists(join(o.cwd, p.path)) && !todo.includes(p)) removed++ // it was installed before
        vfs.rm(join(o.cwd, p.path), { recursive: true, force: true })
        warn(`optional dependency ${p.pkg}@${p.version} removed: it needs ${missing}, which failed`)
        changed = true
      }
    }
    // then the optional packages only those removed ones needed (still needed by anything left: kept)
    const owners: [string, PackageJsonLike][] = [['', pkg], ...workspaces.map((w) => [w.path, w.pkg as PackageJsonLike] as [string, PackageJsonLike])]
    const needed = (q: Placement) =>
      owners.some(([r, m]) => packageDeps(m).some((d) => d.name === q.name && lookup(r, d.name) === q)) ||
      placements.some((r) => !notPresent.has(r) && r !== q && Object.keys({ ...r.manifest.dependencies, ...r.manifest.optionalDependencies, ...r.manifest.peerDependencies }).some((n) => n === q.name && lookup(r.path, n) === q))
    for (let changed = true; changed; ) {
      changed = false
      for (const q of placements) {
        if (notPresent.has(q) || !q.optional || needed(q)) continue
        notPresent.add(q)
        if (vfs.exists(join(o.cwd, q.path)) && !todo.includes(q)) removed++
        vfs.rm(join(o.cwd, q.path), { recursive: true, force: true })
        changed = true
      }
    }
  }
  const present = placements.filter((p) => !notPresent.has(p))
  linkBins(vfs, o.cwd, roots, present, links)
  if (!fromLock && !wsRoot) writeLock(vfs, o.cwd, found?.file ?? (unreadable?.includes('npm-shrinkwrap.json') ? 'npm-shrinkwrap.json' : 'package-lock.json'), pkg, workspaces, placements, links, platform)
  if (!vfs.isDir(nm)) vfs.mkdir(nm, { recursive: true })
  await registry.flush?.() // so a reload right after the install still hits the persistent cache
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const added = todo.filter((p) => !notPresent.has(p)).length
  const parts = [`added ${added} package${added === 1 ? '' : 's'}`]
  if (removed) parts.push(`removed ${removed} package${removed === 1 ? '' : 's'}`)
  o.out.write(`\n${parts.join(', ')}, and audited ${placements.length + links.length + 1} packages in ${secs}s\n`)
  return { added, removed, warnings }
}

/** The project whose `workspaces` include `cwd`, if any. */
function workspaceRootOf(vfs: VFS, cwd: string): string | null {
  for (let prev = cwd, d = dirname(cwd); d !== prev; prev = d, d = dirname(d)) {
    try {
      const up = readPkg(vfs, d)
      if (up?.workspaces && findWorkspaces(vfs, d, up).some((w) => join(d, w.path) === cwd)) return d
    } catch {
      /* unreadable package.json: not a workspace root */
    }
  }
  return null
}

/** What saving to a field removes: -D moves a dependency out of dependencies, an optional one stays (as npm). */
const otherOf = (field: 'dependencies' | 'devDependencies' | 'optionalDependencies') => (field === 'dependencies' ? 'devDependencies' : 'dependencies')

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

const NPMJS = 'https://registry.npmjs.org'
const LINK = 'link:'

/** The symlink text for a link: its target relative to the link's directory. */
function linkTarget(l: Link): string {
  return '../'.repeat(l.path.split('/').length - 1) + l.target
}

/** Lockfile entries without `resolved`/`integrity` (npm can omit them) get them from the packument. */
async function fillFromRegistry(registry: Registry, ps: Placement[], warn: (m: string) => void): Promise<Set<Placement>> {
  const failed = new Set<Placement>()
  await pool(ps, 16, async (p) => {
    let m: Placement['manifest'] | undefined
    try {
      m = (await registry.packument(p.pkg)).versions[p.version]
      if (!m) throw new Error(`No matching version found for ${p.pkg}@${p.version} (from the lockfile)`)
    } catch (e) {
      if (!p.optional) throw e
      failed.add(p)
      return warn(`optional dependency ${p.pkg}@${p.version} failed: ${errorText(e)}`)
    }
    p.manifest = { ...m, ...p.manifest, dist: { tarball: m.dist.tarball, integrity: p.manifest.dist.integrity ?? m.dist.integrity } }
  })
  return failed
}

/** Registry packages the lockfile has, by path, except at the paths being resolved fresh. */
function lockedAt(lock: Lockfile, except: Set<string>): Map<string, { pkg: string; version: string }> {
  const out = new Map<string, { pkg: string; version: string }>()
  for (const [path, e] of Object.entries(lock.packages ?? {})) {
    if (!path.includes('node_modules/') || !e?.version || e.link || except.has(path)) continue
    out.set(path, { pkg: e.name ?? nameFromPath(path), version: e.version })
  }
  return out
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/** `name@version` of the package installed in `dir`, or null. */
function readIdent(vfs: VFS, dir: string): string | null {
  const t = vfs.tryReadText(join(dir, 'package.json'))
  if (!t) return null
  try {
    const { name, version } = JSON.parse(t)
    return `${name}@${version}`
  } catch {
    return null
  }
}

/**
 * Map of 'node_modules/a[/node_modules/b]' -> 'name@version' for everything installed under each root ('' = the project,
 * else a workspace dir); symlinks map to `link:<target>` and aren't descended into.
 */
export function listInstalled(vfs: VFS, cwd: string, roots: string[] = ['']): Map<string, string> {
  const out = new Map<string, string>()
  const scan = (rel: string) => {
    const abs = join(cwd, rel)
    if (!vfs.isDir(abs)) return
    for (const name of vfs.readdir(abs)) {
      if (name.startsWith('.')) continue
      if (name.startsWith('@') && !isLink(vfs, join(abs, name))) {
        for (const sub of vfs.isDir(join(abs, name)) ? vfs.readdir(join(abs, name)) : []) visit(`${rel}/${name}/${sub}`)
      } else visit(`${rel}/${name}`)
    }
  }
  const visit = (rel: string) => {
    const abs = join(cwd, rel)
    if (isLink(vfs, abs)) return void out.set(rel, LINK + vfs.readlink(abs))
    out.set(rel, readIdent(vfs, abs) ?? '')
    // a package's node_modules that is a symlink isn't ours to scan (or prune through)
    if (!isLink(vfs, join(cwd, rel, 'node_modules'))) scan(`${rel}/node_modules`)
  }
  for (const r of roots) scan(r ? `${r}/node_modules` : 'node_modules')
  return out
}

/** Real path of `p`, which may not exist yet: its nearest existing ancestor's, plus the rest. */
function realOf(vfs: VFS, p: string): string {
  for (let d = p, rest = ''; ; rest = '/' + d.slice(d.lastIndexOf('/') + 1) + rest, d = join(d, '..')) {
    try {
      return vfs.realpath(d) + rest
    } catch {
      if (d === '/') return p
    }
  }
}

function isLink(vfs: VFS, p: string): boolean {
  try {
    return vfs.lstat(p).isSymbolicLink()
  } catch {
    return false
  }
}

export function binEntries(name: string, bin: Manifest['bin']): [string, string][] {
  if (!bin) return []
  if (typeof bin === 'string') return [[name.startsWith('@') ? name.split('/')[1] : name, bin]]
  return Object.entries(bin)
}
type Manifest = Placement['manifest']

/** `.bin` shims in each root's node_modules for the packages (and workspace links) directly in it. */
function linkBins(vfs: VFS, cwd: string, roots: string[], placements: Placement[], links: Link[]): void {
  for (const r of roots) vfs.rm(join(cwd, r, 'node_modules/.bin'), { recursive: true, force: true })
  const tops = [
    ...placements.filter((p) => p.depth === 1).map((p) => ({ path: p.path, real: p.path, name: p.name, bin: p.manifest.bin })),
    // a linked package's bins point at its real dir (as node, which runs the realpath of the script)
    ...links.filter((l) => l.path.split('node_modules/').length === 2).map((l) => ({ path: l.path, real: l.target, name: nameFromPath(l.path), bin: undefined as Manifest['bin'] })),
  ]
  for (const p of tops) {
    let bin = p.bin
    if (!bin) {
      // abbreviated packuments may omit bin; fall back to the extracted package.json
      const t = vfs.tryReadText(join(cwd, p.path, 'package.json'))
      try {
        bin = t ? JSON.parse(t).bin : undefined
      } catch {
        bin = undefined
      }
    }
    const binDir = join(cwd, p.path.slice(0, p.path.length - p.name.length), '.bin')
    for (const [name, rel] of binEntries(p.name, bin)) {
      // a bin is a file name in .bin pointing inside its package: anything else (`../../src/x`) is skipped
      const file = join(cwd, p.real, String(rel))
      // (no control characters either: the target is written into the shim's header line)
      if (!/^[^/\\]+$/.test(name) || name === '.' || name === '..' || /[\x00-\x1f\x7f]/.test(name + rel) || !file.startsWith(join(cwd, p.real) + '/')) continue
      const target = relative(binDir, file)
      vfs.writeFile(join(binDir, name), `#!/usr/bin/env node\n// cresslet-bin -> ${target}\nrequire(${JSON.stringify(target)})\n`, { mkdirp: true })
    }
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  let failed: unknown = null
  const worker = async () => {
    while (i < items.length && !failed) {
      const item = items[i++]
      try {
        await fn(item)
      } catch (e) {
        failed ??= e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  if (failed) throw failed
}
