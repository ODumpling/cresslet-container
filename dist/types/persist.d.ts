import type { VFS } from './vfs';
export interface PersistOptions {
    /** Snapshot name: one per project. Default 'default'. Containers with the same key share (overwrite) one snapshot. */
    key?: string;
    /** Write a snapshot this long after the last change. Default 1000 ms. */
    debounceMs?: number;
    /** ...or once this many changes are pending, even while changes keep coming. Default 100. */
    maxWrites?: number;
}
/** `c.persistence` when booted with `persist`. */
export interface Persistence {
    readonly key: string;
    /** Where snapshots go: 'opfs', 'indexeddb', or null when neither is available (persistence is then off). */
    readonly backend: 'opfs' | 'indexeddb' | null;
    /** Whether boot restored the workdir from a snapshot (false: none stored, or it couldn't be read). */
    readonly restored: boolean;
    /** Write pending changes now; resolves once the snapshot is stored. Rejects if storing fails. */
    flush(): Promise<void>;
    /** Delete the stored snapshot (pending changes are dropped). Later changes are snapshotted again. */
    clear(): Promise<void>;
}
export declare const DEFAULT_KEY = "default";
/** Serialize `dir` (recursively, without `node_modules`) into one snapshot blob. */
export declare function encodeSnapshot(vfs: VFS, dir: string): Uint8Array;
/** Write a snapshot's files into `dir`. Throws (having written nothing) if the blob isn't a valid snapshot. */
export declare function restoreSnapshot(vfs: VFS, dir: string, bytes: Uint8Array): void;
export interface SnapshotStore {
    readonly backend: 'opfs' | 'indexeddb';
    read(key: string): Promise<Uint8Array | null>;
    write(key: string, bytes: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
}
/** OPFS store, or null where OPFS (with writable streams on this thread) is unavailable. */
export declare function opfsStore(): Promise<SnapshotStore | null>;
/** IndexedDB store, or null where IndexedDB is unavailable. */
export declare function idbStore(): Promise<SnapshotStore | null>;
/** The store snapshots go to: OPFS, else IndexedDB, else null. */
export declare function pickStore(): Promise<SnapshotStore | null>;
/** Delete a key's snapshot from every backend (the one in use may differ from the one that wrote it). */
export declare function clearSnapshot(key: string): Promise<void>;
export declare function persistKey(key?: unknown): string;
export declare class VfsPersistence implements Persistence {
    private readonly vfs;
    private readonly dir;
    /** Reports a snapshot that failed to store outside `flush()` (debounced writes, teardown). */
    private readonly onError;
    private readonly getStore;
    readonly key: string;
    backend: 'opfs' | 'indexeddb' | null;
    restored: boolean;
    private readonly debounceMs;
    private readonly maxWrites;
    private store;
    private pending;
    private timer;
    /** The write (or delete) in progress, if any; operations run one after another. */
    private queue;
    private stops;
    private closed;
    constructor(vfs: VFS, dir: string, opts: PersistOptions, 
    /** Reports a snapshot that failed to store outside `flush()` (debounced writes, teardown). */
    onError: (message: string) => void, getStore?: () => Promise<SnapshotStore | null>);
    /** Pick the store, restore the workdir from its snapshot, then start watching for changes. */
    start(): Promise<void>;
    private changed;
    private flushQuietly;
    flush(): Promise<void>;
    clear(): Promise<void>;
    private enqueue;
    /** Stop watching; write pending changes (best effort). */
    close(): void;
}
