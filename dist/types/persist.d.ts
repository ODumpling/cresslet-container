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
/** When a snapshot was saved (0 if unreadable). */
export declare function savedAt(bytes: Uint8Array): number;
/** Write a snapshot's files into `dir`. Throws (having written nothing) if the blob isn't a valid snapshot. */
export declare function restoreSnapshot(vfs: VFS, dir: string, bytes: Uint8Array): void;
export interface SnapshotStore {
    readonly backend: 'opfs' | 'indexeddb';
    read(key: string): Promise<Uint8Array | null>;
    write(key: string, bytes: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
    /** Release the connection (stores opened for one operation). */
    close(): void;
}
/**
 * OPFS store, or null where OPFS (with writable streams on this thread) is unavailable. `create: false` (to read or
 * delete what's there): no writable streams needed, and null when nothing was ever stored there.
 */
export declare function opfsStore(create?: boolean): Promise<SnapshotStore | null>;
/** IndexedDB store, or null where IndexedDB is unavailable. `create: false`: null too when the database doesn't exist. */
export declare function idbStore(create?: boolean): Promise<SnapshotStore | null>;
/** The store snapshots go to: OPFS, else IndexedDB, else null. */
export declare function pickStore(): Promise<SnapshotStore | null>;
/** The backend not in use, to read or delete what it holds (written while the one in use wasn't usable). */
export declare function otherStore(inUse: SnapshotStore['backend']): Promise<SnapshotStore | null>;
/**
 * Delete a key's snapshot from every backend (one in use may differ from the one that wrote it), and from `inUse`.
 * Creates no storage.
 */
export declare function clearSnapshot(key: string, inUse?: SnapshotStore | null): Promise<void>;
export declare function persistKey(key?: unknown): string;
/**
 * `Container.clearPersisted(key)`: through the containers on this page using `key`, so the delete runs after a save
 * they still have queued (e.g. right after teardown) instead of being undone by it.
 */
export declare function clearPersisted(key: string): Promise<void>;
export declare class VfsPersistence implements Persistence {
    private readonly vfs;
    /** Reports a snapshot that failed to store outside `flush()` (debounced and page-hide writes). */
    private readonly onError;
    private readonly getStore;
    private readonly getOther;
    readonly key: string;
    backend: 'opfs' | 'indexeddb' | null;
    restored: boolean;
    private readonly debounceMs;
    private readonly maxWrites;
    private store;
    /** Changes not in the stored snapshot (nor in the write in progress). A failed write adds its changes back. */
    private pending;
    /** Bumped by clear(): a write that fails after it doesn't bring its (cleared) changes back. */
    private gen;
    private timer;
    /** The last write or delete queued; they run one after another. */
    private queue;
    /** A write waiting for the one in progress. It serializes the workdir when it starts, so later changes join it. */
    private queued;
    /** When the other backend's copy of this key (seen at boot) was saved: dropped after the first save. */
    private otherSavedAt;
    private stops;
    private closed;
    private readonly dir;
    constructor(vfs: VFS, dir: string, opts: PersistOptions, 
    /** Reports a snapshot that failed to store outside `flush()` (debounced and page-hide writes). */
    onError: (message: string) => void, getStore?: () => Promise<SnapshotStore | null>, getOther?: (inUse: SnapshotStore['backend']) => Promise<SnapshotStore | null>);
    /** Pick the store, restore the workdir from its snapshot, then start watching for changes. */
    start(): Promise<void>;
    private changed;
    private cancelTimer;
    private flushQuietly;
    flush(): Promise<void>;
    private write;
    clear(): Promise<void>;
    /** Stop watching; write pending changes (best effort: teardown can't wait for it). */
    close(): void;
}
