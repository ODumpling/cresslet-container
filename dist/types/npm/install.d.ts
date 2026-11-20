import type { VFS } from '../vfs';
import type { Writer } from '../process';
import type { Registry } from './registry';
import { type Placement } from './resolver';
export interface InstallOptions {
    cwd: string;
    add?: string[];
    remove?: string[];
    dev?: boolean;
    exact?: boolean;
    /** `npm ci`: the lockfile must exist and match package.json; node_modules is removed first. */
    ci?: boolean;
    out: Writer;
    signal?: AbortSignal;
}
export interface PackageJsonLike {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    [k: string]: unknown;
}
export declare function readPkg(vfs: VFS, cwd: string): PackageJsonLike | null;
export declare function writePkg(vfs: VFS, cwd: string, pkg: PackageJsonLike): void;
/** Split 'name@range' / '@scope/name@range'. */
export declare function splitPkgSpec(s: string): {
    name: string;
    spec: string;
};
export declare function install(vfs: VFS, registry: Registry, o: InstallOptions): Promise<{
    added: number;
    removed: number;
    warnings: string[];
}>;
/**
 * Map of 'node_modules/a[/node_modules/b]' -> 'name@version' for everything installed under each root ('' = the project,
 * else a workspace dir); symlinks map to `link:<target>` and aren't descended into.
 */
export declare function listInstalled(vfs: VFS, cwd: string, roots?: string[]): Map<string, string>;
export declare function binEntries(name: string, bin: Manifest['bin']): [string, string][];
type Manifest = Placement['manifest'];
export {};
