import type { Manifest, Packument, Registry } from './registry';
export interface DepRequest {
    /** Directory name under node_modules (alias name for `npm:` specs). */
    name: string;
    spec: string;
    kind?: 'prod' | 'dev' | 'optional' | 'peer' | 'peerOptional';
}
export interface Placement {
    /** e.g. 'node_modules/a/node_modules/b' */
    path: string;
    name: string;
    /** Real registry package name (differs for aliases). */
    pkg: string;
    version: string;
    manifest: Manifest;
    depth: number;
}
export interface ResolveResult {
    placements: Placement[];
    warnings: string[];
}
/** Classify a dependency spec. */
export declare function parseSpec(name: string, spec: string): {
    pkg: string;
    range: string;
} | {
    skip: string;
};
export declare function pickVersion(p: Packument, range: string): string | null;
export declare function resolveTree(rootDeps: DepRequest[], registry: Registry, opts?: {
    peers?: boolean;
    onProgress?: (msg: string) => void;
}): Promise<ResolveResult>;
