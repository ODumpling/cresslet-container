export type ZFormat = 'gzip' | 'deflate' | 'deflate-raw' | 'brotli';
export type ZMode = 'compress' | 'decompress';
/** Whether this realm's Compression/DecompressionStream handles `format`. */
export declare function nativeCodec(format: ZFormat, mode: ZMode): boolean;
export declare function codecStream(format: ZFormat, mode: ZMode): TransformStream<Uint8Array, Uint8Array>;
/** One-shot (de)compression with the native streams. Errors are zlib-style (see zlibError). */
export declare function nativeOneShot(format: ZFormat, mode: ZMode, bytes: Uint8Array): Promise<Uint8Array>;
export interface ZlibError extends Error {
    code: string;
    errno: number;
}
/**
 * Map a failed decompression (native stream or WASM) to the error Node's zlib throws for bad input. The platform's
 * messages vary, so only "truncated input" vs "bad data" is kept; brotli reports Node's message with code Z_DATA_ERROR.
 */
export declare function zlibError(e: unknown, format: ZFormat): ZlibError;
