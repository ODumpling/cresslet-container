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
    /** An optional dependency: failing to fetch it only warns. */
    optional?: boolean;
}
/** A symlink in node_modules, e.g. a workspace: `node_modules/a` -> `packages/a` (both relative to the project). */
export interface Link {
    path: string;
    target: string;
}
export interface Workspace {
    name: string;
    version: string;
    /** Directory relative to the project root, e.g. 'packages/a'. */
    path: string;
    pkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        bin?: string | Record<string, string>;
        [k: string]: unknown;
    };
}
export interface ResolveResult {
    placements: Placement[];
    links: Link[];
    /** Optional platform-specific packages left out (they can't run here), kept for the lockfile. */
    platform: Placement[];
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
/** As npm normalizes a manifest: a name in optionalDependencies is dropped from dependencies. */
export declare function withoutOptional(deps: Record<string, string> | undefined, optional: Record<string, string> | undefined): Record<string, string> | undefined;
/**
 * A package's own dependency edges (root or workspace; `dev` false for an installed package): a name in several
 * fields gets the last of prod, optional, dev, as npm's arborist loads them.
 */
export declare function packageDeps(pkg: Workspace['pkg'], dev?: boolean): DepRequest[];
export declare function resolveTree(rootDeps: DepRequest[], registry: Registry, opts?: {
    peers?: boolean;
    onProgress?: (msg: string) => void;
    /** Linked at `node_modules/<name>`; their deps hoist to the root, nesting under the workspace on conflict. */
    workspaces?: Workspace[];
    /**
     * Versions to keep when they still satisfy the range (from the lockfile), by install path: the one locked where
     * the package goes first, else the highest locked anywhere.
     */
    locked?: Map<string, {
        pkg: string;
        version: string;
    }>;
    /** Install paths resolved fresh (an edited edge): no locked version from elsewhere is borrowed for them. */
    fresh?: Set<string>;
}): Promise<ResolveResult>;
