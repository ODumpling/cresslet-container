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
  | ChildEvent

/** `child_process`: what happens to a child the worker spawned (`child-spawn`), in order: spawn | error, out*, exit. */
export type ChildEvent =
  | { type: 'child'; id: number; ev: 'spawn' }
  | { type: 'child'; id: number; ev: 'error'; message: string; code: string }
  | { type: 'child'; id: number; ev: 'out'; fd: 1 | 2; data: string }
  | { type: 'child'; id: number; ev: 'exit'; code: number | null; signal: string | null }

/** How a child's stdin / stdout / stderr connect: to the parent worker, the parent's own stdio, or nothing. */
export type ChildStdio = 'pipe' | 'inherit' | 'ignore'

export interface ChildSpec {
  /** Command name or path; with `shell`, a jsh command line. */
  file: string
  args: string[]
  shell: boolean
  cwd?: string
  env?: Record<string, string>
  stdio: [ChildStdio, ChildStdio, ChildStdio]
}

/** spawnSync's result: output as text (the parent worker makes Buffers), status null when killed by `signal`. */
export interface ChildSyncResult {
  status: number | null
  signal: string | null
  stdout: string
  stderr: string
  error?: { message: string; code: string }
}

/** Host <-> preview relay, per process (relay-hosted workers only): sync replies, kill, worker errors. */
export type HostToRelayProc = MainToWorker | { type: 'sync-result'; payload: Uint8Array } | { type: 'terminate' }
export type RelayProcToHost = WorkerToMain | { type: 'worker-error'; message: string }

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
  | ({ type: 'child-spawn'; id: number } & ChildSpec)
  /** A chunk for the child's stdin; `null` ends it. */
  | { type: 'child-stdin'; id: number; data: string | null }
  | { type: 'child-kill'; id: number; signal: string }

// SAB layout: Int32 [0]=state, [1]=payload length; bytes from offset 8 = payload.
/**
 * The port `server.listen(first, …)` asks for (0: pick one). Strings are coerced as Node does ('3e3' is 3000); a string
 * that isn't a number is a pipe path, which gets an automatic port here (no sockets). A bad port throws
 * ERR_SOCKET_BAD_PORT, as in Node.
 */
export function listenPort(first: unknown): number {
  let port = first && typeof first === 'object' ? Number((first as { port?: number }).port ?? 0) : Number(first ?? 0)
  if (typeof first === 'string' && Number.isNaN(port)) port = 0
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Object.assign(new RangeError(`options.port should be >= 0 and < 65536. Received ${String(first)}.`), { code: 'ERR_SOCKET_BAD_PORT' })
  return port
}

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

/**
 * Writes sync-call results into the SharedArrayBuffer a blocked worker waits on. Lives in the worker's agent cluster:
 * the host page's main thread, or the preview relay for workers on the preview origin (a SAB can't cross origins).
 */
export class SyncReplier {
  private stash: Uint8Array | null = null
  constructor(public sab: SharedArrayBuffer) {}

  write(payload: Uint8Array): void {
    const buf = this.sab
    const i32 = new Int32Array(buf, 0, 2)
    if (payload.byteLength > buf.byteLength - HEADER) {
      this.stash = payload
      Atomics.store(i32, 1, payload.byteLength)
      Atomics.store(i32, 0, STATE_GROW)
    } else {
      new Uint8Array(buf, HEADER, payload.byteLength).set(payload)
      Atomics.store(i32, 1, payload.byteLength)
      Atomics.store(i32, 0, STATE_DONE)
    }
    Atomics.notify(i32, 0)
  }

  /** The worker's bigger buffer after STATE_GROW: deliver the stashed payload into it. */
  grow(sab: SharedArrayBuffer): void {
    this.sab = sab
    const p = this.stash
    this.stash = null
    if (p) this.write(p)
  }
}

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
