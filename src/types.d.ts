declare module 'cjs-lexer-js' {
  export function parse(code: string, name?: string): { exports: string[]; reexports: string[] }
}
declare module '*?bundle' {
  const text: string
  export default text
}
declare module '*?raw' {
  const text: string
  export default text
}
declare module 'brotli-wasm-web' {
  export default function init(source?: string | URL | BufferSource | Response | Promise<Response>): Promise<unknown>
  export function compress(buf: Uint8Array, options?: { quality?: number }): Uint8Array
  export function decompress(buf: Uint8Array): Uint8Array
}
