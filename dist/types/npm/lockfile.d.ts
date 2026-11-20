import type { VFS } from '../vfs';
import { type Link, type Placement, type Workspace } from './resolver';
export interface LockEntry {
    name?: string;
    version?: string;
    resolved?: string;
    integrity?: string;
    link?: boolean;
    dev?: boolean;
    optional?: boolean;
    devOptional?: boolean;
    inBundle?: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
    os?: string[];
    cpu?: string[];
    hasInstallScript?: boolean;
    workspaces?: unknown;
    [k: string]: unknown;
}
export interface Lockfile {
    lockfileVersion?: number;
    packages?: Record<string, LockEntry>;
    [k: string]: unknown;
}
interface PkgLike {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    workspaces?: unknown;
    overrides?: unknown;
    bin?: string | Record<string, string>;
    [k: string]: unknown;
}
export declare const LOCK_NAMES: string[];
/** The project's lockfile (npm-shrinkwrap.json wins, as in npm), or null. Throws on unparsable JSON. */
export declare function readLock(vfs: VFS, cwd: string): {
    file: string;
    lock: Lockfile;
} | null;
/** Expand package.json `workspaces` into the directories (relative to cwd) that have a package.json, sorted. */
export declare function findWorkspaces(vfs: VFS, cwd: string, pkg: PkgLike): Workspace[];
/**
 * Why the lockfile can't be installed as is for this package.json and workspaces (null when it can), as `npm ci`
 * checks: the same dependency specs for the root and every workspace, the same workspaces (linked), well-formed
 * paths, and every dependency of the root, a workspace or a locked package resolving (from where it is required, as
 * node's lookup would) to an entry that satisfies it.
 */
export declare function lockOutOfSync(lock: Lockfile, pkg: PkgLike, workspaces: Workspace[]): string | null;
/** Package name from a lockfile path: the part after the last `node_modules/`. */
export declare function nameFromPath(path: string): string;
/**
 * Placements and links the lockfile lists, minus what can't or needn't be fetched here: bundled deps (inside their
 * parent's tarball), optional platform-specific packages and non-registry sources (warned, as fresh installs do).
 * Expects a lockfile `lockOutOfSync` accepted (so its paths are well-formed); `workspaces` are the workspace dirs.
 */
export declare function lockContents(lock: Lockfile, workspaces: Set<string>): {
    placements: Placement[];
    links: Link[];
    bundled: Set<string>;
    warnings: string[];
    needsManifest: Placement[];
};
/** Write the lockfile (v3) for a resolved tree: `file` is the one read (npm-shrinkwrap.json), else package-lock.json. */
export declare function writeLock(vfs: VFS, cwd: string, file: string, pkg: PkgLike, workspaces: Workspace[], placements: Placement[], links: Link[], platform?: Placement[]): void;
export {};
