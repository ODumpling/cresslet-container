// Main <-> node worker protocol. Sync calls block the worker on Atomics.wait over a SharedArrayBuffer
// while the main thread (which owns the VFS) services them.

export interface StartMsg {
  type: 'start'
  argv: string[]
  env: Record<string, string>
  cwd: string
  isTTY: boolean
  columns: number
  pid: number
  /** Null when not crossOriginIsolated (sync fs unavailable). */
  sab: SharedArrayBuffer | null
  /** Ports already listening in the container (for in-container fetch). */
  ports: number[]
}

export type MainToWorker =
  | StartMsg
  | { type: 'stdin'; data: string }
  | { type: 'stdin-end' }
  | { type: 'signal'; name: string }
  | { type: 'async-result'; id: number; ok: boolean; value: unknown }
  | { type: 'http-request'; id: number; port: number; method: string; url: string; headers: [string, string][]; body: ArrayBuffer | null }
  | { type: 'http-abort'; id: number }

export type WorkerToMain =
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'sync'; op: string; args: unknown[] }
  | { type: 'sync-grow'; sab: SharedArrayBuffer }
  | { type: 'async'; id: number; op: string; args: unknown[] }
  | { type: 'listen'; port: number }
  | { type: 'unlisten'; port: number }
  | { type: 'http-head'; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: 'http-chunk'; id: number; data: Uint8Array }
  | { type: 'http-end'; id: number; error?: string }

// SAB layout: Int32 [0]=state, [1]=payload length; bytes from offset 8 = payload.
export const HEADER = 8
export const STATE_IDLE = 0
export const STATE_DONE = 1
/** Payload too large; worker must provide a bigger buffer via `sync-grow`. */
export const STATE_GROW = 2
export const DEFAULT_SAB = 4 * 1024 * 1024

// Payload tag byte
export const TAG_JSON = 0
export const TAG_BYTES = 1
export const TAG_ERROR = 2
export const TAG_UNDEFINED = 3

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeResult(ok: boolean, value: unknown): Uint8Array {
  if (!ok) {
    const e = value as { message?: string; code?: string; path?: string }
    const body = enc.encode(JSON.stringify({ message: e?.message ?? String(value), code: e?.code, path: e?.path }))
    return prefix(TAG_ERROR, body)
  }
  if (value === undefined) return new Uint8Array([TAG_UNDEFINED])
  if (value instanceof Uint8Array) return prefix(TAG_BYTES, value)
  return prefix(TAG_JSON, enc.encode(JSON.stringify(value)))
}

function prefix(tag: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.byteLength + 1)
  out[0] = tag
  out.set(body, 1)
  return out
}

export interface RemoteError extends Error {
  code?: string
  path?: string
}

export function decodeResult(bytes: Uint8Array): unknown {
  const tag = bytes[0]
  const body = bytes.subarray(1)
  if (tag === TAG_UNDEFINED) return undefined
  if (tag === TAG_BYTES) return body.slice()
  const v = JSON.parse(dec.decode(body))
  if (tag === TAG_ERROR) {
    const e = new Error(v.message) as RemoteError
    if (v.code) e.code = v.code
    if (v.path) e.path = v.path
    throw e
  }
  return v
}
