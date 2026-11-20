// Minimal tar (ustar/pax/GNU longname) reader + gzip helper.

export interface TarEntry {
  path: string
  type: 'file' | 'dir' | 'symlink'
  data: Uint8Array
  linkname?: string
  mode: number
}

const dec = new TextDecoder()

function str(buf: Uint8Array, off: number, len: number): string {
  let end = off
  while (end < off + len && buf[end] !== 0) end++
  return dec.decode(buf.subarray(off, end))
}

function octal(buf: Uint8Array, off: number, len: number): number {
  // GNU base-256 for large sizes
  if (buf[off] & 0x80) {
    let v = 0
    for (let i = off + 1; i < off + len; i++) v = v * 256 + buf[i]
    return v
  }
  const s = str(buf, off, len).trim()
  return s ? parseInt(s, 8) : 0
}

function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {}
  const text = dec.decode(data)
  let i = 0
  while (i < text.length) {
    const sp = text.indexOf(' ', i)
    if (sp < 0) break
    const len = parseInt(text.slice(i, sp), 10)
    if (!(len > 0)) break // (a negative or NaN length would never advance)
    const rec = text.slice(sp + 1, i + len - 1)
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

/** Parse an uncompressed tar archive. `strip` removes leading path components. */
export function untar(buf: Uint8Array, strip = 0): TarEntry[] {
  const out: TarEntry[] = []
  let off = 0
  let paxPath: string | undefined
  let longName: string | undefined
  let globalPax: Record<string, string> = {}
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512)
    if (h.every((b) => b === 0)) break
    const size = octal(h, 124, 12)
    const flag = String.fromCharCode(h[156] || 48)
    const dataStart = off + 512
    // a corrupt size (negative, NaN, past the end) would loop forever or read garbage
    if (!Number.isSafeInteger(size) || size < 0 || dataStart + size > buf.length) throw new Error('invalid tar archive (bad entry size)')
    const data = buf.subarray(dataStart, dataStart + size)
    off = dataStart + Math.ceil(size / 512) * 512
    if (flag === 'x') {
      paxPath = parsePax(data).path
      continue
    }
    if (flag === 'g') {
      globalPax = { ...globalPax, ...parsePax(data) }
      continue
    }
    if (flag === 'L') {
      longName = str(data, 0, data.length)
      continue
    }
    let name = paxPath ?? longName ?? globalPax.path
    if (!name) {
      const prefix = str(h, 345, 155)
      name = str(h, 0, 100)
      if (prefix && dec.decode(h.subarray(257, 262)) === 'ustar') name = `${prefix}/${name}`
    }
    paxPath = longName = undefined
    const parts = name.split('/').filter((p) => p && p !== '.')
    if (parts.some((p) => p === '..')) continue
    const rel = parts.slice(strip).join('/')
    if (!rel) continue
    const mode = octal(h, 100, 8)
    if (flag === '0' || flag === '\0' || flag === '7') out.push({ path: rel, type: 'file', data, mode })
    else if (flag === '5') out.push({ path: rel, type: 'dir', data: new Uint8Array(0), mode })
    else if (flag === '2') out.push({ path: rel, type: 'symlink', data: new Uint8Array(0), linkname: str(h, 157, 100), mode })
    // hard links / devices ignored
  }
  return out
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Build a tar archive (used by tests and `npm pack`-style helpers). */
export function tar(files: { path: string; data: string | Uint8Array; linkname?: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const h = new Uint8Array(512)
    h.set(enc.encode(f.path.slice(0, 100)), 0)
    h.set(enc.encode('0000644\0'), 100)
    h.set(enc.encode('0000000\0'), 108)
    h.set(enc.encode('0000000\0'), 116)
    h.set(enc.encode(data.length.toString(8).padStart(11, '0') + '\0'), 124)
    h.set(enc.encode('00000000000\0'), 136)
    h.set(enc.encode('        '), 148)
    h[156] = f.linkname ? 50 : 48 // '2' symlink, '0' file
    if (f.linkname) h.set(enc.encode(f.linkname.slice(0, 100)), 157)
    h.set(enc.encode('ustar\0' + '00'), 257)
    let sum = 0
    for (const b of h) sum += b
    h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) (out.set(c, o), (o += c.length))
  return out
}
