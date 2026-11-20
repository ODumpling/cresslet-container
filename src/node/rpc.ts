// Worker-side RPC to the main thread + event-loop liveness tracking (decides when `node` exits).
import { decodeResult, HEADER, STATE_GROW, STATE_IDLE, type MainToWorker, type WorkerToMain } from './protocol'

let sab: SharedArrayBuffer | null = null
export function setSab(s: SharedArrayBuffer | null): void {
  sab = s
}
export const hasSync = (): boolean => sab !== null

export function post(m: WorkerToMain, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(m, transfer)
}

export function syncCall<T = unknown>(op: string, ...args: unknown[]): T {
  if (!sab)
    throw Object.assign(new Error(`[cresslet] synchronous '${op}' requires a cross-origin isolated page (COOP/COEP headers); use fs.promises instead`), {
      code: 'ERR_CRESSLET_NO_SYNC',
    })
  let i32 = new Int32Array(sab, 0, 2)
  Atomics.store(i32, 0, STATE_IDLE)
  post({ type: 'sync', op, args })
  Atomics.wait(i32, 0, STATE_IDLE)
  if (Atomics.load(i32, 0) === STATE_GROW) {
    const len = Atomics.load(i32, 1)
    sab = new SharedArrayBuffer(HEADER + len + 1024 * 1024)
    i32 = new Int32Array(sab, 0, 2)
    Atomics.store(i32, 0, STATE_IDLE)
    post({ type: 'sync-grow', sab })
    Atomics.wait(i32, 0, STATE_IDLE)
  }
  const len = Atomics.load(i32, 1)
  return decodeResult(new Uint8Array(sab, HEADER, len).slice()) as T // copy out of shared memory (TextDecoder rejects shared views)
}

let asyncId = 0
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

export function asyncCall<T = unknown>(op: string, ...args: unknown[]): Promise<T> {
  const id = ++asyncId
  const release = ref()
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    post({ type: 'async', id, op, args })
  }).finally(release)
}

export function handleAsyncResult(m: Extract<MainToWorker, { type: 'async-result' }>): void {
  const w = waiting.get(m.id)
  if (!w) return
  waiting.delete(m.id)
  if (m.ok) w.resolve(m.value)
  else {
    const v = m.value as { message: string; code?: string }
    w.reject(Object.assign(new Error(v.message), v.code ? { code: v.code } : {}))
  }
}

// ---- liveness ----
let refs = 0
let onIdle: (() => void) | null = null
let checkScheduled = false
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis)
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis)

/** Hold the process open; returns a release function (idempotent). */
export function ref(): () => void {
  refs++
  let released = false
  return () => {
    if (released) return
    released = true
    refs--
    scheduleIdleCheck()
  }
}

export const activeRefs = (): number => refs

export function setIdleHandler(fn: () => void): void {
  onIdle = fn
}

export function scheduleIdleCheck(): void {
  if (checkScheduled) return
  checkScheduled = true
  nativeSetTimeout(() => {
    checkScheduled = false
    if (refs <= 0) onIdle?.()
  }, 0)
}

export { nativeSetTimeout, nativeClearTimeout }
