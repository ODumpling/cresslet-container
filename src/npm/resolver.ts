// Dependency tree resolution with npm-style hoisting (nest on conflict). Pure: depends only on a Registry.
import semver from 'semver'
import type { Manifest, Packument, Registry } from './registry'

export interface DepRequest {
  /** Directory name under node_modules (alias name for `npm:` specs). */
  name: string
  spec: string
  kind?: 'prod' | 'dev' | 'optional' | 'peer' | 'peerOptional'
}

export interface Placement {
  /** e.g. 'node_modules/a/node_modules/b' */
  path: string
  name: string
  /** Real registry package name (differs for aliases). */
  pkg: string
  version: string
  manifest: Manifest
  depth: number
  /** An optional dependency: failing to fetch it only warns. */
  optional?: boolean
}

/** A symlink in node_modules, e.g. a workspace: `node_modules/a` -> `packages/a` (both relative to the project). */
export interface Link {
  path: string
  target: string
}

export interface Workspace {
  name: string
  version: string
  /** Directory relative to the project root, e.g. 'packages/a'. */
  path: string
  pkg: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    bin?: string | Record<string, string>
    [k: string]: unknown
  }
}

export interface ResolveResult {
  placements: Placement[]
  links: Link[]
  /** Optional platform-specific packages left out (they can't run here), kept for the lockfile. */
  platform: Placement[]
  warnings: string[]
}

interface TreeNode {
  name: string
  pkg: string
  version: string
  manifest?: Manifest
  parent: TreeNode | null
  children: Map<string, TreeNode>
  depth: number
  /** Workspace link at the root: its target directory. */
  link?: string
  /** Workspace package (its deps nest under `${ws}/node_modules`). */
  ws?: string
  /** Another platform's optional package: in the tree (so versions nest as npm would) and the lockfile, not installed. */
  platformOnly?: boolean
  /** Where it is (would be) installed: '' for the root, the dir for a workspace, else its node_modules path. */
  path: string
}

const NON_REGISTRY = /^(github:|gitlab:|bitbucket:|gist:|git\+|git:|file:|link:|workspace:|portal:|patch:|https?:|\.{0,2}\/|~\/)/

/** Classify a dependency spec. */
export function parseSpec(name: string, spec: string): { pkg: string; range: string } | { skip: string } {
  spec = (spec ?? '').trim()
  if (spec.startsWith('npm:')) {
    const rest = spec.slice(4)
    const at = rest.lastIndexOf('@')
    return at > 0 ? { pkg: rest.slice(0, at), range: rest.slice(at + 1) || 'latest' } : { pkg: rest, range: 'latest' }
  }
  if (NON_REGISTRY.test(spec) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec)) return { skip: `${name}@${spec}` }
  return { pkg: name, range: spec || 'latest' }
}

export function pickVersion(p: Packument, range: string): string | null {
  const tags = p['dist-tags'] ?? {}
  if (tags[range]) return tags[range]
  const versions = Object.keys(p.versions ?? {})
  const latest = tags.latest
  if (range === '' || range === '*' || range === 'x') {
    if (latest && p.versions[latest]) return latest
  }
  if (!semver.validRange(range, { loose: true })) return null
  if (latest && p.versions[latest] && semver.satisfies(latest, range, { loose: true })) return latest
  return semver.maxSatisfying(versions, range, { loose: true })
}

function depsOf(m: Manifest, includePeers: boolean): DepRequest[] {
  const out: DepRequest[] = []
  const optional = m.optionalDependencies ?? {}
  for (const [n, s] of Object.entries(m.dependencies ?? {})) if (!(n in optional)) out.push({ name: n, spec: s, kind: 'prod' })
  for (const [n, s] of Object.entries(optional)) out.push({ name: n, spec: s, kind: 'optional' })
  if (includePeers) {
    const meta = m.peerDependenciesMeta ?? {}
    for (const [n, s] of Object.entries(m.peerDependencies ?? {})) {
      if (n in (m.dependencies ?? {})) continue
      out.push({ name: n, spec: s, kind: meta[n]?.optional ? 'peerOptional' : 'peer' })
    }
  }
  return out
}

/** Platform-specific native packages (esbuild binaries etc.) can never run here. */
function platformBound(m: Manifest): boolean {
  return !!(m.os?.length || m.cpu?.length)
}

/** As npm normalizes a manifest: a name in optionalDependencies is dropped from dependencies. */
export function withoutOptional(deps: Record<string, string> | undefined, optional: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!deps || !optional) return deps
  return Object.fromEntries(Object.entries(deps).filter(([n]) => !(n in optional)))
}

