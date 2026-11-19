export interface StartMsg {
    type: 'start';
    argv: string[];
    env: Record<string, string>;
    cwd: string;
    isTTY: boolean;
    columns: number;
    pid: number;
    /** Null when not crossOriginIsolated (sync fs unavailable). */
    sab: SharedArrayBuffer | null;
    /** Ports already listening in the container (for in-container fetch). */
    ports: number[];
}
export type MainToWorker = StartMsg | {
    type: 'stdin';
    data: string;
} | {
    type: 'stdin-end';
} | {
    type: 'signal';
    name: string;
} | {
    type: 'async-result';
    id: number;
    ok: boolean;
    value: unknown;
} | {
    type: 'http-request';
    id: number;
    port: number;
    method: string;
    url: string;
    headers: [string, string][];
    body: ArrayBuffer | null;
} | {
    type: 'http-abort';
    id: number;
};
export type WorkerToMain = {
    type: 'stdout' | 'stderr';
    data: string;
} | {
    type: 'exit';
    code: number;
} | {
    type: 'sync';
    op: string;
    args: unknown[];
} | {
    type: 'sync-grow';
    sab: SharedArrayBuffer;
} | {
    type: 'async';
    id: number;
    op: string;
    args: unknown[];
} | {
    type: 'listen';
    port: number;
} | {
    type: 'unlisten';
    port: number;
} | {
    type: 'http-head';
    id: number;
    status: number;
    statusText: string;
    headers: [string, string][];
} | {
    type: 'http-chunk';
    id: number;
    data: Uint8Array;
} | {
    type: 'http-end';
    id: number;
    error?: string;
};
export declare const HEADER = 8;
export declare const STATE_IDLE = 0;
export declare const STATE_DONE = 1;
/** Payload too large; worker must provide a bigger buffer via `sync-grow`. */
export declare const STATE_GROW = 2;
export declare const DEFAULT_SAB: number;
export declare const TAG_JSON = 0;
export declare const TAG_BYTES = 1;
export declare const TAG_ERROR = 2;
export declare const TAG_UNDEFINED = 3;
export declare function encodeResult(ok: boolean, value: unknown): Uint8Array;
export interface RemoteError extends Error {
    code?: string;
    path?: string;
}
export declare function decodeResult(bytes: Uint8Array): unknown;
