// Loose typings for the bundled node polyfill packages (events, readable-stream, string_decoder).
/* eslint-disable @typescript-eslint/no-explicit-any */
type BufferEncoding = 'utf8' | 'utf-8' | 'hex' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'ascii' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le'

declare var process: any
declare var Buffer: typeof import('buffer').Buffer

declare module 'events' {
  type L = (...a: any[]) => void
  export class EventEmitter {
    static defaultMaxListeners: number
    static once(em: any, ev: string): Promise<any[]>
    on(ev: string | symbol, fn: L): this
    once(ev: string | symbol, fn: L): this
    off(ev: string | symbol, fn: L): this
    addListener(ev: string | symbol, fn: L): this
    removeListener(ev: string | symbol, fn: L): this
    removeAllListeners(ev?: string | symbol): this
    emit(ev: string | symbol, ...a: any[]): boolean
    listenerCount(ev: string | symbol): number
    listeners(ev: string | symbol): L[]
    setMaxListeners(n: number): this
  }
  export function once(em: any, ev: string): Promise<any[]>
  export default EventEmitter
}

declare module 'readable-stream' {
  import { EventEmitter } from 'events'
  export class Stream extends EventEmitter {
    constructor(opts?: any)
    [k: string]: any
  }
  export class Readable extends Stream {}
  export class Writable extends Stream {}
  export class Duplex extends Stream {}
  export class Transform extends Stream {}
  export class PassThrough extends Stream {}
  export function pipeline(...a: any[]): any
  export function finished(...a: any[]): any
  export const promises: any
}

declare module 'string_decoder' {
  export class StringDecoder {
    constructor(enc?: string)
    write(b: Uint8Array): string
    end(b?: Uint8Array): string
  }
}