/**
 * A package's own dependency edges (root or workspace; `dev` false for an installed package): a name in several
 * fields gets the last of prod, optional, dev, as npm's arborist loads them.
 */
export function packageDeps(pkg: Workspace['pkg'], dev = true): DepRequest[] {
  const edges = new Map<string, DepRequest>()
  const load = (rec: Record<string, string> | undefined, kind: DepRequest['kind']) => {
    for (const [name, spec] of Object.entries(rec ?? {})) edges.delete(name), edges.set(name, { name, spec, kind })
  }
  load(pkg.dependencies, 'prod')
  load(pkg.optionalDependencies, 'optional')
  if (dev) load(pkg.devDependencies, 'dev')
  // in field order (prod, dev, optional) for placement, as before
  const rank = { prod: 0, dev: 1, optional: 2 } as Record<string, number>
  return [...edges.values()].sort((a, b) => rank[a.kind!] - rank[b.kind!])
}

export async function resolveTree(
  rootDeps: DepRequest[],
  registry: Registry,
  opts: {
    peers?: boolean
    onProgress?: (msg: string) => void
    /** Linked at `node_modules/<name>`; their deps hoist to the root, nesting under the workspace on conflict. */
    workspaces?: Workspace[]
    /**
     * Versions to keep when they still satisfy the range (from the lockfile), by install path: the one locked where
     * the package goes first, else the highest locked anywhere.
     */
    locked?: Map<string, { pkg: string; version: string }>
    /** Install paths resolved fresh (an edited edge): no locked version from elsewhere is borrowed for them. */
    fresh?: Set<string>
  } = {},
): Promise<ResolveResult> {
  const warnings: string[] = []
  const root: TreeNode = { name: '', pkg: '', version: '', parent: null, children: new Map(), depth: 0, path: '' }
  const fetched = new Map<string, Packument | Error>()
  let level: { node: TreeNode; deps: DepRequest[] }[] = [{ node: root, deps: rootDeps }]
  const workspaces = opts.workspaces ?? []
  const wsNodes: TreeNode[] = []
  for (const w of workspaces) {
    root.children.set(w.name, { name: w.name, pkg: w.name, version: w.version, parent: root, children: new Map(), depth: 1, link: w.path, path: `node_modules/${w.name}` })
    // a workspace inside another one resolves through that one's node_modules first, as node does from its files
    const outer = wsNodes.filter((n) => w.path.startsWith(n.path + '/')).sort((a, b) => b.path.length - a.path.length)[0]
    const node: TreeNode = { name: w.name, pkg: w.name, version: w.version, parent: outer ?? root, children: new Map(), depth: 0, ws: w.path, path: w.path }
    wsNodes.push(node)
    level.push({ node, deps: packageDeps(w.pkg) })
  }
  const lockedByName = new Map<string, string[]>()
  for (const { pkg, version } of opts.locked?.values() ?? []) lockedByName.set(pkg, [...(lockedByName.get(pkg) ?? []), version])
  const fits = (pk: Packument, v: string, range: string) => !!pk.versions[v] && (!semver.validRange(range, { loose: true }) || semver.satisfies(v, range, { loose: true, includePrerelease: true })) // a tag (`latest`) keeps what's locked
  /** `fresh`: an edited edge (keyed by its requester's path or where it goes): no locked version at all. */
  const choose = (pk: Packument, range: string, at: string, fresh = false): string | null => {
    if (fresh || opts.fresh?.has(at)) return pickVersion(pk, range)
    const here = opts.locked?.get(at)
    if (here && here.pkg === pk.name && fits(pk, here.version, range)) return here.version
    let best: string | null = null
    for (const v of lockedByName.get(pk.name) ?? []) if (fits(pk, v, range) && (!best || semver.gt(v, best))) best = v
    return best ?? pickVersion(pk, range)
  }
  const peerQueue: { node: TreeNode; dep: DepRequest }[] = []

  const fetchAll = async (names: string[]) => {
    await Promise.all(
      names
        .filter((n) => !fetched.has(n))
        .map(async (n) => {
          try {
            fetched.set(n, await registry.packument(n))
          } catch (e) {
            fetched.set(n, e as Error)
          }
        }),
    )
  }

  const place = (node: TreeNode, dep: DepRequest): TreeNode | null => {
    if (dep.spec?.startsWith('workspace:')) {
      const w = workspaces.find((w) => w.name === dep.name)
      if (w) {
        let seen: TreeNode | undefined
        for (let a: TreeNode | null = node; a && !seen; a = a.parent) seen = a.children.get(dep.name)
        // the root link, unless something nearer (an enclosing workspace's own copy) shadows it: then a link here
        if (!seen?.link) node.children.set(dep.name, { name: w.name, pkg: w.name, version: w.version, parent: node, children: new Map(), depth: node.depth + 1, link: w.path, path: `${node.path ? node.path + '/' : ''}node_modules/${w.name}` })
        return null
      }
      if (!workspaces.length) {
        // not installing a workspaces project (e.g. run inside one of its packages): skipped, as before
        warnings.push(`skipping non-registry dependency ${dep.name}@${dep.spec}`)
        return null
      }
      throw new Error(`No workspace named ${dep.name} (${dep.name}@${dep.spec}${node.name ? `, required by ${node.name}` : ''})`)
    }
    const parsed = parseSpec(dep.name, dep.spec)
    if ('skip' in parsed) {
      warnings.push(`skipping non-registry dependency ${parsed.skip}`)
      return null
    }
    const isPeer = dep.kind === 'peer' || dep.kind === 'peerOptional'
    let found: TreeNode | undefined
    for (let a: TreeNode | null = node; a; a = a.parent) {
      found = a.children.get(dep.name)
      if (found) break
    }
    // (a dist-tag, `latest`, accepts a copy at the version the tag now names, or a locked one: one react for every `latest`)
    const fresh = !!opts.fresh?.has(`${node.path ? node.path + '/' : ''}node_modules/${dep.name}`) // an edited edge
    const tagged = !semver.validRange(parsed.range, { loose: true }) ? (fetched.get(parsed.pkg) as Packument | undefined)?.['dist-tags']?.[parsed.range] : undefined
    const ok = (n: TreeNode) => n.pkg === parsed.pkg && (semver.satisfies(n.version, parsed.range, { loose: true, includePrerelease: true }) || n.version === parsed.range || (!!tagged && (n.version === tagged || (!fresh && !!lockedByName.get(parsed.pkg)?.includes(n.version)))))
    // a version locked at the requester's own path that still fits stays there, rather than deduping onto an
    // ancestor's copy (a workspace's typescript@5.5.2 next to the root's 5.6.3, both in its range)
    const ownPath = `${node.path ? node.path + '/' : ''}node_modules/${dep.name}`
    // (or onto what would hoist: with nothing placed yet, a pin at its own path still wins over the root's)
    const own = node !== root && !isPeer && found?.parent !== node && !opts.fresh?.has(ownPath) ? opts.locked?.get(ownPath) : undefined
    const ownPk = own ? fetched.get(parsed.pkg) : undefined
    const keepOwn = !!own && own.pkg === parsed.pkg && own.version !== found?.version && !!ownPk && !(ownPk instanceof Error) && fits(ownPk, own.version, parsed.range)
    if (found && ok(found) && !keepOwn) {
      // a package placed only for other platforms that a package installed here needs (and can run): install it
      if (found.platformOnly && !node.platformOnly && !(dep.kind === 'optional' && platformBound(found.manifest!))) {
        found.platformOnly = false
        return found
      }
      return null
    }
    if (found?.link && node === root) {
      // the root's node_modules/<name> stays the workspace link (as in npm, which reports the edge invalid)
      warnings.push(`${dep.name}@${dep.spec} doesn't match workspace ${found.name}@${found.version}; using the workspace`)
      return null
    }
    if (isPeer && found) {
      warnings.push(`peer dependency ${dep.name}@${dep.spec} (required by ${node.name || 'root'}) conflicts with installed ${found.version}`)
      return null
    }
    if (dep.kind === 'peerOptional' && !found) return null
    // failures inside another platform's branch only cost its lockfile entries
    const soft = dep.kind === 'optional' || isPeer || !!node.platformOnly
    const pk = fetched.get(parsed.pkg)
    if (!pk || pk instanceof Error) {
      if (soft) {
        warnings.push(`optional dependency ${dep.name} failed: ${pk instanceof Error ? pk.message : 'not fetched'}`)
        return null
      }
      throw pk ?? new Error(`failed to fetch ${parsed.pkg}`)
    }
    let target = found || keepOwn ? node : root
    let at = `${target.path ? target.path + '/' : ''}node_modules/${dep.name}`
    let version = choose(pk, parsed.range, at, fresh)
    let manifest = version ? pk.versions[version] : undefined
    if (!version || !manifest) {
      if (soft) return null
      throw new Error(`No matching version found for ${parsed.pkg}@${parsed.range}${node.name ? ` (required by ${node.name}@${node.version})` : ''}`)
    }
    // a package uses its requester's copy of each peer: when that is a nearer one than the root's (a workspace's own
    // react@18 while the root has react@17, or none), it stays with the requester instead of hoisting, where it would
    // see the root's. Without a nearer copy it hoists as before (one copy; a mismatch only warns)
    if (target === root && node !== root) {
      const meta = manifest.peerDependenciesMeta ?? {}
      const clash = Object.entries(manifest.peerDependencies ?? {}).some(([n, r]) => {
        const there = root.children.get(n)
        if (meta[n]?.optional) return false // (a workspace link at the root is a copy like any other)
        for (let a: TreeNode | null = node; a && a !== root; a = a.parent) {
          const c = a.children.get(n)
          if (c) return c !== there && semver.satisfies(c.version, r, { loose: true, includePrerelease: true })
        }
        return false
      })
      if (clash) {
        target = node
        at = `${node.path ? node.path + '/' : ''}node_modules/${dep.name}`
        // the version locked where it now goes, if that one fits
        const there = choose(pk, parsed.range, at, fresh)
        if (there && pk.versions[there]) (version = there), (manifest = pk.versions[there])
      }
    }
    // other platforms' packages (and what only they need) go in the tree and the lockfile, never on disk
    const platformOnly = !!node.platformOnly || (dep.kind === 'optional' && platformBound(manifest))
    const child: TreeNode = { name: dep.name, pkg: parsed.pkg, version, manifest, parent: target, children: new Map(), depth: target.depth + 1, path: at, ...(platformOnly ? { platformOnly } : {}) }
    target.children.set(dep.name, child)
    if (manifest.deprecated && node === root) warnings.push(`deprecated ${parsed.pkg}@${version}: ${manifest.deprecated}`)
    return child
  }

  // a dependency a workspace's link satisfies needs no packument (the workspace may be unpublished)
  // (by its own name: an `npm:` alias of a workspace's package name is fetched)
  const linkedWorkspace = (name: string, p: { pkg: string; range: string }) => name === p.pkg && workspaces.some((w) => w.name === p.pkg && semver.satisfies(w.version, p.range, { loose: true, includePrerelease: true }))
  const level0 = level
  while (level.length) {
    const names = new Set<string>()
    for (const { deps } of level)
      for (const d of deps) {
        const p = parseSpec(d.name, d.spec)
        if (!('skip' in p) && !linkedWorkspace(d.name, p)) names.add(p.pkg)
      }
    opts.onProgress?.(`resolving ${names.size} packages`)
    await fetchAll([...names])
    const next: typeof level = []
    for (const { node, deps } of level) {
      // regular deps first, peers after the whole level is placed; among them, the ones its other deps take as peers
      // first (react before a component library), so those find the requester's copy when they're placed
      const peersOfOthers = new Set<string>()
      for (const d of deps) {
        const p = parseSpec(d.name, d.spec)
        if ('skip' in p) continue
        const pk = fetched.get(p.pkg)
        const v = pk && !(pk instanceof Error) ? pickVersion(pk, p.range) : null
        for (const n of Object.keys((v && (pk as Packument).versions[v]?.peerDependencies) || {})) peersOfOthers.add(n)
      }
      const ordered = [...deps].sort((a, b) => Number(peersOfOthers.has(b.name)) - Number(peersOfOthers.has(a.name)))
      for (const dep of ordered) {
        if (dep.kind === 'peer' || dep.kind === 'peerOptional') {
          peerQueue.push({ node, dep })
          continue
        }
        const child = place(node, dep)
        if (child) next.push({ node: child, deps: depsOf(child.manifest!, opts.peers !== false) })
      }
    }
    if (!next.length && peerQueue.length) {
      // place peers (they hoist to root when absent), may introduce new nodes
      const peers = peerQueue.splice(0)
      const pnames = new Set<string>()
      for (const { dep } of peers) {
        const p = parseSpec(dep.name, dep.spec)
        if (!('skip' in p) && !linkedWorkspace(dep.name, p)) pnames.add(p.pkg)
      }
      await fetchAll([...pnames])
      for (const { node, dep } of peers) {
        const child = place(node, dep)
        if (child) next.push({ node: child, deps: depsOf(child.manifest!, opts.peers !== false) })
      }
    }
    level = next
  }

  const placements: Placement[] = []
  const walk = (n: TreeNode, base: string) => {
    for (const c of [...n.children.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = `${base}node_modules/${c.name}`
      if (c.link) {
        links.push({ path, target: c.link })
        continue
      }
      const p: Placement = { path, name: c.name, pkg: c.pkg, version: c.version, manifest: c.manifest!, depth: c.depth }
      if (c.platformOnly) platform.push({ ...p, optional: true })
      else placements.push(p)
      walk(c, path + '/')
    }
  }
  const links: Link[] = []
  const platform: Placement[] = []
  walk(root, '')
  for (const { node } of level0) if (node.ws) walk(node, `${node.ws}/`)
  return { placements, links, platform, warnings }
}
