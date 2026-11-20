import { describe, expect, it, vi } from 'vitest'
import { VFS } from '../src/vfs'
import { install, listInstalled } from '../src/npm/install'
import { findWorkspaces, lockOutOfSync } from '../src/npm/lockfile'
import { resolveTree } from '../src/npm/resolver'
import { gzip, tar } from '../src/npm/tar'
import type { Manifest, Packument, Registry } from '../src/npm/registry'

type Spec = Record<string, Record<string, Partial<Manifest>>>
const NPMJS = 'https://registry.npmjs.org'
const tgzUrl = (base: string, name: string, v: string) => `${base}/${name}/-/${name.split('/').pop()}-${v}.tgz`

/** Fake registry serving real gzipped tarballs; records what was requested. */
function registry(spec: Spec, opts: { base?: string; latest?: Record<string, string>; tags?: Record<string, Record<string, string>> } = {}) {
  const base = opts.base ?? NPMJS
  const packuments: string[] = []
  const tarballs: string[] = []
  const reg: Registry = {
    base,
    async packument(name) {
      packuments.push(name)
      const vs = spec[name]
      if (!vs) throw new Error(`404 ${name}`)
      const versions = Object.fromEntries(Object.entries(vs).map(([v, m]) => [v, { name, version: v, dist: { tarball: tgzUrl(base, name, v), integrity: `sha512-${name}-${v}` }, ...m }]))
      return { name, 'dist-tags': { latest: opts.latest?.[name] ?? Object.keys(vs).at(-1)!, ...opts.tags?.[name] }, versions } as Packument
    },
    async tarball(url) {
      tarballs.push(url)
      const m = /\/((?:@[^/]+\/)?[^/]+)\/-\/[^/]+-(\d[^/]*)\.tgz$/.exec(url)
      if (!m || !spec[m[1]]?.[m[2]]) throw new Error(`404 ${url}`)
      const [, name, version] = m
      const man = spec[name][version]
      return gzip(
        tar([
          { path: 'package/package.json', data: JSON.stringify({ name, version, bin: man.bin, dependencies: man.dependencies }) },
          { path: 'package/index.js', data: `module.exports = ${JSON.stringify(`${name}@${version}`)}` },
        ]),
      )
    },
  }
  return { reg, packuments, tarballs }
}

const out = () => {
  let text = ''
  return { write: (s: string) => void (text += s), get text() { return text } }
}
const ver = (vfs: VFS, p: string) => JSON.parse(vfs.readText(`/p/${p}/package.json`)).version
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n'

function project(files: Record<string, unknown>): VFS {
  const vfs = new VFS()
  for (const [p, c] of Object.entries(files)) vfs.writeFile(`/p/${p}`, typeof c === 'string' ? c : json(c), { mkdirp: true })
  return vfs
}

const SPEC: Spec = {
  a: { '1.0.0': { dependencies: { c: '^1.0.0' } }, '1.1.0': { dependencies: { c: '^1.0.0' } } },
  b: { '1.0.0': { dependencies: { c: '^2.0.0' } } },
  c: { '1.0.0': {}, '1.2.0': {}, '2.0.0': {} },
}
/** a@1.0.0 + c@1.0.0 hoisted, b with c@2 nested: older than what a fresh resolve picks (a@1.1.0, c@1.2.0). */
const LOCK = {
  name: 'p',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'p', version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } },
    'node_modules/a': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'a', '1.0.0'), integrity: 'sha512-a-1.0.0', dependencies: { c: '^1.0.0' } },
    'node_modules/b': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'b', '1.0.0'), integrity: 'sha512-b-1.0.0', dependencies: { c: '^2.0.0' } },
    'node_modules/b/node_modules/c': { version: '2.0.0', resolved: tgzUrl(NPMJS, 'c', '2.0.0'), integrity: 'sha512-c-2.0.0' },
    'node_modules/c': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0'), integrity: 'sha512-c-1.0.0' },
  },
}
const PKG = { name: 'p', version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } }

