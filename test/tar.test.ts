import { describe, expect, it } from 'vitest'
import { gunzip, gzip, tar, untar } from '../src/npm/tar'

describe('tar', () => {
  it('round-trips a gzipped tarball and strips the package/ prefix', async () => {
    const tgz = await gzip(tar([{ path: 'package/package.json', data: '{"name":"x"}' }, { path: 'package/lib/index.js', data: 'module.exports = 1' }, { path: 'package/big.bin', data: new Uint8Array(1500).fill(7) }]))
    const entries = untar(await gunzip(tgz), 1)
    expect(entries.map((e) => e.path)).toEqual(['package.json', 'lib/index.js', 'big.bin'])
    expect(new TextDecoder().decode(entries[1].data)).toBe('module.exports = 1')
    expect(entries[2].data.length).toBe(1500)
  })

  it('honours pax path headers and skips traversal', () => {
    const enc = new TextEncoder()
    const long = 'package/' + 'd/'.repeat(60) + 'file.js'
    const rec = ` path=${long}\n`
    let len = rec.length + 2
    len = `${len}${rec}`.length
    const pax = tar([{ path: 'PaxHeader', data: `${len}${rec}` }])
    pax[156] = 'x'.charCodeAt(0)
    // recompute checksum for the modified header
    pax.fill(32, 148, 156)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += pax[i]
    pax.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    const body = tar([{ path: 'short', data: 'x' }, { path: 'package/../evil', data: 'no' }])
    const merged = new Uint8Array(pax.length - 1024 + body.length)
    merged.set(pax.subarray(0, pax.length - 1024))
    merged.set(body, pax.length - 1024)
    const entries = untar(merged, 1)
    expect(entries.map((e) => e.path)).toEqual([long.slice('package/'.length)])
  })
})
