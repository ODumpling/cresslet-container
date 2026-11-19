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
}
export declare class HttpRegistry implements Registry {
    base: string;
    constructor(base?: string);
    packument(name: string): Promise<Packument>;
    tarball(url: string, integrity?: string): Promise<Uint8Array>;
}
