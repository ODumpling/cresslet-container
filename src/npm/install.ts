// npm install: resolve tree, prune, fetch + extract tarballs into the VFS, link .bin entries.
import semver from 'semver'
import type { VFS } from '../vfs'
import { join } from '../path'
import type { Writer } from '../process'
import type { Registry } from './registry'
import { parseSpec, pickVersion, resolveTree, type DepRequest, type Placement } from './resolver'
import { gunzip, untar } from './tar'

export interface InstallOptions {
  cwd: string
  add?: string[]
  remove?: string[]
  dev?: boolean
  exact?: boolean
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
  const warn = (m: string) => o.out.write(`${YELLOW}npm warn${RESET} ${m}\n`)

  // --- edit package.json ---
  for (const name of o.remove ?? []) for (const f of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) if (pkg[f]) delete pkg[f]![name]
  if (o.add?.length) {
    const field = o.dev ? 'devDependencies' : 'dependencies'
    pkg[field] ??= {}
    for (const raw of o.add) {
      const { name, spec } = splitPkgSpec(raw)
      const parsed = parseSpec(name, spec)
      if ('skip' in parsed) {
        warn(`skipping non-registry dependency ${raw}`)
        pkg[field]![name] = spec
        continue
      }
      const p = await registry.packument(parsed.pkg)
      const v = pickVersion(p, parsed.range)
      if (!v) throw new Error(`No matching version found for ${raw}`)
      const explicit = spec && semver.validRange(spec) && !p['dist-tags'][spec]
      const saved = explicit ? spec : o.exact ? v : `^${v}`
      pkg[field]![name] = spec.startsWith('npm:') ? `npm:${parsed.pkg}@${saved}` : saved
      const other = o.dev ? 'dependencies' : 'devDependencies'
      if (pkg[other]) delete pkg[other]![name]
    }
    for (const f of ['dependencies', 'devDependencies'] as const) if (pkg[f]) pkg[f] = sortKeys(pkg[f]!)
  }
  if (o.add?.length || o.remove?.length) writePkg(vfs, o.cwd, pkg)

  // --- resolve ---
  const deps: DepRequest[] = []
  const seen = new Set<string>()
  const push = (rec: Record<string, string> | undefined, kind: DepRequest['kind']) => {
    for (const [name, spec] of Object.entries(rec ?? {})) if (!seen.has(name)) (seen.add(name), deps.push({ name, spec, kind }))
  }
  push(pkg.dependencies, 'prod')
  push(pkg.devDependencies, 'dev')
  push(pkg.optionalDependencies, 'optional')
  const { placements, warnings } = await resolveTree(deps, registry)
  for (const w of warnings) warn(w)
  if (o.signal?.aborted) throw new Error('aborted')

  // --- prune + diff against what is on disk ---
  const nm = join(o.cwd, 'node_modules')
  const want = new Map(placements.map((p) => [p.path, p]))
  const installed = listInstalled(vfs, o.cwd)
  let removed = 0
  for (const [path, version] of installed) {
    const p = want.get(path)
    if (!p || p.version !== version) {
      vfs.rm(join(o.cwd, path), { recursive: true, force: true })
      if (!p) removed++
    }
  }
  const todo = placements.filter((p) => readVersion(vfs, join(o.cwd, p.path)) !== p.version)

  // --- fetch + extract ---
  if (todo.length) o.out.write(`${DIM}fetching ${todo.length} package${todo.length === 1 ? '' : 's'}…${RESET}\n`)
  await pool(todo, 16, async (p) => {
    if (o.signal?.aborted) throw new Error('aborted')
    const tgz = await registry.tarball(p.manifest.dist.tarball, p.manifest.dist.integrity)
    const entries = untar(await gunzip(tgz), 1)
    const dir = join(o.cwd, p.path)
    vfs.mkdir(dir, { recursive: true })
    for (const e of entries) {
      const fp = join(dir, e.path)
      if (e.type === 'dir') vfs.mkdir(fp, { recursive: true })
      else if (e.type === 'file') vfs.writeFile(fp, e.data.slice(), { mkdirp: true })
      else if (e.type === 'symlink' && e.linkname) {
        vfs.mkdir(join(fp, '..'), { recursive: true })
        vfs.rm(fp, { force: true })
        vfs.symlink(e.linkname, fp)
      }
    }
    if (!vfs.isFile(join(dir, 'package.json'))) vfs.writeFile(join(dir, 'package.json'), JSON.stringify({ name: p.pkg, version: p.version }))
    if (p.manifest.hasInstallScript) warn(`skipped install scripts for ${p.pkg}@${p.version}`)
  })

