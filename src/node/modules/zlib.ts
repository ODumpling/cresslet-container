// node:zlib polyfill: gzip / deflate / deflate-raw / brotli. Async calls and streams use this worker's
// CompressionStream (brotli where the browser has it, else the host's WASM); *Sync calls block on the host over the
// SAB RPC. Tuning options (level, windowBits, memLevel, strategy, flush modes, dictionaries) are accepted and ignored,
// except brotli's BROTLI_PARAM_QUALITY on the host.
import { Buffer } from 'buffer'
import { Transform } from 'readable-stream'
import { asyncCall, ref, syncCall } from '../rpc'
import { codecStream, nativeCodec, nativeOneShot, zlibError, type ZFormat, type ZMode } from '../codec'

export const constants = {
  Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5,
  Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, ZLIB_VERNUM: 4865,
  DEFLATE: 1, INFLATE: 2, GZIP: 3, GUNZIP: 4, DEFLATERAW: 5, INFLATERAW: 6, UNZIP: 7, BROTLI_DECODE: 8, BROTLI_ENCODE: 9,
  Z_MIN_WINDOWBITS: 8, Z_MAX_WINDOWBITS: 15, Z_DEFAULT_WINDOWBITS: 15, Z_MIN_CHUNK: 64, Z_MAX_CHUNK: Infinity, Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1, Z_MAX_MEMLEVEL: 9, Z_DEFAULT_MEMLEVEL: 8, Z_MIN_LEVEL: -1, Z_MAX_LEVEL: 9, Z_DEFAULT_LEVEL: -1,
  BROTLI_OPERATION_PROCESS: 0, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2, BROTLI_OPERATION_EMIT_METADATA: 3,
  BROTLI_PARAM_MODE: 0, BROTLI_MODE_GENERIC: 0, BROTLI_MODE_TEXT: 1, BROTLI_MODE_FONT: 2, BROTLI_DEFAULT_MODE: 0,
  BROTLI_PARAM_QUALITY: 1, BROTLI_MIN_QUALITY: 0, BROTLI_MAX_QUALITY: 11, BROTLI_DEFAULT_QUALITY: 11,
  BROTLI_PARAM_LGWIN: 2, BROTLI_MIN_WINDOW_BITS: 10, BROTLI_MAX_WINDOW_BITS: 24, BROTLI_LARGE_MAX_WINDOW_BITS: 30, BROTLI_DEFAULT_WINDOW: 22,
  BROTLI_PARAM_LGBLOCK: 3, BROTLI_MIN_INPUT_BLOCK_BITS: 16, BROTLI_MAX_INPUT_BLOCK_BITS: 24,
  BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4, BROTLI_PARAM_SIZE_HINT: 5, BROTLI_PARAM_LARGE_WINDOW: 6, BROTLI_PARAM_NPOSTFIX: 7, BROTLI_PARAM_NDIRECT: 8,
  BROTLI_DECODER_RESULT_ERROR: 0, BROTLI_DECODER_RESULT_SUCCESS: 1, BROTLI_DECODER_RESULT_NEEDS_MORE_INPUT: 2, BROTLI_DECODER_RESULT_NEEDS_MORE_OUTPUT: 3,
  BROTLI_DECODER_PARAM_DISABLE_RING_BUFFER_REALLOCATION: 0, BROTLI_DECODER_PARAM_LARGE_WINDOW: 1,
  BROTLI_DECODER_NO_ERROR: 0, BROTLI_DECODER_SUCCESS: 1, BROTLI_DECODER_NEEDS_MORE_INPUT: 2, BROTLI_DECODER_NEEDS_MORE_OUTPUT: 3,
}

type Kind = 'Gzip' | 'Gunzip' | 'Deflate' | 'Inflate' | 'DeflateRaw' | 'InflateRaw' | 'Unzip' | 'BrotliCompress' | 'BrotliDecompress'
const KINDS: Record<Kind, [ZFormat | 'auto', ZMode]> = {
  Gzip: ['gzip', 'compress'],
  Gunzip: ['gzip', 'decompress'],
  Deflate: ['deflate', 'compress'],
  Inflate: ['deflate', 'decompress'],
  DeflateRaw: ['deflate-raw', 'compress'],
  InflateRaw: ['deflate-raw', 'decompress'],
  Unzip: ['auto', 'decompress'], // gzip or zlib (deflate), by the header
  BrotliCompress: ['brotli', 'compress'],
  BrotliDecompress: ['brotli', 'decompress'],
}

interface ZlibOptions {
  params?: Record<number, number>
  [k: string]: unknown
}

type Input = string | ArrayBuffer | ArrayBufferView

function toBytes(data: Input, what = 'buffer'): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
  throw Object.assign(new TypeError(`The "${what}" argument must be of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer.`), { code: 'ERR_INVALID_ARG_TYPE' })
}

const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength)

/** `auto` (unzip): gzip magic bytes, else zlib. */
const pick = (format: ZFormat | 'auto', bytes: Uint8Array): ZFormat => (format !== 'auto' ? format : bytes[0] === 0x1f && bytes[1] === 0x8b ? 'gzip' : 'deflate')

const quality = (format: ZFormat, opts?: ZlibOptions) => (format === 'brotli' ? opts?.params?.[constants.BROTLI_PARAM_QUALITY] : undefined)

function zlibSync(kind: Kind, data: Input, opts?: ZlibOptions): Buffer {
  const bytes = toBytes(data)
  const [f, mode] = KINDS[kind]
  const format = pick(f, bytes)
  return toBuffer(syncCall<Uint8Array>('zlib', format, mode, bytes, quality(format, opts)))
}

