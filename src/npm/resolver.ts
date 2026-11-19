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
}

export interface ResolveResult {
  placements: Placement[]
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

export async function resolveTree(
  rootDeps: DepRequest[],
  registry: Registry,
  opts: { peers?: boolean; onProgress?: (msg: string) => void } = {},
): Promise<ResolveResult> {
  const warnings: string[] = []
  const root: TreeNode = { name: '', pkg: '', version: '', parent: null, children: new Map(), depth: 0 }
  const fetched = new Map<string, Packument | Error>()
  let level: { node: TreeNode; deps: DepRequest[] }[] = [{ node: root, deps: rootDeps }]
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
    const ok = (n: TreeNode) => n.pkg === parsed.pkg && (semver.satisfies(n.version, parsed.range, { loose: true, includePrerelease: true }) || n.version === parsed.range)
    if (found && ok(found)) return null
    if (isPeer && found) {
      warnings.push(`peer dependency ${dep.name}@${dep.spec} (required by ${node.name || 'root'}) conflicts with installed ${found.version}`)
      return null
    }
    if (dep.kind === 'peerOptional' && !found) return null
    const pk = fetched.get(parsed.pkg)
    if (!pk || pk instanceof Error) {
      if (dep.kind === 'optional' || isPeer) {
        warnings.push(`optional dependency ${dep.name} failed: ${pk instanceof Error ? pk.message : 'not fetched'}`)
        return null
      }
      throw pk ?? new Error(`failed to fetch ${parsed.pkg}`)
    }
    const version = pickVersion(pk, parsed.range)
    const manifest = version ? pk.versions[version] : undefined
    if (!version || !manifest) {
      if (dep.kind === 'optional' || isPeer) return null
      throw new Error(`No matching version found for ${parsed.pkg}@${parsed.range}${node.name ? ` (required by ${node.name}@${node.version})` : ''}`)
    }
    if (dep.kind === 'optional' && platformBound(manifest)) return null
    const target = found ? node : root
    const child: TreeNode = { name: dep.name, pkg: parsed.pkg, version, manifest, parent: target, children: new Map(), depth: target.depth + 1 }
    target.children.set(dep.name, child)
    if (manifest.deprecated && node === root) warnings.push(`deprecated ${parsed.pkg}@${version}: ${manifest.deprecated}`)
    return child
  }

  while (level.length) {
    const names = new Set<string>()
    for (const { deps } of level)
      for (const d of deps) {
        const p = parseSpec(d.name, d.spec)
        if (!('skip' in p)) names.add(p.pkg)
      }
    opts.onProgress?.(`resolving ${names.size} packages`)
    await fetchAll([...names])
    const next: typeof level = []
    for (const { node, deps } of level) {
      // regular deps first, peers after the whole level is placed
      for (const dep of deps) {
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
        if (!('skip' in p)) pnames.add(p.pkg)
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
      placements.push({ path, name: c.name, pkg: c.pkg, version: c.version, manifest: c.manifest!, depth: c.depth })
      walk(c, path + '/')
    }
  }
  walk(root, '')
  return { placements, warnings }
}
