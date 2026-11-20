import { type PackageCache } from './cache';
export interface Manifest {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, {
        optional?: boolean;
    }>;
    bin?: string | Record<string, string>;
    os?: string[];
    cpu?: string[];
    hasInstallScript?: boolean;
    scripts?: Record<string, string>;
    deprecated?: string;
    dist: {
        tarball: string;
        integrity?: string;
        shasum?: string;
    };
}
export interface Packument {
    name: string;
    'dist-tags': Record<string, string>;
    versions: Record<string, Manifest>;
}
export interface Registry {
    packument(name: string): Promise<Packument>;
    tarball(url: string, integrity?: string): Promise<Uint8Array>;
    /** Wait (bounded, best-effort) for pending persistent-cache writes. */
    flush?(): Promise<void>;
}
/** Packuments are reused for 5 minutes (the registry's own `max-age`), in memory and across reloads. */
export declare const PACKUMENT_TTL: number;
/** A stale packument served because the registry was unreachable is retried after this long, not after a full TTL. */
export declare const STALE_RETRY = 10000;
export interface HttpRegistryOptions {
    /** Persistent cache for tarballs + packuments; `null` = in-memory only. */
    cache?: PackageCache | null;
}
export declare class HttpRegistry implements Registry {
    base: string;
    readonly cache: PackageCache | null;
    private readonly memo;
    constructor(base?: string, opts?: HttpRegistryOptions);
    packument(name: string): Promise<Packument>;
    tarball(url: string, integrity?: string): Promise<Uint8Array>;
    private write;
    flush(): Promise<void>;
}
/** Drop the pre-IndexedDB Cache Storage tarball cache (superseded by the IndexedDB cache). */
export declare function dropLegacyCache(): void;