describe('lockfile installs', () => {
  it('installs exactly what package-lock.json lists, without packument requests, and leaves it untouched', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK })
    const { reg, packuments, tarballs } = registry(SPEC)
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(packuments).toEqual([])
    expect(tarballs.length).toBe(4)
    expect(r.added).toBe(4)
    expect([...listInstalled(vfs, '/p')].sort()).toEqual([
      ['node_modules/a', 'a@1.0.0'],
      ['node_modules/b', 'b@1.0.0'],
      ['node_modules/b/node_modules/c', 'c@2.0.0'],
      ['node_modules/c', 'c@1.0.0'],
    ])
    expect(vfs.readText('/p/package-lock.json')).toBe(json(LOCK))
    // a second run changes nothing
    expect((await install(vfs, reg, { cwd: '/p', out: out() })).added).toBe(0)
  })

  it('re-resolves when package.json changed, keeping locked versions that still satisfy', async () => {
    const vfs = project({ 'package.json': { ...PKG, dependencies: { a: '^1.0.0' } }, 'package-lock.json': LOCK })
    const { reg } = registry(SPEC)
    const o = out()
    await install(vfs, reg, { cwd: '/p', out: o })
    expect(o.text).toMatch(/package-lock.json is out of date \(dependencies of the root package differ\); resolving/)
    expect([...listInstalled(vfs, '/p')].sort()).toEqual([
      ['node_modules/a', 'a@1.0.0'],
      ['node_modules/c', 'c@1.0.0'],
    ])
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(Object.keys(lock.packages)).toEqual(['', 'node_modules/a', 'node_modules/c'])
    expect(lock.packages[''].dependencies).toEqual({ a: '^1.0.0' })
  })

  it('`npm install <pkg>` keeps the other locked versions', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK })
    const { reg } = registry({ ...SPEC, d: { '3.0.0': { dependencies: { c: '^1.0.0' } } } })
    await install(vfs, reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'node_modules/a')).toBe('1.0.0')
    expect(ver(vfs, 'node_modules/c')).toBe('1.0.0')
    expect(ver(vfs, 'node_modules/d')).toBe('3.0.0')
    expect(JSON.parse(vfs.readText('/p/package-lock.json')).packages['node_modules/d'].version).toBe('3.0.0')
  })

  it('`npm uninstall <pkg>` prunes it and keeps the other locked versions', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK })
    await install(vfs, registry(SPEC).reg, { cwd: '/p', out: out() })
    const r = await install(vfs, registry(SPEC).reg, { cwd: '/p', remove: ['b'], out: out() })
    expect(r.removed).toBe(2) // b and its nested c@2
    expect([...listInstalled(vfs, '/p')].sort()).toEqual([
      ['node_modules/a', 'a@1.0.0'],
      ['node_modules/c', 'c@1.0.0'],
    ])
    expect(Object.keys(JSON.parse(vfs.readText('/p/package-lock.json')).packages)).toEqual(['', 'node_modules/a', 'node_modules/c'])
  })

  it('`npm ci` needs an in-sync lockfile and starts from an empty node_modules', async () => {
    const { reg } = registry(SPEC)
    await expect(install(project({ 'package.json': PKG }), reg, { cwd: '/p', ci: true, out: out() })).rejects.toThrow(/`npm ci` can only install with an existing package-lock.json/)
    const stale = project({ 'package.json': { ...PKG, dependencies: { a: '^1.1.0', b: '^1.0.0' } }, 'package-lock.json': LOCK })
    await expect(install(stale, reg, { cwd: '/p', ci: true, out: out() })).rejects.toThrow(/in sync: dependencies of the root package differ/)
    expect(stale.exists('/p/node_modules')).toBe(false)
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK, 'node_modules/stray/package.json': { name: 'stray', version: '1.0.0' }, 'node_modules/a/package.json': { name: 'a', version: '1.0.0' } })
    const r = await install(vfs, reg, { cwd: '/p', ci: true, out: out() })
    expect(r.added).toBe(4) // a too: ci reinstalls everything
    expect(vfs.exists('/p/node_modules/stray')).toBe(false)
    expect(vfs.readText('/p/node_modules/a/index.js')).toContain('a@1.0.0')
  })

  it('an unreadable lockfile fails `npm ci` before anything changes; `npm install` warns and writes a new one', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': '{"lockfileVersion": 3, "packa' })
    await expect(install(vfs, registry(SPEC).reg, { cwd: '/p', ci: true, out: out() })).rejects.toThrow(/invalid package-lock.json/)
    expect(vfs.exists('/p/node_modules')).toBe(false)
    const r = await install(vfs, registry({ ...SPEC, d: { '1.0.0': {} } }).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(r.warnings[0]).toMatch(/^invalid package-lock.json: .*: resolving and writing a new package-lock.json$/)
    expect(JSON.parse(vfs.readText('/p/package.json')).dependencies.d).toBe('^1.0.0')
    expect(JSON.parse(vfs.readText('/p/package-lock.json')).packages['node_modules/d'].version).toBe('1.0.0')
  })

  it('treats a lockfile that cannot satisfy the tree, or a v1 lockfile, as out of date', () => {
    const P = LOCK.packages
    const without = (k: string) => Object.fromEntries(Object.entries(P).filter(([p]) => p !== k))
    const check = (packages: Record<string, unknown>) => lockOutOfSync({ ...LOCK, packages } as never, PKG, [])
    expect(check(without('node_modules/b'))).toBe('no entry for b (required by the root package)')
    // a transitive edge: b's c@^2 would resolve to the hoisted c@1.0.0
    expect(check(without('node_modules/b/node_modules/c'))).toBe("node_modules/c (c@1.0.0) doesn't satisfy c@^2.0.0 (required by node_modules/b)")
    expect(check({ ...P, 'node_modules/a': { ...P['node_modules/a'], version: '2.0.0' } })).toBe("node_modules/a (a@2.0.0) doesn't satisfy a@^1.0.0 (required by the root package)")
    expect(check({ ...P, 'node_modules/a': { ...P['node_modules/a'], name: 'evil' } })).toMatch(/node_modules\/a \(evil@1.0.0\) doesn't satisfy/)
    expect(lockOutOfSync({ lockfileVersion: 1, dependencies: {} }, PKG, [])).toMatch(/lockfileVersion 1 is not supported/)
    expect(check({ ...P, '../lib': { version: '1.0.0' } })).toBe("../lib is not a workspace (file: dependencies aren't supported)")
    // lockfileVersion 2 (npm 7/8) has the same `packages` map
    expect(lockOutOfSync({ ...LOCK, lockfileVersion: 2, dependencies: {} }, PKG, [])).toBeNull()
  })

  it('accepts transitive versions pinned by `overrides` (npm 11 lockfile)', () => {
    const pkg = { dependencies: { semver: '7.5.0' }, overrides: { 'lru-cache': '7.0.0' } }
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { semver: '7.5.0' } },
        'node_modules/lru-cache': { version: '7.0.0', resolved: tgzUrl(NPMJS, 'lru-cache', '7.0.0'), integrity: 'sha512-x' },
        'node_modules/semver': { version: '7.5.0', resolved: tgzUrl(NPMJS, 'semver', '7.5.0'), integrity: 'sha512-y', dependencies: { 'lru-cache': '^6.0.0' } },
      },
    }
    expect(lockOutOfSync(lock, pkg, [])).toBeNull()
    expect(lockOutOfSync(lock, { dependencies: pkg.dependencies }, [])).toMatch(/doesn't satisfy lru-cache@\^6.0.0/)
    // a direct dependency still has to match
    expect(lockOutOfSync(lock, { dependencies: { semver: '^8' }, overrides: pkg.overrides }, [])).toMatch(/dependencies of the root package differ/)
  })

  it('keeps other platforms\' optional packages in the lockfile it writes, without installing them', async () => {
    const spec: Spec = { tool: { '1.0.0': { optionalDependencies: { 'tool-darwin': '1.0.0', 'tool-linux': '1.0.0' } } }, 'tool-darwin': { '1.0.0': { os: ['darwin'] } }, 'tool-linux': { '1.0.0': { os: ['linux'], cpu: ['x64'] } } }
    const vfs = project({ 'package.json': { dependencies: { tool: '^1.0.0' } } })
    const { reg, tarballs } = registry(spec)
    await install(vfs, reg, { cwd: '/p', out: out() })
    expect(tarballs).toEqual([tgzUrl(NPMJS, 'tool', '1.0.0')])
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(lock.packages['node_modules/tool-linux']).toMatchObject({ version: '1.0.0', optional: true, os: ['linux'], cpu: ['x64'] })
    expect(lock.packages['node_modules/tool-darwin']).toMatchObject({ optional: true, os: ['darwin'] })
    const again = registry(spec)
    await install(vfs, again.reg, { cwd: '/p', ci: true, out: out() })
    expect(again.tarballs).toEqual([tgzUrl(NPMJS, 'tool', '1.0.0')])
  })

  it('records what another platform\'s package needs, without installing it', async () => {
    const spec: Spec = { tool: { '1.0.0': { optionalDependencies: { 'tool-darwin': '1.0.0' } } }, 'tool-darwin': { '1.0.0': { os: ['darwin'], dependencies: { helper: '^1.0.0', gone: '^1.0.0' } } }, helper: { '1.0.0': { dependencies: { gone2: '^1.0.0' } } } }
    const vfs = project({ 'package.json': { dependencies: { tool: '^1.0.0' } } })
    const { reg, tarballs } = registry(spec)
    await install(vfs, reg, { cwd: '/p', out: out() }) // `gone` 404s: only that branch's lockfile entry is lost
    expect(tarballs).toEqual([tgzUrl(NPMJS, 'tool', '1.0.0')])
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(lock.packages['node_modules/helper']).toMatchObject({ version: '1.0.0', optional: true })
    // and installing from that lockfile leaves it off disk too (only the skipped package needs it)
    const fromLock = registry(spec)
    await install(vfs, fromLock.reg, { cwd: '/p', ci: true, out: out() })
    expect(fromLock.tarballs).toEqual([tgzUrl(NPMJS, 'tool', '1.0.0')])
    // a package installed here that needs helper too installs it
    vfs.writeFile('/p/package.json', json({ dependencies: { tool: '^1.0.0', helper: '^1.0.0' } }))
    await install(vfs, registry({ ...spec, helper: { '1.0.0': {} } }).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/helper')).toBe('1.0.0')
  })

  it('a name in dependencies and devDependencies takes the dev range, as npm (npm 11 lockfile)', async () => {
    const pkg = { name: 'r', dependencies: { ms: '^1.0.0' }, devDependencies: { ms: '^2.0.0' } }
    const lock = { lockfileVersion: 3, packages: { '': pkg, 'node_modules/ms': { version: '2.1.3', resolved: tgzUrl(NPMJS, 'ms', '2.1.3'), dev: true } } }
    expect(lockOutOfSync(lock, pkg, [])).toBeNull()
    const vfs = project({ 'package.json': pkg })
    await install(vfs, registry(WS_SPEC).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/ms')).toBe('2.1.3')
  })

  it('`npm install -D <pkg>` keeps its optionalDependencies entry (as npm)', async () => {
    const spec: Spec = { 'is-number': { '7.0.0': {} } }
    const vfs = project({ 'package.json': { optionalDependencies: { 'is-number': '^7.0.0' } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['is-number'], dev: true, out: out() })
    expect(JSON.parse(vfs.readText('/p/package.json'))).toEqual({ optionalDependencies: { 'is-number': '^7.0.0' }, devDependencies: { 'is-number': '^7.0.0' } })
  })

  it('lockfile bin names and targets can\'t reach outside node_modules/.bin and the package', async () => {
    const lock = { lockfileVersion: 3, packages: { '': { dependencies: { a: '1.0.0' } }, 'node_modules/a': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'a', '1.0.0'), bin: { '../../src/index.js': 'index.js', out: '../../src/index.js', ok: 'index.js', nl: 'index.js\n// cresslet-bin -> ../../../src/index.js', 'n\nl': 'index.js' } } } }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'src/index.js': 'mine' })
    await install(vfs, registry({ a: { '1.0.0': {} } }).reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/src/index.js')).toBe('mine')
    expect(vfs.readdir('/p/node_modules/.bin')).toEqual(['ok'])
  })

  it('a tarball can\'t write through a symlink to outside its package (any lockfile host)', async () => {
    const evil = await gzip(
      tar([
        { path: 'package/package.json', data: JSON.stringify({ name: 'evil', version: '1.0.0' }) },
        { path: 'package/out', data: '', linkname: '../../src' },
        { path: 'package/out/index.js', data: 'pwned' },
        { path: 'package/out/new/x.js', data: 'pwned' },
        { path: 'package/self', data: '', linkname: '../../src/index.js' },
        { path: 'package/self', data: 'pwned' },
      ]),
    )
    const reg: Registry = { packument: async () => { throw new Error('none') }, tarball: async () => evil }
    const lock = { lockfileVersion: 3, packages: { '': { dependencies: { evil: '1.0.0' } }, 'node_modules/evil': { version: '1.0.0', resolved: 'https://anywhere.test/evil.tgz' } } }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'src/index.js': 'mine' })
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/src/index.js')).toBe('mine')
    expect(vfs.readdir('/p/src')).toEqual(['index.js'])
    expect(r.warnings.filter((w) => /links outside the package/.test(w))).toHaveLength(2)
    expect(vfs.readText('/p/node_modules/evil/out/index.js')).toBe('pwned') // a plain file in the package instead
  })

  it('an archive\'s own node_modules symlink to project sources is neither created nor scanned and pruned', async () => {
    const evil = await gzip(tar([{ path: 'package/package.json', data: JSON.stringify({ name: 'evil', version: '1.0.0' }) }, { path: 'package/node_modules', data: '', linkname: '../../src' }]))
    const x = await gzip(tar([{ path: 'package/package.json', data: JSON.stringify({ name: 'x', version: '1.0.0' }) }]))
    const reg: Registry = { packument: async () => { throw new Error('none') }, tarball: async (u) => (u.includes('evil') ? evil : x) }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { dependencies: { evil: '1.0.0' } }, 'node_modules/evil': { version: '1.0.0', resolved: 'https://anywhere.test/evil.tgz', dependencies: { x: '1.0.0' } }, 'node_modules/evil/node_modules/x': { version: '1.0.0', resolved: 'https://anywhere.test/x.tgz' } },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'src/index.js': 'mine', 'src/lib/util.js': 'mine' })
    await install(vfs, reg, { cwd: '/p', out: out() })
    await install(vfs, reg, { cwd: '/p', out: out() }) // a reinstall prunes: still nothing of src goes
    expect(vfs.readdir('/p/src')).toEqual(['index.js', 'lib'])
    expect(vfs.readText('/p/src/lib/util.js')).toBe('mine')
    // and even a node_modules symlink made some other way isn't scanned for pruning
    vfs.rm('/p/node_modules/evil/node_modules', { recursive: true })
    vfs.symlink('../../../src', '/p/node_modules/evil/node_modules')
    expect([...listInstalled(vfs, '/p').keys()]).toEqual(['node_modules/evil'])
  })

  it('archive symlinks are checked where they really land (a link through an earlier `x -> .` link)', async () => {
    const evil = await gzip(
      tar([
        { path: 'package/package.json', data: JSON.stringify({ name: 'evil', version: '1.0.0' }) },
        { path: 'package/x', data: '', linkname: '.' },
        { path: 'package/x/x/node_modules', data: '', linkname: '../../src' }, // lexically in the package, really ../../src
        { path: 'package/y', data: '', linkname: '../..' },
      ]),
    )
    const nested = await gzip(tar([{ path: 'package/package.json', data: JSON.stringify({ name: 'src', version: '1.0.0' }) }, { path: 'package/index.js', data: 'pwned' }]))
    const reg: Registry = { packument: async () => { throw new Error('none') }, tarball: async (u) => (u.includes('evil') ? evil : nested) }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { dependencies: { evil: '1.0.0' } }, 'node_modules/evil': { version: '1.0.0', resolved: 'https://anywhere.test/evil.tgz', dependencies: { src: '1.0.0' } }, 'node_modules/evil/node_modules/src': { version: '1.0.0', resolved: 'https://anywhere.test/src.tgz' } },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'src/index.js': 'mine' })
    await install(vfs, reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/src/index.js')).toBe('mine')
    expect(vfs.readdir('/p/src')).toEqual(['index.js'])
  })

  it('nothing is written through an archive\'s own link to a deeper dir (lexical `..` resolution)', async () => {
    const evil = await gzip(
      tar([
        { path: 'package/package.json', data: JSON.stringify({ name: 'evil', version: '1.0.0' }) },
        { path: 'package/a/b/c/d/keep', data: '' },
        { path: 'package/sub', data: '', linkname: 'a/b/c/d' },
        { path: 'package/sub/link', data: '', linkname: '../../../src' },
        { path: 'package/sub/link/index.js', data: 'pwned' },
      ]),
    )
    const reg: Registry = { packument: async () => { throw new Error('none') }, tarball: async () => evil }
    const lock = { lockfileVersion: 3, packages: { '': { dependencies: { evil: '1.0.0' } }, 'node_modules/evil': { version: '1.0.0', resolved: 'https://anywhere.test/evil.tgz' } } }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'src/index.js': 'mine' })
    await install(vfs, reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/src/index.js')).toBe('mine')
  })

  it('an `npm:` alias of a workspace\'s package name is fetched from the registry', async () => {
    const vfs = project({ 'package.json': { workspaces: ['packages/*'], dependencies: { 'ui-compat': 'npm:@acme/ui@^1.0.0' } }, 'packages/ui/package.json': { name: '@acme/ui', version: '1.0.0' } })
    await install(vfs, registry({ '@acme/ui': { '1.0.0': {} } }).reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/node_modules/ui-compat/index.js')).toContain('@acme/ui@1.0.0')
    expect(vfs.readlink('/p/node_modules/@acme/ui')).toBe('../../packages/ui')
  })

  it('`npm install <pkg>` updates an optional dependency in place', async () => {
    const spec: Spec = { 'is-number': { '6.0.0': {}, '7.0.0': {} } }
    const vfs = project({ 'package.json': { optionalDependencies: { 'is-number': '^6.0.0' } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['is-number@7.0.0'], out: out() })
    expect(JSON.parse(vfs.readText('/p/package.json'))).toEqual({ optionalDependencies: { 'is-number': '7.0.0' } })
    expect(ver(vfs, 'node_modules/is-number')).toBe('7.0.0')
  })

  it('an optional dependency left out (no such version) does not make its own lockfile stale', async () => {
    const spec: Spec = { a: { '1.0.0': { optionalDependencies: { x: '1.0.0' } } }, x: { '2.0.0': {} } }
    const vfs = project({ 'package.json': { dependencies: { a: '^1.0.0', x: '^2.0.0' } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    const again = registry(spec)
    await install(vfs, again.reg, { cwd: '/p', ci: true, out: out() })
    expect(again.packuments).toEqual([])
  })

  it('an optional package whose required dependency failed to download goes too (no broken package or bin)', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { optionalDependencies: { plugin: '1.0.0' } },
        'node_modules/plugin': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'plugin', '1.0.0'), optional: true, dependencies: { helper: '1.0.0' }, bin: { plug: 'index.js' } },
        'node_modules/helper': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'helper', '1.0.0'), optional: true },
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    const r = await install(vfs, registry({ plugin: { '1.0.0': {} } }).reg, { cwd: '/p', ci: true, out: out() })
    expect(r.warnings).toContain('optional dependency plugin@1.0.0 removed: it needs helper, which failed')
    expect(vfs.exists('/p/node_modules/plugin')).toBe(false)
    expect(vfs.exists('/p/node_modules/.bin/plug')).toBe(false)
    expect(r.added).toBe(0)
  })

  it('peer-driven nesting keeps the version locked at the path it ends up at', async () => {
    const spec: Spec = { react: { '17.0.2': {}, '18.3.1': {} }, 'react-dom': { '18.2.0': { peerDependencies: { react: '^18.0.0' } }, '18.3.1': { peerDependencies: { react: '^18.0.0' } } }, d: { '1.0.0': {} } }
    const e = (n: string, v: string, extra = {}) => ({ version: v, resolved: tgzUrl(NPMJS, n, v), ...extra })
    const files = {
      'package.json': { workspaces: ['packages/*'], dependencies: { react: '^17.0.0' } },
      'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { react: '^18.0.0', 'react-dom': '^18.2.0' } },
      'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: { react: '^18.0.0', 'react-dom': '^18.2.0' } },
    }
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { workspaces: ['packages/*'], dependencies: { react: '^17.0.0' } },
        'node_modules/a': { resolved: 'packages/a', link: true },
        'node_modules/b': { resolved: 'packages/b', link: true },
        'node_modules/react': e('react', '17.0.2'),
        'packages/a': { name: 'a', version: '1.0.0', dependencies: files['packages/a/package.json'].dependencies },
        'packages/a/node_modules/react': e('react', '18.3.1'),
        'packages/a/node_modules/react-dom': e('react-dom', '18.2.0', { peerDependencies: { react: '^18.0.0' } }),
        'packages/b': { name: 'b', version: '1.0.0', dependencies: files['packages/b/package.json'].dependencies },
        'packages/b/node_modules/react': e('react', '18.3.1'),
        'packages/b/node_modules/react-dom': e('react-dom', '18.3.1', { peerDependencies: { react: '^18.0.0' } }),
      },
    }
    const vfs = project({ ...files, 'package-lock.json': lock })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'packages/a/node_modules/react-dom')).toBe('18.2.0')
    expect(ver(vfs, 'packages/b/node_modules/react-dom')).toBe('18.3.1')
  })

  it('a devOptional entry is required (dev deps are installed): a failed download fails the install', async () => {
    const lock = { lockfileVersion: 3, packages: { '': { devDependencies: { helper: '^1.0.0' } }, 'node_modules/helper': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'helper', '1.0.0'), devOptional: true } } }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    await expect(install(vfs, registry({}).reg, { cwd: '/p', out: out() })).rejects.toThrow(/404/)
  })

  it('only warns when an optional lockfile entry fails to download; skips devOptional platform packages', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '1.0.0' }, optionalDependencies: { gone: '^1.0.0', unlisted: '^1.0.0' }, devDependencies: { n: '1.0.0' } },
        'node_modules/a': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'a', '1.0.0') },
        'node_modules/gone': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'gone', '1.0.0'), optional: true, bin: { gone: 'cli.js' } },
        'node_modules/unlisted': { version: '1.0.0', optional: true }, // no `resolved` (omit-lockfile-registry-resolved) and no packument
        'node_modules/n': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'n', '1.0.0'), devOptional: true, cpu: ['arm64'] },
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    const { reg, tarballs } = registry({ a: { '1.0.0': {} } })
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(r.warnings).toEqual(['optional dependency unlisted@1.0.0 failed: 404 unlisted', `optional dependency gone@1.0.0 failed: 404 ${tgzUrl(NPMJS, 'gone', '1.0.0')}`])
    expect(tarballs.sort()).toEqual([tgzUrl(NPMJS, 'a', '1.0.0'), tgzUrl(NPMJS, 'gone', '1.0.0')])
    expect(vfs.exists('/p/node_modules/.bin/gone')).toBe(false) // no shim for what isn't there
    expect(r.added).toBe(1)
  })

  it('writes peers into the lockfile; a missing required peer (legacy-peer-deps lockfile) only warns', async () => {
    const spec: Spec = { plugin: { '1.0.0': { peerDependencies: { host: '^1.0.0', extra: '*' }, peerDependenciesMeta: { extra: { optional: true } } } }, host: { '1.0.0': {} } }
    const vfs = project({ 'package.json': { dependencies: { plugin: '^1.0.0' } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(lock.packages['node_modules/plugin']).toMatchObject({ peerDependencies: { host: '^1.0.0' }, peerDependenciesMeta: { extra: { optional: true } } })
    expect(lockOutOfSync(lock, { dependencies: { plugin: '^1.0.0' } }, [])).toBeNull()
    const { 'node_modules/host': _h, ...rest } = lock.packages
    expect(lockOutOfSync({ ...lock, packages: rest }, { dependencies: { plugin: '^1.0.0' } }, [])).toBeNull()
    const legacy = project({ 'package.json': { dependencies: { plugin: '^1.0.0' } }, 'package-lock.json': { ...lock, packages: rest } })
    const r = await install(legacy, registry(spec).reg, { cwd: '/p', ci: true, out: out() })
    expect(r.warnings).toEqual(['peer dependency host of plugin@1.0.0 is not in the lockfile'])
  })

  it('other platforms\' packages nest like any other: two versions, or a real package of the same name', async () => {
    // a optionally wants native@1 (darwin only), b needs native@2; tool@2 and wrap's tool@1 each want their own tool-linux
    const spec: Spec = {
      a: { '1.0.0': { optionalDependencies: { native: '1.0.0' } } },
      b: { '1.0.0': { dependencies: { native: '^2.0.0' } } },
      native: { '1.0.0': { os: ['darwin'] }, '2.0.0': {} },
      tool: { '1.0.0': { optionalDependencies: { 'tool-linux': '1.0.0' } }, '2.0.0': { optionalDependencies: { 'tool-linux': '2.0.0' } } },
      'tool-linux': { '1.0.0': { os: ['linux'] }, '2.0.0': { os: ['linux'] } },
      wrap: { '1.0.0': { dependencies: { tool: '^1.0.0' } } },
    }
    const pkg = { dependencies: { a: '^1.0.0', b: '^1.0.0', tool: '^2.0.0', wrap: '^1.0.0' } }
    const vfs = project({ 'package.json': pkg })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    const at = (k: string) => lock.packages[k] && `${lock.packages[k].version}${lock.packages[k].optional ? ' optional' : ''}`
    expect(at('node_modules/native')).toBe('1.0.0 optional')
    expect(at('node_modules/b/node_modules/native')).toBe('2.0.0')
    expect(at('node_modules/tool-linux')).toBe('2.0.0 optional')
    expect(at('node_modules/wrap/node_modules/tool/node_modules/tool-linux')).toBe('1.0.0 optional')
    expect(lockOutOfSync(lock, pkg, [])).toBeNull()
    const again = registry(spec)
    await install(vfs, again.reg, { cwd: '/p', ci: true, out: out() })
    expect(again.packuments).toEqual([])
    expect(vfs.exists('/p/node_modules/native')).toBe(false)
    expect(ver(vfs, 'node_modules/b/node_modules/native')).toBe('2.0.0')
  })

  it('`overrides` can pin a workspace\'s dependency outside its range (npm), not a root one', () => {
    const ws = [{ name: 'a', version: '1.0.0', path: 'packages/a', pkg: { name: 'a', version: '1.0.0', dependencies: { ms: '^1.0.0' } } }]
    const lock = {
      lockfileVersion: 3,
      packages: { '': { workspaces: ['packages/*'] }, 'node_modules/a': { resolved: 'packages/a', link: true }, 'node_modules/ms': { version: '2.1.3', resolved: tgzUrl(NPMJS, 'ms', '2.1.3') }, 'packages/a': { version: '1.0.0', dependencies: { ms: '^1.0.0' } } },
    }
    expect(lockOutOfSync(lock, { workspaces: ['packages/*'], overrides: { ms: '2.1.3' } }, ws)).toBeNull()
    expect(lockOutOfSync(lock, { workspaces: ['packages/*'] }, ws)).toMatch(/doesn't satisfy ms@\^1.0.0 \(required by packages\/a\)/)
  })

  it('rejects lockfile paths that would land outside node_modules', async () => {
    const P = LOCK.packages
    for (const k of ['node_modules/../src', 'node_modules/a/../../src', 'node_modules/@x/../../src', 'src/node_modules/x', 'node_modules//x', 'node_modules/@/x'])
      expect(lockOutOfSync({ ...LOCK, packages: { ...P, [k]: { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') } } }, PKG, [])).toBe(`invalid entry ${k}`)
    expect(lockOutOfSync({ ...LOCK, packages: { ...P, 'node_modules/l': { link: true, resolved: '../../etc' }, 'node_modules/l/node_modules/c': P['node_modules/c'] } }, PKG, [])).toBe(
      'invalid entry node_modules/l/node_modules/c (inside a link)',
    )
    // `npm install` then resolves instead, and nothing is written outside node_modules
    const vfs = project({ 'package.json': PKG, 'package-lock.json': { ...LOCK, packages: { ...P, 'node_modules/../src': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') } } }, 'src/keep.js': 'x' })
    await install(vfs, registry(SPEC).reg, { cwd: '/p', out: out() })
    expect(vfs.readdir('/p/src')).toEqual(['keep.js'])
  })

  it('npm-shrinkwrap.json wins over package-lock.json, and is the one rewritten', async () => {
    const stale = { ...LOCK, packages: { ...LOCK.packages, 'node_modules/a': { ...LOCK.packages['node_modules/a'], version: '9.0.0' } } }
    const vfs = project({ 'package.json': PKG, 'npm-shrinkwrap.json': LOCK, 'package-lock.json': stale })
    await install(vfs, registry(SPEC).reg, { cwd: '/p', ci: true, out: out() })
    expect(ver(vfs, 'node_modules/a')).toBe('1.0.0')
    await install(vfs, registry({ ...SPEC, d: { '1.0.0': {} } }).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(JSON.parse(vfs.readText('/p/npm-shrinkwrap.json')).packages['node_modules/d']).toBeTruthy()
    expect(vfs.readText('/p/package-lock.json')).toBe(json(stale))
  })

  it('replaces a package whose name changed at the same version (alias switch)', async () => {
    const spec: Spec = { 'pkg-a': { '1.0.0': {} }, 'pkg-b': { '1.0.0': {} } }
    const vfs = project({ 'package.json': { dependencies: { tool: 'npm:pkg-a@1.0.0' } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/node_modules/tool/index.js')).toContain('pkg-a@1.0.0')
    vfs.writeFile('/p/package.json', json({ dependencies: { tool: 'npm:pkg-b@1.0.0' } }))
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(vfs.readText('/p/node_modules/tool/index.js')).toContain('pkg-b@1.0.0')
  })

  it('keeps each locked placement when resolving after an unrelated change', async () => {
    // a uses the hoisted c@1.0.0 (^1.0.0), b its own c@1.2.0 (^1.1.0): adding d must not merge them into c@1.2.0
    const spec: Spec = { a: { '1.0.0': { dependencies: { c: '^1.0.0' } } }, b: { '1.0.0': { dependencies: { c: '^1.1.0' } } }, c: { '1.0.0': {}, '1.2.0': {} }, d: { '1.0.0': {} } }
    const e = (n: string, v: string, deps?: Record<string, string>) => ({ version: v, resolved: tgzUrl(NPMJS, n, v), ...(deps ? { dependencies: deps } : {}) })
    const lock = {
      lockfileVersion: 3,
      packages: { '': { dependencies: { a: '^1.0.0', b: '^1.0.0' } }, 'node_modules/a': e('a', '1.0.0', { c: '^1.0.0' }), 'node_modules/b': e('b', '1.0.0', { c: '^1.1.0' }), 'node_modules/b/node_modules/c': e('c', '1.2.0'), 'node_modules/c': e('c', '1.0.0') },
    }
    const vfs = project({ 'package.json': { dependencies: { a: '^1.0.0', b: '^1.0.0' } }, 'package-lock.json': lock })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'node_modules/c')).toBe('1.0.0')
    expect(ver(vfs, 'node_modules/b/node_modules/c')).toBe('1.2.0')
  })

  it('skips bundled, optional platform-specific and non-registry entries; fills missing resolved from the packument', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '1.0.0', g: 'github:u/g' }, optionalDependencies: { native: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0' },
        'node_modules/a/node_modules/inner': { version: '1.0.0', inBundle: true },
        'node_modules/native': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'native', '1.0.0'), optional: true, os: ['darwin'], cpu: ['arm64'] },
        'node_modules/g': { version: '0.0.1', resolved: 'git+ssh://git@github.com/u/g.git#abc' },
        'node_modules/c': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') },
      },
    }
    const vfs = project({ 'package.json': { dependencies: { a: '1.0.0', g: 'github:u/g' }, optionalDependencies: { native: '^1.0.0' } }, 'package-lock.json': lock })
    const { reg, packuments, tarballs } = registry({ a: { '1.0.0': {} }, c: { '1.0.0': {} } })
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(packuments).toEqual(['a'])
    expect(tarballs.sort()).toEqual([tgzUrl(NPMJS, 'a', '1.0.0'), tgzUrl(NPMJS, 'c', '1.0.0')])
    expect(r.warnings).toEqual(['skipping non-registry dependency g@git+ssh://git@github.com/u/g.git#abc'])
    // a bundled dep (shipped inside its parent's tarball) survives the next install
    vfs.writeFile('/p/node_modules/a/node_modules/inner/package.json', json({ name: 'inner', version: '1.0.0' }), { mkdirp: true })
    await install(vfs, reg, { cwd: '/p', out: out() })
    expect(vfs.exists('/p/node_modules/a/node_modules/inner/package.json')).toBe(true)
  })

  it('needs no lockfile entry for a non-registry dependency', () => {
    const pkg = { dependencies: { ...PKG.dependencies, g: 'github:u/g' } }
    expect(lockOutOfSync({ ...LOCK, packages: { ...LOCK.packages, '': { dependencies: pkg.dependencies } } }, pkg, [])).toBeNull()
  })

  it('fetches lockfile tarballs from the configured registry instead of registry.npmjs.org', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK })
    const { reg, tarballs } = registry(SPEC, { base: 'https://mirror.test/npm' })
    await install(vfs, reg, { cwd: '/p', out: out() })
    expect(tarballs.every((t) => t.startsWith('https://mirror.test/npm/'))).toBe(true)
  })
})

/** What `npm install --package-lock-only` (npm 11) writes for WS_FILES with WS_SPEC (license/engines trimmed). */
const NPM_WS_LOCK = {
  name: 'root',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { ms: '^2.0.0' } },
    'node_modules/a': { resolved: 'packages/a', link: true },
    'node_modules/b': { resolved: 'packages/b', link: true },
    'node_modules/is-number': { version: '7.0.0', resolved: tgzUrl(NPMJS, 'is-number', '7.0.0'), integrity: 'sha512-x' },
    'node_modules/ms': { version: '2.1.3', resolved: tgzUrl(NPMJS, 'ms', '2.1.3'), integrity: 'sha512-y' },
    'packages/a': { version: '1.0.0', dependencies: { b: '*', ms: '^1.0.0' } },
    'packages/a/node_modules/ms': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'ms', '1.0.0'), integrity: 'sha512-z' },
    'packages/b': { version: '2.0.0', dependencies: { 'is-number': '^7.0.0' }, bin: { bee: 'cli.js' } },
  },
}
const WS_SPEC: Spec = { ms: { '1.0.0': {}, '2.1.3': {} }, 'is-number': { '7.0.0': {} } }
const WS_FILES = {
  'package.json': { name: 'root', version: '1.0.0', private: true, workspaces: ['packages/*'], dependencies: { ms: '^2.0.0' } },
  'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { ms: '^1.0.0', b: '*' } },
  'packages/b/package.json': { name: 'b', version: '2.0.0', bin: { bee: 'cli.js' }, dependencies: { 'is-number': '^7.0.0' } },
  'packages/b/cli.js': 'console.log("bee")',
  'packages/notes/README.md': 'not a package',
}

function expectWsLayout(vfs: VFS) {
  expect(vfs.readlink('/p/node_modules/a')).toBe('../packages/a')
  expect(vfs.readlink('/p/node_modules/b')).toBe('../packages/b')
  expect(ver(vfs, 'node_modules/ms')).toBe('2.1.3')
  expect(ver(vfs, 'node_modules/is-number')).toBe('7.0.0')
  expect(ver(vfs, 'packages/a/node_modules/ms')).toBe('1.0.0')
  // a resolves b through the root link, and its own ms first
  expect(vfs.readText('/p/node_modules/a/node_modules/ms/index.js')).toContain('ms@1.0.0')
  expect(vfs.readText('/p/node_modules/.bin/bee')).toContain('require("../../packages/b/cli.js")') // the real path, so its relative requires work
}

describe('workspaces', () => {
  it('finds workspace packages from globs (array or { packages }), honouring negations', () => {
    const vfs = project({ ...WS_FILES, 'packages/c/package.json': { name: '@s/c' }, 'tools/x/package.json': { name: 'x', version: '0.1.0' } })
    expect(findWorkspaces(vfs, '/p', { workspaces: ['packages/*', '!packages/c'] }).map((w) => w.path)).toEqual(['packages/a', 'packages/b'])
    expect(findWorkspaces(vfs, '/p', { workspaces: { packages: ['./tools/x', 'packages/c/'] } }).map((w) => [w.name, w.version])).toEqual([
      ['@s/c', '0.0.0'],
      ['x', '0.1.0'],
    ])
    expect(findWorkspaces(vfs, '/p', { workspaces: ['packages/*', '!packages/[ab]', 'packages/b'] }).map((w) => w.path)).toEqual(['packages/b', 'packages/c']) // the last match decides
    expect(findWorkspaces(project({ 'apps/a/package.json': { name: 'aa' }, 'packages/b/package.json': { name: 'bb' } }), '/p', { workspaces: ['{apps/*,packages/*}'] }).map((w) => w.path)).toEqual(['apps/a', 'packages/b'])
    // only where a pattern can match: not into src/, nor below packages/<x>
    const deep = project({ ...WS_FILES, 'src/a/b/package.json': {}, 'packages/a/lib/x/package.json': {} })
    const read = vi.spyOn(deep, 'readdirEntries')
    expect(findWorkspaces(deep, '/p', { workspaces: ['packages/*'] }).map((w) => w.path)).toEqual(['packages/a', 'packages/b'])
    expect(read.mock.calls.map(([d]) => d)).toEqual(['/p', '/p/packages'])
    for (const name of ['../../evil', '@s/../../x', '.hidden', 'a/b'])
      expect(() => findWorkspaces(project({ 'packages/a/package.json': { name } }), '/p', { workspaces: ['packages/*'] })).toThrow(/invalid workspace name/)
    expect(() => findWorkspaces(project({ 'a/package.json': { name: 'z' }, 'b/package.json': { name: 'z' } }), '/p', { workspaces: ['*'] })).toThrow(/multiple workspaces with the same name: z/)
    expect(findWorkspaces(vfs, '/p', { workspaces: ['packages/{a,b'] })).toEqual([]) // an unclosed brace is literal (no hang)
  })

  it('installs from an npm-generated workspace lockfile', async () => {
    const vfs = project({ ...WS_FILES, 'package-lock.json': NPM_WS_LOCK })
    const { reg, packuments } = registry(WS_SPEC)
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(packuments).toEqual([])
    expect(r.added).toBe(3)
    expectWsLayout(vfs)
    expect(vfs.readText('/p/package-lock.json')).toBe(json(NPM_WS_LOCK))
  })

  it('resolves workspaces without a lockfile, writing one npm would read the same way', async () => {
    const vfs = project(WS_FILES)
    const { reg } = registry(WS_SPEC)
    await install(vfs, reg, { cwd: '/p', out: out() })
    expectWsLayout(vfs)
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(Object.keys(lock.packages)).toEqual(Object.keys(NPM_WS_LOCK.packages))
    expect(lock.packages['node_modules/a']).toEqual({ resolved: 'packages/a', link: true })
    expect(lock.packages['']).toEqual({ ...NPM_WS_LOCK.packages[''] })
    expect(lock.packages['packages/b']).toEqual({ name: 'b', ...NPM_WS_LOCK.packages['packages/b'] })
    // and installs from it next time
    const again = registry(WS_SPEC)
    expect((await install(vfs, again.reg, { cwd: '/p', ci: true, out: out() })).added).toBe(3)
    expect(again.packuments).toEqual([])
    expectWsLayout(vfs)
  })

  it('links `workspace:` specs, re-resolves when a workspace changes, and prunes without following links', async () => {
    const vfs = project({ ...WS_FILES, 'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { ms: '^1.0.0', b: 'workspace:*' } } })
    const { reg } = registry(WS_SPEC)
    await install(vfs, reg, { cwd: '/p', out: out() })
    expectWsLayout(vfs)
    // drop workspace b: its link goes, a's own node_modules (reached through the a link too) stays
    vfs.rm('/p/packages/b', { recursive: true })
    vfs.writeFile('/p/packages/a/package.json', json({ name: 'a', version: '1.0.0', dependencies: { ms: '^1.0.0' } }))
    const o = out()
    const r = await install(vfs, reg, { cwd: '/p', out: o })
    expect(o.text).toMatch(/out of date \(dependencies of packages\/a differ\)/)
    expect(vfs.exists('/p/node_modules/b')).toBe(false)
    expect(vfs.exists('/p/node_modules/is-number')).toBe(false)
    expect(r.removed).toBe(2)
    expect(ver(vfs, 'packages/a/node_modules/ms')).toBe('1.0.0')
    expect(vfs.readlink('/p/node_modules/a')).toBe('../packages/a')
  })

  it('keeps the workspace link when the root asks for another version of it, writing a lockfile `npm ci` accepts', async () => {
    const vfs = project({ ...WS_FILES, 'package.json': { ...WS_FILES['package.json'], dependencies: { ms: '^2.0.0', a: '^2.0.0' } } })
    const { reg } = registry({ ...WS_SPEC, a: { '2.0.0': {} } })
    const r = await install(vfs, reg, { cwd: '/p', out: out() })
    expect(r.warnings).toContain("a@^2.0.0 doesn't match workspace a@1.0.0; using the workspace")
    expect(vfs.readlink('/p/node_modules/a')).toBe('../packages/a')
    await install(vfs, reg, { cwd: '/p', ci: true, out: out() })
    expectWsLayout(vfs)
  })

  it('a workspace inside another resolves through the outer one first (install and lockfile check)', async () => {
    const files = {
      'package.json': { name: 'root', workspaces: ['packages/*', 'packages/a/child'], dependencies: { ms: '^2.0.0' } },
      'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { ms: '^1.0.0' } },
      'packages/a/child/package.json': { name: 'child', version: '1.0.0', dependencies: { ms: '^2.0.0' } },
    }
    const vfs = project(files)
    await install(vfs, registry(WS_SPEC).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'packages/a/node_modules/ms')).toBe('1.0.0')
    expect(ver(vfs, 'packages/a/child/node_modules/ms')).toBe('2.1.3') // not a's ms@1, which it would see first
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    const ws = findWorkspaces(vfs, '/p', files['package.json'])
    expect(lock.packages['packages/a/child']).toEqual({ name: 'child', version: '1.0.0', dependencies: { ms: '^2.0.0' } })
    expect(lockOutOfSync(lock, files['package.json'], ws)).toBeNull()
    // a workspace version bump makes it stale too
    const bumped = { ...files['packages/a/child/package.json'], version: '2.0.0' }
    expect(lockOutOfSync(lock, files['package.json'], ws.map((w) => (w.name === 'child' ? { ...w, version: '2.0.0', pkg: bumped } : w)))).toBe('version of packages/a/child differs')
    const { 'packages/a/child/node_modules/ms': _m, ...rest } = lock.packages
    expect(lockOutOfSync({ ...lock, packages: rest }, files['package.json'], ws)).toBe("packages/a/node_modules/ms (ms@1.0.0) doesn't satisfy ms@^2.0.0 (required by packages/a/child)")
  })

  it('an optionalDependencies entry wins over the same name in dependencies (as npm normalizes)', async () => {
    const pkg = { dependencies: { ms: '^1.0.0', 'is-number': '^7.0.0' }, optionalDependencies: { ms: '^2.0.0' } }
    const vfs = project({ 'package.json': pkg })
    await install(vfs, registry(WS_SPEC).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/ms')).toBe('2.1.3')
    const lock = JSON.parse(vfs.readText('/p/package-lock.json'))
    expect(lock.packages['']).toEqual({ dependencies: { 'is-number': '^7.0.0' }, optionalDependencies: { ms: '^2.0.0' } })
    expect(lockOutOfSync(lock, pkg, [])).toBeNull()
  })

  it('checks an optional entry a nested workspace reaches through its outer workspace', () => {
    const pkg = { workspaces: ['packages/outer', 'packages/outer/inner'] }
    const ws = [
      { name: 'outer', version: '1.0.0', path: 'packages/outer', pkg: { name: 'outer', version: '1.0.0' } },
      { name: 'inner', version: '1.0.0', path: 'packages/outer/inner', pkg: { name: 'inner', version: '1.0.0', optionalDependencies: { n: '^1.0.0' } } },
    ]
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { workspaces: pkg.workspaces },
        'node_modules/inner': { resolved: 'packages/outer/inner', link: true },
        'node_modules/outer': { resolved: 'packages/outer', link: true },
        'packages/outer': { version: '1.0.0' },
        'packages/outer/inner': { version: '1.0.0', optionalDependencies: { n: '^1.0.0' } },
        'packages/outer/node_modules/n': { version: '1.0.0', optional: true, resolved: tgzUrl(NPMJS, 'n', '1.0.0'), dependencies: { m: '^1.0.0' } },
      },
    }
    expect(lockOutOfSync(lock, pkg, ws as never)).toBe('no entry for m (required by packages/outer/node_modules/n)')
    // and a `file:` key reads as one even in a workspaces project; a removed workspace's doesn't
    expect(lockOutOfSync({ ...lock, packages: { ...lock.packages, '../lib': { version: '1.0.0' } } }, pkg, ws as never)).toBe("../lib is not a workspace (file: dependencies aren't supported)")
    expect(lockOutOfSync({ ...lock, packages: { ...lock.packages, lib: { version: '1.0.0' } } }, pkg, ws as never)).toBe("lib is not a workspace (file: dependencies aren't supported)")
    expect(lockOutOfSync({ ...lock, packages: { ...lock.packages, 'packages/outer': undefined as never } }, { workspaces: ['packages/*', 'packages/outer/inner'] }, ws.slice(1) as never)).toBe('workspaces differ')
  })

  it('a `workspace:` dependency shadowed by an enclosing workspace\'s registry copy gets its own link', async () => {
    const files = {
      'package.json': { name: 'root', workspaces: ['packages/*', 'packages/outer/child'] },
      'packages/foo/package.json': { name: 'foo', version: '1.0.0' },
      'packages/outer/package.json': { name: 'outer', version: '1.0.0', dependencies: { foo: '^2.0.0' } },
      'packages/outer/child/package.json': { name: 'child', version: '1.0.0', dependencies: { foo: 'workspace:*' } },
    }
    const spec: Spec = { foo: { '2.0.0': {} } }
    const vfs = project(files)
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'packages/outer/node_modules/foo')).toBe('2.0.0')
    expect(vfs.readlink('/p/packages/outer/child/node_modules/foo')).toBe('../../../../packages/foo')
    expect(ver(vfs, 'packages/outer/child/node_modules/foo')).toBe('1.0.0')
    expect(JSON.parse(vfs.readText('/p/package-lock.json')).packages['packages/foo']).toEqual({ name: 'foo', version: '1.0.0' })
    await install(vfs, registry(spec).reg, { cwd: '/p', ci: true, out: out() })
    expect(ver(vfs, 'packages/outer/child/node_modules/foo')).toBe('1.0.0')
  })

  it('`npm install <workspace>` at the root links it without asking the registry (it may be unpublished)', async () => {
    const vfs = project(WS_FILES)
    const { reg, packuments } = registry(WS_SPEC)
    await install(vfs, reg, { cwd: '/p', add: ['b'], out: out() })
    expect(JSON.parse(vfs.readText('/p/package.json')).dependencies).toEqual({ b: '^2.0.0', ms: '^2.0.0' })
    expect(packuments).not.toContain('b')
    expect(vfs.readlink('/p/node_modules/b')).toBe('../packages/b')
  })

  it('a package isn\'t hoisted beside a peer it can\'t use (two React majors across workspaces)', async () => {
    const spec: Spec = { react: { '17.0.2': {}, '18.2.0': {} }, 'react-dom': { '18.2.0': { peerDependencies: { react: '^18.2.0' } } } }
    const files = {
      'package.json': { workspaces: ['packages/*'] },
      'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { react: '^17.0.0' } },
      'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } },
    }
    const vfs = project(files)
    const r = await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(r.warnings).toEqual([])
    expect(ver(vfs, 'node_modules/react')).toBe('17.0.2')
    expect(ver(vfs, 'packages/b/node_modules/react')).toBe('18.2.0')
    expect(ver(vfs, 'packages/b/node_modules/react-dom')).toBe('18.2.0')
    expect(vfs.exists('/p/node_modules/react-dom')).toBe(false)
    await install(vfs, registry(spec).reg, { cwd: '/p', ci: true, out: out() })
    expect(ver(vfs, 'packages/b/node_modules/react-dom')).toBe('18.2.0')
  })

  it('a library whose peer range takes both React majors stays with a workspace that has its own React', async () => {
    // root react@18, workspace app react@19 + ui (peer react ^18 || ^19): hoisted, ui would load the root's react@18
    const spec: Spec = { react: { '18.3.1': {}, '19.0.0': {} }, ui: { '1.0.0': { peerDependencies: { react: '^18 || ^19' } } } }
    const files = { 'package.json': { workspaces: ['packages/*'], dependencies: { react: '^18.0.0' } }, 'packages/app/package.json': { name: 'app', version: '1.0.0', dependencies: { ui: '^1.0.0', react: '^19.0.0' } } }
    const vfs = project(files)
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'packages/app/node_modules/react')).toBe('19.0.0')
    expect(ver(vfs, 'packages/app/node_modules/ui')).toBe('1.0.0') // `ui` comes before `react`, but is placed after it
    expect(vfs.exists('/p/node_modules/ui')).toBe(false)
  })

  it('a plugin stays beside the registry copy of its peer its requester has, not a root workspace link', async () => {
    const spec: Spec = { '@acme/ui': { '1.0.0': {} }, plugin: { '1.0.0': { peerDependencies: { '@acme/ui': '^1.0.0' } } } }
    const files = {
      'package.json': { workspaces: ['packages/*'] },
      'packages/ui/package.json': { name: '@acme/ui', version: '2.0.0' },
      'packages/app/package.json': { name: 'app', version: '1.0.0', dependencies: { '@acme/ui': '^1.0.0', plugin: '^1.0.0' } },
    }
    const vfs = project(files)
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'packages/app/node_modules/@acme/ui')).toBe('1.0.0')
    expect(ver(vfs, 'packages/app/node_modules/plugin')).toBe('1.0.0')
    expect(vfs.exists('/p/node_modules/plugin')).toBe(false)
  })

  it('with no better copy of the peer in reach, a package still hoists once (no duplicate singletons)', async () => {
    const spec: Spec = { react: { '19.0.0': {} }, 'react-redux': { '7.2.9': { peerDependencies: { react: '^16.8 || ^17 || ^18' } } }, lib: { '1.0.0': { dependencies: { 'react-redux': '^7.0.0' } } }, lib2: { '1.0.0': { dependencies: { 'react-redux': '^7.0.0' } } } }
    const vfs = project({ 'package.json': { dependencies: { react: '^19.0.0', lib: '^1.0.0', lib2: '^1.0.0' } } })
    const r = await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect([...listInstalled(vfs, '/p').keys()].sort()).toEqual(['node_modules/lib', 'node_modules/lib2', 'node_modules/react', 'node_modules/react-redux'])
    expect(r.warnings).toEqual(['peer dependency react@^16.8 || ^17 || ^18 (required by react-redux) conflicts with installed 19.0.0'])
  })

  it('warns when run inside a workspace instead of at its root', async () => {
    const vfs = project(WS_FILES)
    const r = await install(vfs, registry(WS_SPEC).reg, { cwd: '/p/packages/b', out: out() })
    expect(r.warnings).toContain('/p/packages/b is a workspace of /p: run npm install there (this installs it on its own, without a lockfile)')
    expect(vfs.exists('/p/packages/b/package-lock.json')).toBe(false)
    expect((await install(vfs, registry(WS_SPEC).reg, { cwd: '/p', out: out() })).warnings).toEqual([])
  })

  it('writes no version for a workspace without one (as npm)', async () => {
    const vfs = project({ 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': { name: 'a' } })
    await install(vfs, registry({}).reg, { cwd: '/p', out: out() })
    expect(JSON.parse(vfs.readText('/p/package-lock.json')).packages['packages/a']).toEqual({ name: 'a' })
  })

  it('a locked version stays when its spec is a dist-tag, through an unrelated change', async () => {
    const spec: Spec = { c: { '1.0.0': {}, '2.0.0': {} }, d: { '1.0.0': {} } }
    const vfs = project({ 'package.json': { dependencies: { c: 'latest' } }, 'package-lock.json': { lockfileVersion: 3, packages: { '': { dependencies: { c: 'latest' } }, 'node_modules/c': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') } } } })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'node_modules/c')).toBe('1.0.0')
  })

  it('a workspace\'s dependency switched to another dist-tag resolves fresh, hoisted or not', async () => {
    const spec: Spec = { c: { '1.0.0': {}, '2.0.0-beta.1': {} } }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { workspaces: ['packages/*'] }, 'node_modules/a': { resolved: 'packages/a', link: true }, 'node_modules/c': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') }, 'packages/a': { name: 'a', version: '1.0.0', dependencies: { c: 'latest' } } },
    }
    const vfs = project({ 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { c: 'next' } }, 'package-lock.json': lock })
    await install(vfs, registry(spec, { latest: { c: '1.0.0' }, tags: { c: { next: '2.0.0-beta.1' } } }).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/c')).toBe('2.0.0-beta.1')
  })

  it('adding a newer version at the root keeps a workspace\'s own pin of the same package', async () => {
    const spec: Spec = { ts: { '5.5.2': {}, '5.5.4': {}, '5.6.2': {}, '5.6.3': {} } }
    const e = (v: string) => ({ version: v, resolved: tgzUrl(NPMJS, 'ts', v) })
    const files = { 'package.json': { workspaces: ['packages/*'], devDependencies: { ts: '^5.6.0' } }, 'packages/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { ts: '~5.5.0' } } }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { workspaces: ['packages/*'], devDependencies: { ts: '^5.6.0' } }, 'node_modules/a': { resolved: 'packages/a', link: true }, 'node_modules/ts': e('5.6.2'), 'packages/a': { name: 'a', version: '1.0.0', devDependencies: { ts: '~5.5.0' } }, 'packages/a/node_modules/ts': e('5.5.2') },
    }
    const vfs = project({ ...files, 'package-lock.json': lock })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['ts@5.6.3'], dev: true, out: out() })
    expect(ver(vfs, 'node_modules/ts')).toBe('5.6.3')
    expect(ver(vfs, 'packages/a/node_modules/ts')).toBe('5.5.2')
  })

  it('a removed optional branch takes the optional packages only it needed, not shared ones', async () => {
    const e = (n: string, extra = {}) => ({ version: '1.0.0', resolved: tgzUrl(NPMJS, n, '1.0.0'), optional: true, ...extra })
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { optionalDependencies: { plugin: '1.0.0', other: '1.0.0' } },
        'node_modules/plugin': e('plugin', { dependencies: { helper: '1.0.0', cli: '1.0.0', shared: '1.0.0' } }),
        'node_modules/helper': e('helper'),
        'node_modules/cli': e('cli', { bin: { cli: 'index.js' } }),
        'node_modules/shared': e('shared'),
        'node_modules/other': e('other', { dependencies: { shared: '1.0.0' } }),
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    const spec: Spec = { plugin: { '1.0.0': {} }, cli: { '1.0.0': {} }, shared: { '1.0.0': {} }, other: { '1.0.0': {} } } // helper: 404
    await install(vfs, registry(spec).reg, { cwd: '/p', ci: true, out: out() })
    expect([...listInstalled(vfs, '/p').keys()].sort()).toEqual(['node_modules/other', 'node_modules/shared'])
    expect(vfs.exists('/p/node_modules/.bin/cli')).toBe(false)
  })

  it('an optional plugin whose required peer failed to download goes too; an optional peer\'s failure keeps it', async () => {
    const e = (n: string, extra = {}) => ({ version: '1.0.0', resolved: tgzUrl(NPMJS, n, '1.0.0'), optional: true, ...extra })
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { optionalDependencies: { plugin: '1.0.0', soft: '1.0.0' } },
        'node_modules/plugin': e('plugin', { peerDependencies: { core: '^1.0.0' }, bin: { plug: 'index.js' } }),
        'node_modules/soft': e('soft', { peerDependencies: { core: '^1.0.0' }, peerDependenciesMeta: { core: { optional: true } } }),
        'node_modules/core': e('core'),
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    await install(vfs, registry({ plugin: { '1.0.0': {} }, soft: { '1.0.0': {} } }).reg, { cwd: '/p', ci: true, out: out() }) // core: 404
    expect([...listInstalled(vfs, '/p').keys()]).toEqual(['node_modules/soft'])
    expect(vfs.exists('/p/node_modules/.bin/plug')).toBe(false)
  })

  it('a failed `npm install <pkg>` leaves package.json as it was', async () => {
    const vfs = project({ 'package.json': PKG, 'package-lock.json': LOCK })
    await expect(install(vfs, registry({ ...SPEC, d: { '1.0.0': { dependencies: { gone: '^1.0.0' } } } }).reg, { cwd: '/p', add: ['d'], out: out() })).rejects.toThrow(/404 gone/)
    expect(JSON.parse(vfs.readText('/p/package.json'))).toEqual(PKG)
  })

  it('an optional peer of an optional plugin stays when an unrelated optional package fails', async () => {
    const e = (n: string, extra = {}) => ({ version: '1.0.0', resolved: tgzUrl(NPMJS, n, '1.0.0'), optional: true, ...extra })
    const lock = { lockfileVersion: 3, packages: { '': { optionalDependencies: { plugin: '1.0.0', broken: '1.0.0' } }, 'node_modules/plugin': e('plugin', { peerDependencies: { core: '^1.0.0' } }), 'node_modules/core': e('core'), 'node_modules/broken': e('broken') } }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    await install(vfs, registry({ plugin: { '1.0.0': {} }, core: { '1.0.0': {} } }).reg, { cwd: '/p', ci: true, out: out() })
    expect([...listInstalled(vfs, '/p').keys()].sort()).toEqual(['node_modules/core', 'node_modules/plugin'])
  })

  it('an installed optional package needs no packument: a failed lookup (offline) keeps it and what needs it', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { optionalDependencies: { plugin: '1.0.0' } },
        'node_modules/plugin': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'plugin', '1.0.0'), optional: true, dependencies: { helper: '1.0.0' } },
        'node_modules/helper': { version: '1.0.0', optional: true, bin: { help: 'index.js' } },
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'node_modules/helper/package.json': { name: 'helper', version: '1.0.0' }, 'node_modules/helper/index.js': '' })
    const r = await install(vfs, registry({ plugin: { '1.0.0': {} } }).reg, { cwd: '/p', out: out() })
    expect(vfs.exists('/p/node_modules/plugin/package.json')).toBe(true)
    expect(vfs.exists('/p/node_modules/.bin/help')).toBe(true)
    expect(r.warnings).toEqual(['optional dependency helper@1.0.0 failed: 404 helper'])
  })

  it('an optional package whose required child\'s packument is missing goes too', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { optionalDependencies: { plugin: '1.0.0' } },
        'node_modules/plugin': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'plugin', '1.0.0'), optional: true, dependencies: { helper: '1.0.0' }, bin: { plug: 'index.js' } },
        'node_modules/helper': { version: '1.0.0', optional: true }, // no `resolved`, and the registry has no helper
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock })
    const r = await install(vfs, registry({ plugin: { '1.0.0': {} } }).reg, { cwd: '/p', ci: true, out: out() })
    expect(r.warnings).toContain('optional dependency plugin@1.0.0 removed: it needs helper, which failed')
    expect(vfs.exists('/p/node_modules/.bin/plug')).toBe(false)
  })

  it('an unrelated edit keeps a workspace\'s own locked copy even when the hoisted one fits its range too', async () => {
    const spec: Spec = { ts: { '5.5.2': {}, '5.6.3': {} }, d: { '1.0.0': {} } }
    const e = (v: string) => ({ version: v, resolved: tgzUrl(NPMJS, 'ts', v) })
    const files = { 'package.json': { workspaces: ['packages/*'], devDependencies: { ts: '^5.6.0' } }, 'packages/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { ts: '^5.5.0' } } }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { workspaces: ['packages/*'], devDependencies: { ts: '^5.6.0' } }, 'node_modules/a': { resolved: 'packages/a', link: true }, 'node_modules/ts': e('5.6.3'), 'packages/a': { name: 'a', version: '1.0.0', devDependencies: { ts: '^5.5.0' } }, 'packages/a/node_modules/ts': e('5.5.2') },
    }
    const vfs = project({ ...files, 'package-lock.json': lock })
    await install(vfs, registry(spec).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'packages/a/node_modules/ts')).toBe('5.5.2')
    expect(JSON.parse(vfs.readText('/p/package-lock.json')).packages['packages/a/node_modules/ts'].version).toBe('5.5.2')
  })

  it('workspaces asking for the same dist-tag share one copy (fresh, and with an older locked one)', async () => {
    const spec: Spec = { react: { '18.3.1': {}, '19.0.0': {} } }
    const files = { 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { react: 'latest' } }, 'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: { react: 'latest' } } }
    const fresh = project(files)
    await install(fresh, registry(spec).reg, { cwd: '/p', out: out() })
    expect([...listInstalled(fresh, '/p', ['', 'packages/a', 'packages/b']).keys()].filter((k) => k.endsWith('/react'))).toEqual(['node_modules/react'])
    // locked at 18.3.1 (latest back then), re-resolved after an unrelated edit: still one copy, the locked one
    const vfs = project({ ...files, 'package-lock.json': { ...JSON.parse(fresh.readText('/p/package-lock.json')), packages: { ...JSON.parse(fresh.readText('/p/package-lock.json')).packages, 'node_modules/react': { version: '18.3.1', resolved: tgzUrl(NPMJS, 'react', '18.3.1') } } } })
    await install(vfs, registry({ ...spec, d: { '1.0.0': {} } }).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'node_modules/react')).toBe('18.3.1')
    expect(vfs.exists('/p/packages/a/node_modules/react')).toBe(false)
    expect(vfs.exists('/p/packages/b/node_modules/react')).toBe(false)
  })

  it('a workspace edge switched to `latest` doesn\'t dedupe onto an older locked copy', async () => {
    const spec: Spec = { react: { '17.0.2': {}, '19.0.0': {} } }
    const lock = {
      lockfileVersion: 3,
      packages: { '': { workspaces: ['packages/*'], dependencies: { react: '^17.0.0' } }, 'node_modules/b': { resolved: 'packages/b', link: true }, 'node_modules/react': { version: '17.0.2', resolved: tgzUrl(NPMJS, 'react', '17.0.2') }, 'packages/b': { name: 'b', version: '1.0.0', dependencies: { react: '^17.0.0' } } },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'packages/b/package.json': { name: 'b', version: '1.0.0', dependencies: { react: 'latest' } }, 'package-lock.json': lock })
    await install(vfs, registry(spec).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/react')).toBe('17.0.2')
    expect(ver(vfs, 'packages/b/node_modules/react')).toBe('19.0.0')
  })

  it('a workspace\'s own nested pin survives an unrelated edit even with nothing at the root yet', async () => {
    const spec: Spec = { react: { '18.3.1': {}, '19.0.0-beta.1': {} }, d: { '1.0.0': {} } }
    const e = (v: string) => ({ version: v, resolved: tgzUrl(NPMJS, 'react', v) })
    const ws = (n: string, r: string) => ({ name: n, version: '1.0.0', dependencies: { react: r } })
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { workspaces: ['packages/*'] },
        'node_modules/a': { resolved: 'packages/a', link: true },
        'node_modules/b': { resolved: 'packages/b', link: true },
        'node_modules/react': e('18.3.1'),
        'packages/a': ws('a', 'next'),
        'packages/a/node_modules/react': e('19.0.0-beta.1'),
        'packages/b': ws('b', '^18.0.0'),
      },
    }
    const vfs = project({ 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': ws('a', 'next'), 'packages/b/package.json': ws('b', '^18.0.0'), 'package-lock.json': lock })
    await install(vfs, registry(spec, { latest: { react: '18.3.1' }, tags: { react: { next: '19.0.0-beta.1' } } }).reg, { cwd: '/p', add: ['d'], out: out() })
    expect(ver(vfs, 'packages/a/node_modules/react')).toBe('19.0.0-beta.1')
    expect(ver(vfs, 'node_modules/react')).toBe('18.3.1')
  })

  it('a workspace link is never made through a symlinked nested node_modules', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { workspaces: ['packages/*'], dependencies: { x: '1.0.0' } },
        'node_modules/w': { resolved: 'packages/w', link: true },
        'node_modules/x': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'x', '1.0.0'), dependencies: { w: 'workspace:*' } },
        'node_modules/x/node_modules/w': { resolved: 'packages/w', link: true },
        'packages/w': { name: 'w', version: '1.0.0' },
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'packages/w/package.json': { name: 'w', version: '1.0.0' }, 'package-lock.json': lock, 'node_modules/x/package.json': { name: 'x', version: '1.0.0' }, 'shared/keep': 'x' })
    vfs.symlink('../../shared', '/p/node_modules/x/node_modules')
    const r = await install(vfs, registry({ x: { '1.0.0': {} } }).reg, { cwd: '/p', out: out() })
    expect(vfs.readdir('/p/shared')).toEqual(['keep'])
    expect(r.warnings).toContain('skipping link node_modules/x/node_modules/w: it goes through a symlink')
  })

  it('a placement whose nested node_modules is a symlink is never reused or removed', async () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { a: '1.0.0' } },
        'node_modules/a': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'a', '1.0.0'), dependencies: { opt: '1.0.0' }, optionalDependencies: { opt: '1.0.0' } },
        'node_modules/a/node_modules/opt': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'opt', '1.0.0'), optional: true, dependencies: { helper: '1.0.0' } },
        'node_modules/a/node_modules/helper': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'helper', '1.0.0'), optional: true },
      },
    }
    const vfs = project({ 'package.json': lock.packages[''], 'package-lock.json': lock, 'node_modules/a/package.json': { name: 'a', version: '1.0.0' }, 'shared/opt/package.json': { name: 'opt', version: '1.0.0' } })
    vfs.symlink('../../shared', '/p/node_modules/a/node_modules')
    await install(vfs, registry({ a: { '1.0.0': {} }, opt: { '1.0.0': {} } }).reg, { cwd: '/p', out: out() }) // helper: 404
    expect(vfs.readText('/p/shared/opt/package.json')).toContain('"opt"')
  })

  it('a direct dependency switched to another dist-tag is resolved fresh', async () => {
    const spec: Spec = { c: { '1.0.0': {}, '2.0.0-beta.1': {} } }
    const lock = { lockfileVersion: 3, packages: { '': { dependencies: { c: 'latest' } }, 'node_modules/c': { version: '1.0.0', resolved: tgzUrl(NPMJS, 'c', '1.0.0') } } }
    const vfs = project({ 'package.json': { dependencies: { c: 'next' } }, 'package-lock.json': lock })
    await install(vfs, registry(spec, { latest: { c: '1.0.0' }, tags: { c: { next: '2.0.0-beta.1' } } }).reg, { cwd: '/p', out: out() })
    expect(ver(vfs, 'node_modules/c')).toBe('2.0.0-beta.1')
  })

  it('reads an npm-generated lockfile for a character-class workspace glob (`packages/[ab]`)', async () => {
    // npm 11 writes these keys for it, leaving packages/c out
    const lock = { lockfileVersion: 3, packages: { '': { name: 'r', workspaces: ['packages/[ab]'] }, 'node_modules/a': { resolved: 'packages/a', link: true }, 'node_modules/b': { resolved: 'packages/b', link: true }, 'packages/a': { version: '1.0.0' }, 'packages/b': { version: '1.0.0' } } }
    const files = { 'package.json': { name: 'r', workspaces: ['packages/[ab]'] }, 'packages/a/package.json': { name: 'a', version: '1.0.0' }, 'packages/b/package.json': { name: 'b', version: '1.0.0' }, 'packages/c/package.json': { name: 'c', version: '1.0.0' }, 'package-lock.json': lock }
    const vfs = project(files)
    expect(findWorkspaces(vfs, '/p', files['package.json']).map((w) => w.path)).toEqual(['packages/a', 'packages/b'])
    expect(findWorkspaces(vfs, '/p', { workspaces: ['packages/[!a]'] }).map((w) => w.path)).toEqual(['packages/b', 'packages/c'])
    await install(vfs, registry({}).reg, { cwd: '/p', ci: true, out: out() })
    expect(vfs.readlink('/p/node_modules/b')).toBe('../packages/b')
    expect(vfs.exists('/p/node_modules/c')).toBe(false)
  })

  it('an optional edge to a workspace of another version is left out, and the lockfile stays valid', async () => {
    const vfs = project({ 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': { name: 'a', version: '1.0.0' }, 'packages/b/package.json': { name: 'b', version: '1.0.0', optionalDependencies: { a: '^2.0.0' } } })
    await install(vfs, registry({}).reg, { cwd: '/p', out: out() })
    await install(vfs, registry({}).reg, { cwd: '/p', ci: true, out: out() })
    expect(vfs.readlink('/p/node_modules/a')).toBe('../packages/a')
  })

  it('inside a workspace (installing it on its own), `workspace:` specs are skipped with a warning', async () => {
    const vfs = project({ ...WS_FILES, 'packages/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: 'workspace:*' } } })
    const r = await install(vfs, registry(WS_SPEC).reg, { cwd: '/p/packages/a', out: out() })
    expect(r.warnings).toContain('skipping non-registry dependency b@workspace:*')
  })

  it('fails clearly on a `workspace:` spec with no such workspace', async () => {
    const vfs = project({ 'package.json': { workspaces: ['packages/*'] }, 'packages/a/package.json': { name: 'a', dependencies: { nope: 'workspace:^' } } })
    await expect(install(vfs, registry({}).reg, { cwd: '/p', out: out() })).rejects.toThrow(/No workspace named nope/)
  })
})

describe('resolver: locked versions', () => {
  it('prefers a locked version that satisfies the range, else picks fresh', async () => {
    const { reg } = registry(SPEC)
    const locked = new Map([
      ['node_modules/a', { pkg: 'a', version: '1.0.0' }],
      ['node_modules/c', { pkg: 'c', version: '2.0.0' }],
    ])
    const r = await resolveTree([{ name: 'a', spec: '^1.0.0' }], reg, { locked })
    expect(r.placements.map((p) => `${p.path}@${p.version}`)).toEqual(['node_modules/a@1.0.0', 'node_modules/c@1.2.0'])
  })
})
