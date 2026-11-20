// Compression through the platform's CompressionStream / DecompressionStream. Shared by the node worker (`zlib`'s
// async calls and streams) and the host page (its sync calls, over the SAB RPC). Brotli isn't in every browser's
// CompressionStream (Chromium lacks it): the host falls back to WASM for it (./brotli.ts).

export type ZFormat = 'gzip' | 'deflate' | 'deflate-raw' | 'brotli'
export type ZMode = 'compress' | 'decompress'

const support = new Map<string, boolean>()

/** Whether this realm's Compression/DecompressionStream handles `format`. */
export function nativeCodec(format: ZFormat, mode: ZMode): boolean {
  const k = `${format}:${mode}`
  let ok = support.get(k)
  if (ok === undefined) {
    try {
      if (mode === 'compress') new CompressionStream(format as CompressionFormat)
      else new DecompressionStream(format as CompressionFormat)
      ok = true
    } catch {
      ok = false
    }
    support.set(k, ok)
  }
  return ok
}

export function codecStream(format: ZFormat, mode: ZMode): TransformStream<Uint8Array, Uint8Array> {
  return (mode === 'compress' ? new CompressionStream(format as CompressionFormat) : new DecompressionStream(format as CompressionFormat)) as unknown as TransformStream<Uint8Array, Uint8Array>
}

/** One-shot (de)compression with the native streams. Errors are zlib-style (see zlibError). */
export async function nativeOneShot(format: ZFormat, mode: ZMode, bytes: Uint8Array): Promise<Uint8Array> {
  try {
    // read it directly: wrapping it in a Response would replace the codec's error with a generic one
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(codecStream(format, mode)).getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    if (chunks.length === 1) return chunks[0]
    const out = new Uint8Array(size)
    let at = 0
    for (const c of chunks) out.set(c, at), (at += c.byteLength)
    return out
  } catch (e) {
    throw mode === 'decompress' ? zlibError(e, format) : e
  }
}

export interface ZlibError extends Error {
  code: string
  errno: number
}

/**
 * Map a failed decompression (native stream or WASM) to the error Node's zlib throws for bad input. The platform's
 * messages vary, so only "truncated input" vs "bad data" is kept; brotli reports Node's message with code Z_DATA_ERROR.
 */
export function zlibError(e: unknown, format: ZFormat): ZlibError {
  const msg = e instanceof Error ? e.message : String(e)
  const truncated = (e as { code?: unknown })?.code === 'Z_BUF_ERROR' /* Node's own streams */ || /truncat|incomplete|ended without|unexpected end/i.test(msg)
  const message = format === 'brotli' ? 'Decompression failed' : truncated ? 'unexpected end of file' : 'incorrect header check'
  return Object.assign(new Error(message), truncated && format !== 'brotli' ? { code: 'Z_BUF_ERROR', errno: -5 } : { code: 'Z_DATA_ERROR', errno: -3 })
}
