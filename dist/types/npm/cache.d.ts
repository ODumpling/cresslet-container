export interface PackageCache {
    get<T = unknown>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
export type CacheStore = 'tarballs' | 'packuments';
/** Bound for one IndexedDB transaction (and for flushing pending writes): past it a get is a miss, a put/delete a no-op. */
export declare const OP_TIMEOUT = 2000;
/** In-memory PackageCache (tests, or a host that wants per-session caching only). */
export declare class MemoryCache implements PackageCache {
    readonly data: Map<string, unknown>;
    get<T>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
export declare class IdbCache implements PackageCache {
    private db;
    private open;
    private tx;
    get<T>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
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
/** One IndexedDB connection per page, shared by all containers. */
export declare const sharedIdbCache: () => IdbCache;
export {};
