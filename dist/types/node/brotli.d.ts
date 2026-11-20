import { type ZFormat, type ZMode } from './codec';
/** Keep in step with the exact `brotli-wasm` devDependency (its JS glue is bundled; this is its matching .wasm). */
export declare const BROTLI_WASM_VERSION = "3.0.1";
export declare const DEFAULT_BROTLI_WASM_URL = "https://cdn.jsdelivr.net/npm/brotli-wasm@3.0.1/pkg.web/brotli_wasm_bg.wasm";
/** Load the brotli WASM module (a URL, or the module's bytes). Retried on the next call after a failure. */
export declare function loadBrotli(source?: string | URL | BufferSource): Promise<unknown>;
export declare const FORMATS: Set<ZFormat>;
/** The `zlib` RPC op: `bytes` (de)compressed as `format`. `quality` is brotli's (0-11); other tuning isn't supported. */
export declare function zlibOp(format: ZFormat, mode: ZMode, bytes: Uint8Array, quality: number | undefined, brotliWasmUrl?: string): Promise<Uint8Array>;
