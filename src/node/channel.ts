// Where a `node` process runs, as seen from the host page: a Web Worker on this page, or one the preview relay runs on
// the preview origin (`boot({ previewOrigin })`), reached over a MessagePort. Either way the side that owns the
// worker also owns the SharedArrayBuffer its sync calls block on (a SAB can't be shared across origins): it fills
// `start.sab` in and writes sync results into it.
import { DEFAULT_SAB, HEADER, SyncReplier, type HostToRelayProc, type MainToWorker, type RelayProcToHost, type WorkerToMain } from './protocol'

export interface NodeChannel {
  post(m: MainToWorker, transfer?: Transferable[]): void
  /** Answer the worker's pending sync call (an encoded result, see protocol.ts). */
  reply(payload: Uint8Array): void
  onmessage: ((m: WorkerToMain) => void) | null
  onerror: ((message: string) => void) | null
  terminate(): void
}

/** A worker on this page. Sync calls work when the page is cross-origin isolated. */
export function localChannel(worker: Worker): NodeChannel {
  const isolated = typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false
  const replier = isolated ? new SyncReplier(new SharedArrayBuffer(HEADER + DEFAULT_SAB)) : null
  const ch: NodeChannel = {
    post: (m, transfer = []) => worker.postMessage(m.type === 'start' ? { ...m, sab: replier?.sab ?? null } : m, transfer),
    reply: (payload) => replier?.write(payload),
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  }
  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const m = ev.data
    if (m.type === 'sync-grow') replier?.grow(m.sab)
    else ch.onmessage?.(m)
  }
  worker.onerror = (e) => ch.onerror?.(String(e.message ?? e))
  return ch
}

/**
 * A worker the preview relay runs on the preview origin, over `port` (its other end went to the relay with a
 * `cresslet-proc-spawn`). Everything on it is untrusted (previews can script the relay): it only ever reaches what a
 * `node` process may do anyway. `onClose` runs once on terminate.
 */
export function relayChannel(port: MessagePort, onClose: () => void): NodeChannel {
  let closed = false
  const send = (m: HostToRelayProc, transfer: Transferable[] = []) => !closed && port.postMessage(m, transfer)
  const ch: NodeChannel = {
    post: (m, transfer) => send(m, transfer),
    reply: (payload) => send({ type: 'sync-result', payload }, [payload.buffer]),
    onmessage: null,
    onerror: null,
    terminate: () => {
      if (closed) return
      send({ type: 'terminate' })
      closed = true
      port.close()
      onClose()
    },
  }
  port.onmessage = (ev: MessageEvent<RelayProcToHost>) => {
    const m = ev.data as RelayProcToHost | null
    if (!m || typeof m !== 'object' || typeof m.type !== 'string' || m.type === 'sync-grow') return
    if (m.type === 'worker-error') ch.onerror?.(String(m.message).slice(0, 2000))
    else ch.onmessage?.(m)
  }
  return ch
}

/** A Web Worker running project code (`Container.projectWorker`): a real `Worker`, or one the relay runs. */
export interface ProjectWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((ev: MessageEvent) => void) | null
  onerror: ((ev: { message: string }) => void) | null
  terminate(): void
}

/** A project worker the preview relay runs on the preview origin, over `port` (see relay-protocol.ts). */
export function relayWorker(port: MessagePort, onClose: () => void): ProjectWorker {
  let closed = false
  const w: ProjectWorker = {
    postMessage: (data, transfer = []) => !closed && port.postMessage({ t: 'msg', data }, transfer),
    onmessage: null,
    onerror: null,
    terminate: () => {
      if (closed) return
      port.postMessage({ t: 'terminate' })
      closed = true
      port.close()
      onClose()
    },
  }
  port.onmessage = (ev) => {
    const m = ev.data as { t?: unknown; data?: unknown; message?: unknown } | null
    if (closed || !m || typeof m !== 'object') return
    if (m.t === 'msg') w.onmessage?.(new MessageEvent('message', { data: m.data, ports: [...ev.ports] }))
    else if (m.t === 'error') w.onerror?.({ message: String(m.message).slice(0, 2000) })
  }
  return w
}
