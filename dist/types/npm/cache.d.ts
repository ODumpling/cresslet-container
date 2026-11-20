export interface PackageCache {
    get<T = unknown>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
export type CacheStore = 'tarballs' | 'packuments';
/** Default cap on the cache's (approximate) total size. */
export declare const DEFAULT_MAX_BYTES: number;
/** Bound for one IndexedDB transaction (and for flushing pending writes): past it a get is a miss, a put/delete a no-op. */
export declare const OP_TIMEOUT = 2000;
/** In-memory PackageCache (tests, or a host that wants per-session caching only). */
export declare class MemoryCache implements PackageCache {
    readonly data: Map<string, unknown>;
    get<T>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
/** Approximate stored size of a value: bytes for binary data, else its JSON length. */
export declare function sizeOf(value: unknown): number;
export interface IdbCacheOptions {
    /** Cap on the cache's total size; least-recently-used entries are evicted past it. Default DEFAULT_MAX_BYTES. */
    maxBytes?: number;
}
export declare class IdbCache implements PackageCache {
    readonly maxBytes: number;
    private db;
    constructor(opts?: IdbCacheOptions);
    private open;
    /** Runs `fn` in one transaction; resolves to its result getter's value once committed, or undefined on failure / timeout. */
    private tx;
    /** A hit counts as a use, recorded in the same transaction, so a write right after can't evict what was just read. */
    get<T>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
    /**
     * Saves `st` after evicting least-recently-used entries (other than `keep`, the entry just used) until its total
     * fits the cap.
     */
    private settle;
}
/** A cap must be a positive number of bytes (`Infinity` for none). */
export declare function checkMaxBytes(n: unknown): number;
declare const ALGOS: {
    readonly sha512: "SHA-512";
    readonly sha384: "SHA-384";
    readonly sha256: "SHA-256";
    readonly sha1: "SHA-1";
};
export interface Digest {
    /** `algo-hash`, the token used as the cache key */
    token: string;
    algo: keyof typeof ALGOS;
    hash: string;
    /** every hash given for `algo` (SRI: matching any one of them passes); `hash` is the first */
    hashes: string[];
    /** WebCrypto algorithm name */
    subtle: string;
}
/** The strongest supported algorithm (SRI rules): its first token keys the cache, all of its tokens verify. */
export declare function selectDigest(integrity?: string): Digest | null;
/** Whether a digest can actually be checked here (WebCrypto is missing on insecure origins). */
export declare const canVerify: (d: Digest | null) => d is Digest;
/** Cache key for a tarball: its sha256+ digest when it is verified on read (content-addressed, shared across mirrors), else its URL. */
export declare function tarballKey(url: string, integrity?: string): string;
/** One IndexedDB connection per page and cap, shared by all containers using that cap. */
export declare function sharedIdbCache(maxBytes?: number): IdbCache;
export {};
