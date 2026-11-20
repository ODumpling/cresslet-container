// Host side of `zlib`: sync (de)compression for node workers (they block on the SAB RPC while this runs), plus their
// async brotli calls where the worker's CompressionStream lacks brotli. Native streams when the browser has the
// format, else brotli-wasm (fetched lazily, once per page, from `boot({ brotliWasmUrl })`).
import initBrotli, { compress as brCompress, decompress as brDecompress } from 'brotli-wasm-web'
import { nativeCodec, nativeOneShot, zlibError, type ZFormat, type ZMode } from './codec'

/** Keep in step with the exact `brotli-wasm` devDependency (its JS glue is bundled; this is its matching .wasm). */
export const BROTLI_WASM_VERSION = '3.0.1'
export const DEFAULT_BROTLI_WASM_URL = `https://cdn.jsdelivr.net/npm/brotli-wasm@${BROTLI_WASM_VERSION}/pkg.web/brotli_wasm_bg.wasm`

let ready: Promise<unknown> | null = null

/** Load the brotli WASM module (a URL, or the module's bytes). Retried on the next call after a failure. */
export function loadBrotli(source: string | URL | BufferSource = DEFAULT_BROTLI_WASM_URL): Promise<unknown> {
  ready ??= initBrotli(source).catch((e: unknown) => {
    ready = null
    throw new Error(`zlib: could not load brotli WASM from ${typeof source === 'string' || source instanceof URL ? String(source) : 'bytes'}: ${e instanceof Error ? e.message : String(e)}`)
  })
  return ready
}

export const FORMATS = new Set<ZFormat>(['gzip', 'deflate', 'deflate-raw', 'brotli'])

/** The `zlib` RPC op: `bytes` (de)compressed as `format`. `quality` is brotli's (0-11); other tuning isn't supported. */
export async function zlibOp(format: ZFormat, mode: ZMode, bytes: Uint8Array, quality: number | undefined, brotliWasmUrl?: string): Promise<Uint8Array> {
  if (!FORMATS.has(format) || (mode !== 'compress' && mode !== 'decompress') || !(bytes instanceof Uint8Array)) throw new TypeError('zlib: bad arguments')
  if (format !== 'brotli' || nativeCodec(format, mode)) return nativeOneShot(format, mode, bytes)
  await loadBrotli(brotliWasmUrl)
  if (mode === 'compress') return brCompress(bytes, typeof quality === 'number' && quality >= 0 && quality <= 11 ? { quality: Math.floor(quality) } : {})
  try {
    return brDecompress(bytes)
  } catch (e) {
    throw zlibError(e, format)
  }
}
