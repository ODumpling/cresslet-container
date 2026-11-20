// package-lock.json (v2/v3 `packages` map) + npm workspaces: read, sync check, placements, write.
import semver from 'semver'
import type { VFS } from '../vfs'
import { join } from '../path'
import { workspaceGlobToRegExp } from '../tree'
import type { Manifest } from './registry'
import { packageDeps, parseSpec, withoutOptional, type Link, type Placement, type Workspace } from './resolver'

export interface LockEntry {
  name?: string
  version?: string
  resolved?: string
  integrity?: string
  link?: boolean
  dev?: boolean
  optional?: boolean
  devOptional?: boolean
  inBundle?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  bin?: string | Record<string, string>
  os?: string[]
  cpu?: string[]
  hasInstallScript?: boolean
  workspaces?: unknown
  [k: string]: unknown
}

export interface Lockfile {
  lockfileVersion?: number
  packages?: Record<string, LockEntry>
  [k: string]: unknown
}

interface PkgLike {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: unknown
  overrides?: unknown
  bin?: string | Record<string, string>
  [k: string]: unknown
}

export const LOCK_NAMES = ['npm-shrinkwrap.json', 'package-lock.json']
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

/** The project's lockfile (npm-shrinkwrap.json wins, as in npm), or null. Throws on unparsable JSON. */
export function readLock(vfs: VFS, cwd: string): { file: string; lock: Lockfile } | null {
  for (const name of LOCK_NAMES) {
    const file = join(cwd, name)
    const t = vfs.tryReadText(file)
    if (t == null) continue
    try {
      return { file: name, lock: JSON.parse(t) }
    } catch (e) {
      throw new Error(`invalid ${name}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return null
}

/** Workspace patterns from package.json (`["packages/*"]` or `{ packages: [...] }`). */
function workspacePatterns(pkg: PkgLike): string[] {
  const w = pkg.workspaces
  const list = Array.isArray(w) ? w : w && typeof w === 'object' && Array.isArray((w as { packages?: unknown }).packages) ? (w as { packages: unknown[] }).packages : []
  return list.filter((p): p is string => typeof p === 'string').flatMap(expandBraces)
}

/** `{apps/*,packages/*}` -> `apps/*`, `packages/*` (alternatives may hold globs, as npm's matcher allows). */
function expandBraces(p: string): string[] {
  const open = p.indexOf('{')
  const close = open < 0 ? -1 : p.indexOf('}', open)
  if (close < 0) return [p]
  return p.slice(open + 1, close).split(',').flatMap((alt) => expandBraces(p.slice(0, open) + alt + p.slice(close + 1)))
}

/** Expand package.json `workspaces` into the directories (relative to cwd) that have a package.json, sorted. */
export function findWorkspaces(vfs: VFS, cwd: string, pkg: PkgLike): Workspace[] {
  const clean = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '')
  const pats = workspacePatterns(pkg)
  // in order, as npm: the last pattern matching a dir decides (`packages/*`, `!packages/g*`, `packages/greet`)
  const ordered = pats.map((p) => ({ neg: p.startsWith('!'), re: workspaceGlobToRegExp(clean(p.startsWith('!') ? p.slice(1) : p)) }))
  const included = (r: string) => ordered.reduce((inc, o) => (o.re.test(r) ? !o.neg : inc), false)
  if (!ordered.some((o) => !o.neg)) return []
  // only walk where a pattern can still match: under its literal leading segments, and no deeper than it unless `**`
  const shapes = pats.filter((p) => !p.startsWith('!')).map((p) => {
    const segs = clean(p).split('/')
    const lit = segs.findIndex((x) => /[*?[{]/.test(x))
    return { prefix: lit < 0 ? segs : segs.slice(0, lit), depth: segs.includes('**') ? Infinity : segs.length }
  })
  const mayMatchUnder = (r: string) => {
    const segs = r.split('/')
    return shapes.some((sh) => segs.length < sh.depth && sh.prefix.every((x, i) => i >= segs.length || x === segs[i]))
  }
  const dirs = new Set<string>()
  const walk = (rel: string, depth: number) => {
    const abs = rel ? join(cwd, rel) : cwd
    for (const d of vfs.readdirEntries(abs)) {
      if (!d.isDirectory() || d.isSymbolicLink() || d.name === 'node_modules' || d.name.startsWith('.')) continue
      const r = rel ? `${rel}/${d.name}` : d.name
      if (!rel && !shapes.some((sh) => !sh.prefix.length || sh.prefix[0] === d.name)) continue
      if (included(r) && vfs.isFile(join(cwd, r, 'package.json'))) dirs.add(r)
      if (depth < 8 && mayMatchUnder(r)) walk(r, depth + 1)
    }
  }
  walk('', 0)
  const out: Workspace[] = []
  const names = new Map<string, string>()
  for (const path of [...dirs].sort()) {
    let wp: PkgLike
    try {
      wp = JSON.parse(vfs.readText(join(cwd, path, 'package.json')))
    } catch (e) {
      throw new Error(`invalid ${path}/package.json: ${e instanceof Error ? e.message : e}`)
    }
    const name = wp.name || path.split('/').pop()!
    // it becomes node_modules/<name>: a package name, nothing that leaves node_modules
    if (!/^(@[^/@.][^/]*\/)?[^/@.][^/]*$/.test(name) || name.includes('\\')) throw new Error(`invalid workspace name ${JSON.stringify(name)} (${path}/package.json)`)
    if (names.has(name)) throw new Error(`must not have multiple workspaces with the same name: ${name} (${names.get(name)}, ${path})`)
    names.set(name, path)
    out.push({ name, version: wp.version ?? '0.0.0', path, pkg: wp })
  }
  return out
}

/** A dependency field as npm normalizes it (optionalDependencies win over dependencies). */
const norm = (p: PkgLike, f: (typeof DEP_FIELDS)[number]) => (f === 'dependencies' ? withoutOptional(p.dependencies, p.optionalDependencies) : p[f])

const sameDeps = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) => {
  const ka = Object.keys(a ?? {})
  return ka.length === Object.keys(b ?? {}).length && ka.every((k) => b![k] === a![k])
}

/**
 * Why the lockfile can't be installed as is for this package.json and workspaces (null when it can), as `npm ci`
 * checks: the same dependency specs for the root and every workspace, the same workspaces (linked), well-formed
 * paths, and every dependency of the root, a workspace or a locked package resolving (from where it is required, as
 * node's lookup would) to an entry that satisfies it.
 */
export function lockOutOfSync(lock: Lockfile, pkg: PkgLike, workspaces: Workspace[]): string | null {
  const pk = lock.packages
  if (!pk || typeof pk !== 'object' || (lock.lockfileVersion ?? 0) < 2) return `lockfileVersion ${lock.lockfileVersion ?? 1} is not supported (needs 2 or 3)`
  const roots: [string, PkgLike][] = [['', pkg], ...workspaces.map((w) => [w.path, w.pkg] as [string, PkgLike])]
  const wsPaths = new Map(workspaces.map((w) => [w.path, w]))
  for (const [path, p] of roots) {
    const e = pk[path]
    if (!e) return `missing ${path || 'the root package'}`
    for (const f of DEP_FIELDS) if (!sameDeps(norm(p, f), norm(e, f))) return `${f} of ${path || 'the root package'} differ`
    if (path && p.version !== e.version) return `version of ${path} differs`
  }
  const lockWs = Object.keys(pk).filter((k) => k && !isNodeModulesPath(k))
  // a key outside node_modules that no workspace pattern could ever produce (`../lib`): a `file:` dependency
  const patterns = workspacePatterns(pkg).filter((p) => !p.startsWith('!')).map((p) => workspaceGlobToRegExp(p.replace(/^\.\//, '').replace(/\/+$/, '')))
  const extra = lockWs.find((k) => !wsPaths.has(k) && !patterns.some((re) => re.test(k))) // not a (removed) workspace either
  if (extra) return `${extra} is not a workspace (file: dependencies aren't supported)`
  if (lockWs.length !== workspaces.length || workspaces.some((w) => !(w.path in pk))) return 'workspaces differ'
  for (const w of workspaces) {
    const l = pk[`node_modules/${w.name}`]
    if (!l?.link || l.resolved !== w.path) return `workspace ${w.name} is not linked`
  }
  const links = Object.keys(pk).filter((k) => k && pk[k]?.link)
  for (const k of Object.keys(pk)) {
    if (!k || !isNodeModulesPath(k)) continue
    if (!validPath(k, wsPaths) || !pk[k] || typeof pk[k] !== 'object') return `invalid entry ${k}`
    if (links.some((l) => k.startsWith(l + '/'))) return `invalid entry ${k} (inside a link)`
  }

  const wsList = [...wsPaths.keys()]
  const lookup = (from: string, name: string) => lockLookup(pk, wsList, from, name)
  // `overrides` pin transitive versions outside their parents' ranges: there, only check that an entry exists
  const overridden = !!pkg.overrides && typeof pkg.overrides === 'object' && Object.keys(pkg.overrides).length > 0
  const edge = (from: string, name: string, spec: string, optional: boolean, anyVersion: boolean): string | null => {
    const by = from || 'the root package'
    const k = lookup(from, name)
    if (!k) return optional || (!spec.startsWith('workspace:') && 'skip' in parseSpec(name, spec)) ? null : `no entry for ${name} (required by ${by})`
    const e = pk[k]
    if (e.link) {
      const ws = typeof e.resolved === 'string' ? wsPaths.get(e.resolved) : undefined
      // the root's own edge to a workspace is always the link (the resolver keeps it, warning on a mismatch)
      if (!ws || !from || spec.startsWith('workspace:')) return null
      const parsed = parseSpec(name, spec)
      return optional || 'skip' in parsed || (parsed.pkg === ws.name && satisfies(ws.version, parsed.range)) ? null : `${k} (workspace ${ws.name}@${ws.version}) doesn't satisfy ${name}@${spec} (required by ${by})`
    }
    if (spec.startsWith('workspace:')) return `${name}@${spec} (required by ${by}) is not a workspace`
    const parsed = parseSpec(name, spec)
    if ('skip' in parsed || anyVersion) return null
    const real = e.name ?? nameFromPath(k)
    // an optional edge nothing satisfies is one left out (as when its version wasn't available)
    if (real !== parsed.pkg || !e.version || !satisfies(e.version, parsed.range)) return optional ? null : `${k} (${real}@${e.version}) doesn't satisfy ${name}@${spec} (required by ${by})`
    return null
  }
  const edges = (from: string, e: PkgLike, dev: boolean, anyVersion = false): string | null => {
    for (const d of packageDeps(e, dev)) {
      const bad = edge(from, d.name, d.spec, d.kind === 'optional', anyVersion)
      if (bad) return bad
    }
    return null
  }
  for (const [path, p] of roots) {
    const bad = edges(path, p, true, !!path && overridden) // overrides can pin a workspace's deps, not the root's
    if (bad) return bad
  }
  // what isn't installed here needn't resolve here (the same reachability as installing from it)
  const skipped = notInstalled(pk, wsList)
  for (const [k, e] of Object.entries(pk)) {
    if (!isNodeModulesPath(k) || e.link || e.inBundle || skipped.has(k)) continue
    const bad = edges(k, e, false, overridden)
    if (bad) return bad
  }
  return null
}

/** The entry `name` resolves to from `from` ('' = root, a workspace dir or a node_modules path), as node looks up. */
function lockLookup(pk: Record<string, LockEntry>, ws: readonly string[], from: string, name: string): string | null {
  for (let base = from; ; ) {
    const k = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
    if (pk[k]) return k
    if (!base) return null
    // up: past `node_modules/x`, else from a workspace dir to the enclosing workspace (or the root)
    const i = base.lastIndexOf('/node_modules/')
    if (i >= 0) base = base.slice(0, i)
    else if (base.startsWith('node_modules/')) base = ''
    else base = ws.filter((w) => base.startsWith(w + '/')).sort((a, b) => b.length - a.length)[0] ?? ''
  }
}

/** Entries not installed here: other platforms' packages, and optional ones only those (or other such) need. */
function notInstalled(pk: Record<string, LockEntry>, workspaces: readonly string[]): Set<string> {
  const requirers = new Map<string, string[]>()
  for (const [k, e] of Object.entries(pk)) {
    const root = !isNodeModulesPath(k)
    for (const f of root ? DEP_FIELDS : (['dependencies', 'optionalDependencies', 'peerDependencies'] as const)) for (const n of Object.keys(e?.[f] ?? {})) requirers.set(n, [...(requirers.get(n) ?? []), k])
  }
  const skipped = new Set(Object.keys(pk).filter((k) => isNodeModulesPath(k) && platformOnly(pk[k])))
  for (let changed = true; changed; ) {
    changed = false
    for (const [k, e] of Object.entries(pk)) {
      // `optional` only: `devOptional` is required when dev deps are installed (as they all are here)
      if (!isNodeModulesPath(k) || skipped.has(k) || !e.optional || e.link) continue
      const n = nameFromPath(k)
      if ((requirers.get(n) ?? []).some((r) => !skipped.has(r) && lockLookup(pk, workspaces, r, n) === k)) continue
      skipped.add(k)
      changed = true
    }
  }
  return skipped
}

/** Optional (in prod or dev) and platform-specific: listed for other platforms, never installed here. */
const platformOnly = (e: LockEntry) => !!((e.optional || e.devOptional) && (e.os?.length || e.cpu?.length))

const satisfies = (v: string, range: string) => !semver.validRange(range, { loose: true }) || semver.satisfies(v, range, { loose: true, includePrerelease: true })

const SEGMENT = /^[^/\\]+$/
const okSegment = (s: string | undefined) => !!s && SEGMENT.test(s) && s !== '.' && s !== '..' && s !== 'node_modules'

/** `[<workspace>/]node_modules/<name>[/node_modules/<name>...]`, names optionally scoped, nothing else. */
function validPath(k: string, workspaces: Map<string, unknown>): boolean {
  const i = k.startsWith('node_modules/') ? 0 : k.indexOf('/node_modules/') + 1
  if (i < 0 || (i > 0 && !workspaces.has(k.slice(0, i - 1)))) return false
  const parts = k.slice(i).split('/')
  for (let j = 0; j < parts.length; ) {
    if (parts[j++] !== 'node_modules') return false
    if (parts[j]?.startsWith('@') && !okSegment(parts[j++].slice(1))) return false
    if (!okSegment(parts[j++])) return false
  }
  return true
}

const isNodeModulesPath = (k: string) => k.startsWith('node_modules/') || k.includes('/node_modules/')

/** Package name from a lockfile path: the part after the last `node_modules/`. */
export function nameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
}

/** Depth 1 = directly in the root's or a workspace's node_modules. */
const depthOf = (path: string) => path.split('node_modules/').length - 1

/**
 * Placements and links the lockfile lists, minus what can't or needn't be fetched here: bundled deps (inside their
 * parent's tarball), optional platform-specific packages and non-registry sources (warned, as fresh installs do).
 * Expects a lockfile `lockOutOfSync` accepted (so its paths are well-formed); `workspaces` are the workspace dirs.
 */
export function lockContents(lock: Lockfile, workspaces: Set<string>): { placements: Placement[]; links: Link[]; bundled: Set<string>; warnings: string[]; needsManifest: Placement[] } {
  const bundled = new Set<string>()
  const placements: Placement[] = []
  const links: Link[] = []
  const warnings: string[] = []
  const needsManifest: Placement[] = []
  const pk = lock.packages ?? {}
  const wsList = [...workspaces]
  const skipped = notInstalled(pk, wsList)
  for (const [path, e] of Object.entries(pk)) {
    if (!isNodeModulesPath(path) || !e || typeof e !== 'object') continue
    const name = nameFromPath(path)
    if (e.link) {
      if (typeof e.resolved === 'string' && workspaces.has(e.resolved)) links.push({ path, target: e.resolved })
      else warnings.push(`skipping non-registry dependency ${name}@file:${e.resolved}`)
      continue
    }
    if (e.inBundle) {
      bundled.add(path)
      continue
    }
    if (skipped.has(path)) continue
    const resolved = e.resolved
    if (resolved != null && !/^https?:\/\//.test(resolved)) {
      warnings.push(`skipping non-registry dependency ${name}@${resolved}`)
      continue
    }
    if (!e.version) {
      warnings.push(`skipping ${path}: no version in the lockfile`)
      continue
    }
    const manifest: Manifest = {
      name: e.name ?? name,
      version: e.version,
      dist: { tarball: resolved ?? '', integrity: e.integrity },
      ...(e.dependencies ? { dependencies: e.dependencies } : {}),
      ...(e.optionalDependencies ? { optionalDependencies: e.optionalDependencies } : {}),
      ...(e.peerDependencies ? { peerDependencies: e.peerDependencies } : {}),
      ...(e.peerDependenciesMeta ? { peerDependenciesMeta: e.peerDependenciesMeta as Manifest['peerDependenciesMeta'] } : {}),
      ...(e.bin ? { bin: e.bin } : {}),
      ...(e.hasInstallScript ? { hasInstallScript: true } : {}),
    }
    const p: Placement = { path, name, pkg: e.name ?? name, version: e.version, manifest, depth: depthOf(path), ...(e.optional ? { optional: true } : {}) }
    placements.push(p)
    if (!resolved) needsManifest.push(p)
  }
  // missing required peers only warn (as with --legacy-peer-deps lockfiles, which leave them out)
  for (const p of placements) {
    const e = pk[p.path]
    const meta = (e.peerDependenciesMeta ?? {}) as Record<string, { optional?: boolean }>
    for (const n of Object.keys(e.peerDependencies ?? {})) if (!meta[n]?.optional && !lockLookup(pk, wsList, p.path, n)) warnings.push(`peer dependency ${n} of ${p.pkg}@${p.version} is not in the lockfile`)
  }
  return { placements, links, bundled, warnings, needsManifest }
}

/** Write the lockfile (v3) for a resolved tree: `file` is the one read (npm-shrinkwrap.json), else package-lock.json. */
export function writeLock(vfs: VFS, cwd: string, file: string, pkg: PkgLike, workspaces: Workspace[], placements: Placement[], links: Link[], platform: Placement[] = []): void {
  const deps = (p: PkgLike) => Object.fromEntries(DEP_FIELDS.filter((f) => norm(p, f) && Object.keys(norm(p, f)!).length).map((f) => [f, norm(p, f)]))
  const packages: Record<string, unknown> = {
    '': { name: pkg.name, version: pkg.version, ...(pkg.workspaces ? { workspaces: pkg.workspaces } : {}), ...deps(pkg) },
  }
  const entries: [string, unknown][] = []
  for (const l of links) entries.push([l.path, { resolved: l.target, link: true }])
  for (const w of workspaces) entries.push([w.path, { name: w.name, ...(w.pkg.version !== undefined ? { version: w.pkg.version } : {}), ...deps(w.pkg), ...(w.pkg.bin ? { bin: w.pkg.bin } : {}) }])
  for (const p of [...placements, ...platform]) {
    const m = p.manifest
    const only = platform.includes(p)
    entries.push([
      p.path,
      {
        ...(p.pkg !== p.name ? { name: p.pkg } : {}),
        version: p.version,
        resolved: m.dist.tarball,
        integrity: m.dist.integrity,
        ...(m.dependencies ? { dependencies: m.dependencies } : {}),
        ...(m.optionalDependencies ? { optionalDependencies: m.optionalDependencies } : {}),
        ...(m.peerDependencies ? { peerDependencies: m.peerDependencies } : {}),
        ...(m.peerDependenciesMeta ? { peerDependenciesMeta: m.peerDependenciesMeta } : {}),
        ...(m.bin ? { bin: m.bin } : {}),
        ...(m.hasInstallScript ? { hasInstallScript: true } : {}),
        // other platforms' optional packages: npm elsewhere installs them from this lockfile
        ...(only ? { optional: true, ...(m.os ? { os: m.os } : {}), ...(m.cpu ? { cpu: m.cpu } : {}) } : {}),
      },
    ])
  }
  for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : 1))) packages[k] = v
  vfs.writeFile(join(cwd, file), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n')
}