async function zlibAsync(kind: Kind, bytes: Uint8Array, opts?: ZlibOptions): Promise<Uint8Array> {
  const [f, mode] = KINDS[kind]
  const format = pick(f, bytes)
  if (nativeCodec(format, mode)) return nativeOneShot(format, mode, bytes)
  return asyncCall<Uint8Array>('zlib', format, mode, bytes, quality(format, opts))
}

type Callback = (err: Error | null, result?: Buffer) => void

function zlibCallback(kind: Kind) {
  return (data: Input, opts?: ZlibOptions | Callback, cb?: Callback): void => {
    if (typeof opts === 'function') (cb = opts), (opts = undefined)
    if (typeof cb !== 'function') throw Object.assign(new TypeError('The "callback" argument must be of type function.'), { code: 'ERR_INVALID_ARG_TYPE' })
    const bytes = toBytes(data)
    const release = ref()
    zlibAsync(kind, bytes, opts).then(
      (r) => (release(), cb!(null, toBuffer(r))),
      (e) => (release(), cb!(e)),
    )
  }
}

/**
 * A zlib Transform stream. With a native codec the data streams through it chunk by chunk; brotli without one (on the
 * host's WASM) is collected and (de)compressed at the end.
 */
export class Zlib extends Transform {
  bytesWritten = 0
  private codec: { writer: WritableStreamDefaultWriter<Uint8Array>; drained: Promise<void> } | null = null
  private pending: Uint8Array[] | null = null
  private head: Uint8Array | null = null

  constructor(
    private kind: Kind,
    private opts: ZlibOptions = {},
  ) {
    super(opts)
  }

  /** Set up the codec once the format is known (unzip: from the first two bytes). */
  private open(format: ZFormat, mode: ZMode): void {
    if (!nativeCodec(format, mode)) {
      this.pending = []
      return
    }
    const ts = codecStream(format, mode)
    const reader = ts.readable.getReader()
    const drained = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        if (value?.byteLength) this.push(toBuffer(value))
      }
    })()
    drained.catch(() => {}) // surfaced through the write/close below
    this.codec = { writer: ts.writable.getWriter(), drained }
  }

  private fail(e: unknown, cb: (e?: Error | null) => void): void {
    const [f, mode] = KINDS[this.kind]
    cb(mode === 'decompress' ? zlibError(e, f === 'auto' ? 'deflate' : f) : (e as Error))
  }

  _transform(chunk: unknown, enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    let bytes = toBytes(typeof chunk === 'string' ? Buffer.from(chunk, enc) : (chunk as Input), 'chunk')
    this.bytesWritten += bytes.byteLength
    const [f, mode] = KINDS[this.kind]
    if (!this.codec && !this.pending) {
      if (f === 'auto') {
        // need two bytes to tell gzip from zlib
        const head = this.head ? Buffer.concat([this.head, bytes]) : bytes
        if (head.byteLength < 2) return (this.head = head), cb()
        this.head = null
        bytes = head
      }
      this.open(pick(f, bytes), mode)
    }
    if (this.pending) return this.pending.push(bytes), cb()
    const release = ref()
    this.codec!.writer.write(bytes).then(
      () => (release(), cb()),
      (e) => (release(), this.fail(e, cb)),
    )
  }

  _flush(cb: (e?: Error | null) => void): void {
    const [f, mode] = KINDS[this.kind]
    if (!this.codec && !this.pending) {
      if (f === 'auto' && this.head) return this.fail(new Error('truncated'), cb)
      this.open(pick(f, new Uint8Array(0)), mode)
    }
    const release = ref()
    const done = (e?: unknown) => {
      release()
      if (e === undefined) cb()
      else if (e instanceof Error && 'errno' in e) cb(e)
      else this.fail(e, cb)
    }
    if (this.pending) {
      zlibAsync(this.kind, Buffer.concat(this.pending), this.opts).then((r) => (this.push(toBuffer(r)), done()), done)
      return
    }
    const { writer, drained } = this.codec!
    writer
      .close()
      .then(() => drained)
      .then(() => done(), done)
  }

  /** No partial flushes (CompressionStream has none): calls back once pending writes are taken. */
  flush(kind?: number | (() => void), cb?: () => void): void {
    if (typeof kind === 'function') cb = kind
    if (cb) queueMicrotask(cb)
  }
  params(_level: number, _strategy: number, cb?: () => void): void {
    if (cb) queueMicrotask(cb)
  }
  reset(): void {}
  close(cb?: () => void): void {
    if (cb) this.once('close', cb)
    this.destroy()
  }
}

const zlib: Record<string, unknown> = { constants, Zlib, codes: { Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_VERSION_ERROR: -6 } }
for (const [k, v] of Object.entries(constants)) if (!k.startsWith('BROTLI_')) zlib[k] = v // legacy top-level aliases (zlib.Z_SYNC_FLUSH)

const lower = (k: Kind) => k[0].toLowerCase() + k.slice(1)
for (const kind of Object.keys(KINDS) as Kind[]) {
  const C = class extends Zlib {
    constructor(opts?: ZlibOptions) {
      super(kind, opts)
    }
  }
  Object.defineProperty(C, 'name', { value: kind })
  // also callable without `new`, as in Node
  zlib[kind] = new Proxy(C, { apply: (_t, _this, args) => new C(args[0]) })
  zlib[`create${kind}`] = (opts?: ZlibOptions) => new C(opts)
  zlib[lower(kind)] = zlibCallback(kind)
  zlib[`${lower(kind)}Sync`] = (data: Input, opts?: ZlibOptions) => zlibSync(kind, data, opts)
}

export default zlib