  linkBins(vfs, o.cwd, placements)
  writeLock(vfs, o.cwd, pkg, placements)
  if (!vfs.isDir(nm)) vfs.mkdir(nm, { recursive: true })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const parts = [`added ${todo.length} package${todo.length === 1 ? '' : 's'}`]
  if (removed) parts.push(`removed ${removed} package${removed === 1 ? '' : 's'}`)
  o.out.write(`\n${parts.join(', ')}, and audited ${placements.length + 1} packages in ${secs}s\n`)
  return { added: todo.length, removed, warnings }
}

function sortKeys(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
}

function readVersion(vfs: VFS, dir: string): string | null {
  const t = vfs.tryReadText(join(dir, 'package.json'))
  if (!t) return null
  try {
    return JSON.parse(t).version ?? null
  } catch {
    return null
  }
}

/** Map of 'node_modules/a[/node_modules/b]' -> version for everything currently installed. */
export function listInstalled(vfs: VFS, cwd: string): Map<string, string> {
  const out = new Map<string, string>()
  const scan = (rel: string) => {
    const abs = join(cwd, rel)
    if (!vfs.isDir(abs)) return
    for (const name of vfs.readdir(abs)) {
      if (name.startsWith('.')) continue
      if (name.startsWith('@')) {
        for (const sub of vfs.isDir(join(abs, name)) ? vfs.readdir(join(abs, name)) : []) visit(`${rel}/${name}/${sub}`)
      } else visit(`${rel}/${name}`)
    }
  }
  const visit = (rel: string) => {
    const v = readVersion(vfs, join(cwd, rel))
    out.set(rel, v ?? '')
    scan(`${rel}/node_modules`)
  }
  scan('node_modules')
  return out
}

export function binEntries(name: string, bin: Manifest['bin']): [string, string][] {
  if (!bin) return []
  if (typeof bin === 'string') return [[name.startsWith('@') ? name.split('/')[1] : name, bin]]
  return Object.entries(bin)
}
type Manifest = Placement['manifest']

function linkBins(vfs: VFS, cwd: string, placements: Placement[]): void {
  const binDir = join(cwd, 'node_modules/.bin')
  vfs.rm(binDir, { recursive: true, force: true })
  for (const p of placements) {
    if (p.depth !== 1) continue
    let bin = p.manifest.bin
    if (!bin) {
      // abbreviated packuments may omit bin; fall back to the extracted package.json
      const t = vfs.tryReadText(join(cwd, p.path, 'package.json'))
      bin = t ? JSON.parse(t).bin : undefined
    }
    for (const [name, rel] of binEntries(p.name, bin)) {
      const target = `../${p.name}/${rel.replace(/^\.\//, '')}`
      vfs.writeFile(join(binDir, name), `#!/usr/bin/env node\n// clover-bin -> ${target}\nrequire(${JSON.stringify(target)})\n`, { mkdirp: true })
    }
  }
}

function writeLock(vfs: VFS, cwd: string, pkg: PackageJsonLike, placements: Placement[]): void {
  const packages: Record<string, unknown> = {
    '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
  }
  for (const p of placements) {
    packages[p.path] = {
      ...(p.pkg !== p.name ? { name: p.pkg } : {}),
      version: p.version,
      resolved: p.manifest.dist.tarball,
      integrity: p.manifest.dist.integrity,
      ...(p.manifest.dependencies ? { dependencies: p.manifest.dependencies } : {}),
    }
  }
  vfs.writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2) + '\n')
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
