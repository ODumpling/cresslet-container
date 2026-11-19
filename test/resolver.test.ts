import { describe, expect, it } from 'vitest'
import { parseSpec, pickVersion, resolveTree } from '../src/npm/resolver'
import type { Manifest, Packument, Registry } from '../src/npm/registry'

type Spec = Record<string, Record<string, Partial<Manifest>>>
function registry(spec: Spec, latest: Record<string, string> = {}): Registry & { fetched: string[] } {
  const fetched: string[] = []
  return {
    fetched,
    async packument(name) {
      fetched.push(name)
      const vs = spec[name]
      if (!vs) throw new Error(`404 ${name}`)
      const versions = Object.fromEntries(Object.entries(vs).map(([v, m]) => [v, { name, version: v, dist: { tarball: `t/${name}-${v}.tgz` }, ...m }]))
      return { name, 'dist-tags': { latest: latest[name] ?? Object.keys(vs).at(-1)! }, versions } as Packument
    },
    async tarball() {
      return new Uint8Array()
    },
  }
}

const paths = (r: Awaited<ReturnType<typeof resolveTree>>) => r.placements.map((p) => `${p.path}@${p.version}`)

describe('semver picking', () => {
  const p = { name: 'x', 'dist-tags': { latest: '1.2.0', next: '2.0.0-rc.1' }, versions: { '1.0.0': {}, '1.2.0': {}, '1.3.0': {}, '2.0.0-rc.1': {} } } as unknown as Packument
  it('prefers latest tag when it satisfies, else max satisfying', () => {
    expect(pickVersion(p, '^1.0.0')).toBe('1.2.0')
    expect(pickVersion(p, '>=1.3')).toBe('1.3.0')
    expect(pickVersion(p, 'next')).toBe('2.0.0-rc.1')
    expect(pickVersion(p, '*')).toBe('1.2.0')
    expect(pickVersion(p, '^3')).toBeNull()
  })
  it('classifies specs', () => {
    expect(parseSpec('a', '^1')).toEqual({ pkg: 'a', range: '^1' })
    expect(parseSpec('a', 'npm:b@^2')).toEqual({ pkg: 'b', range: '^2' })
    expect(parseSpec('a', 'github:u/r')).toHaveProperty('skip')
    expect(parseSpec('a', 'u/r#main')).toHaveProperty('skip')
    expect(parseSpec('a', 'file:../x')).toHaveProperty('skip')
    expect(parseSpec('a', 'https://x/y.tgz')).toHaveProperty('skip')
  })
})

describe('tree resolution + hoisting', () => {
  it('hoists shared deps and dedupes', async () => {
    const reg = registry({ a: { '1.0.0': { dependencies: { c: '^1.0.0' } } }, b: { '1.0.0': { dependencies: { c: '^1.1.0' } } }, c: { '1.0.0': {}, '1.1.0': {} } })
    const r = await resolveTree([{ name: 'a', spec: '^1' }, { name: 'b', spec: '^1' }], reg)
    expect(paths(r)).toEqual(['node_modules/a@1.0.0', 'node_modules/b@1.0.0', 'node_modules/c@1.1.0'])
  })

  it('nests on conflict', async () => {
    const reg = registry({ a: { '1.0.0': { dependencies: { c: '^2.0.0' } } }, c: { '1.0.0': {}, '2.0.0': {} } }, { c: '1.0.0' })
    const r = await resolveTree([{ name: 'a', spec: '^1' }, { name: 'c', spec: '^1' }], reg)
    expect(paths(r)).toEqual(['node_modules/a@1.0.0', 'node_modules/a/node_modules/c@2.0.0', 'node_modules/c@1.0.0'])
  })

  it('handles cycles, peers, optional and aliases', async () => {
    const reg = registry({
      a: { '1.0.0': { dependencies: { b: '^1' }, peerDependencies: { p: '^1' }, optionalDependencies: { native: '^1', gone: '^1' } } },
      b: { '1.0.0': { dependencies: { a: '^1' } } },
      p: { '1.5.0': {} },
      native: { '1.0.0': { os: ['darwin'] } },
      real: { '3.0.0': {} },
    })
    const r = await resolveTree([{ name: 'a', spec: '^1' }, { name: 'alias', spec: 'npm:real@^3' }, { name: 'gh', spec: 'github:x/y' }], reg)
    expect(paths(r)).toEqual(['node_modules/a@1.0.0', 'node_modules/alias@3.0.0', 'node_modules/b@1.0.0', 'node_modules/p@1.5.0'])
    expect(r.placements.find((p) => p.name === 'alias')!.pkg).toBe('real')
    expect(r.warnings.join('\n')).toMatch(/skipping non-registry dependency gh@github:x\/y/)
    expect(r.warnings.join('\n')).toMatch(/optional dependency gone failed/)
  })

  it('fails clearly on missing versions', async () => {
    const reg = registry({ a: { '1.0.0': {} } })
    await expect(resolveTree([{ name: 'a', spec: '^9' }], reg)).rejects.toThrow(/No matching version found for a@\^9/)
    await expect(resolveTree([{ name: 'zzz', spec: '^1' }], reg)).rejects.toThrow(/404 zzz/)
  })
})
