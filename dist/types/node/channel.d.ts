import { type MainToWorker, type WorkerToMain } from './protocol';
export interface NodeChannel {
    post(m: MainToWorker, transfer?: Transferable[]): void;
    /** Answer the worker's pending sync call (an encoded result, see protocol.ts). */
    reply(payload: Uint8Array): void;
    onmessage: ((m: WorkerToMain) => void) | null;
    onerror: ((message: string) => void) | null;
    terminate(): void;
}
/** A worker on this page. Sync calls work when the page is cross-origin isolated. */
export declare function localChannel(worker: Worker): NodeChannel;
/**
 * A worker the preview relay runs on the preview origin, over `port` (its other end went to the relay with a
 * `cresslet-proc-spawn`). Everything on it is untrusted (previews can script the relay): it only ever reaches what a
 * `node` process may do anyway. `onClose` runs once on terminate.
 */
export declare function relayChannel(port: MessagePort, onClose: () => void): NodeChannel;
/** A Web Worker running project code (`Container.projectWorker`): a real `Worker`, or one the relay runs. */
export interface ProjectWorker {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((ev: MessageEvent) => void) | null;
    onerror: ((ev: {
        message: string;
    }) => void) | null;
    terminate(): void;
}
/** A project worker the preview relay runs on the preview origin, over `port` (see relay-protocol.ts). */
export declare function relayWorker(port: MessagePort, onClose: () => void): ProjectWorker;
