export interface PackageCache {
    get<T = unknown>(store: CacheStore, key: string): Promise<T | undefined>;
    put(store: CacheStore, key: string, value: unknown): Promise<void>;
    delete(store: CacheStore, key: string): Promise<void>;
}
export type CacheStore = 'tarballs' | 'packuments';
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
/** Cache key for a tarball: its integrity (content-addressed, shared across mirrors) or, without one, its URL. */
export declare function tarballKey(url: string, integrity?: string): string;
/** One IndexedDB connection per page, shared by all containers. */
export declare const sharedIdbCache: () => IdbCache;
