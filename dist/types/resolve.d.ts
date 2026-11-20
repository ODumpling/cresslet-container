export interface ResolveFs {
    isFile(p: string): boolean;
    isDir(p: string): boolean;
    readText(p: string): string | null;
    /** Real path (symlinks resolved): linked packages (workspaces) then resolve their imports from where they are. */
    realpath?(p: string): string;
}
export interface ResolveOptions {
    conditions: string[];
    extensions: string[];
    /** Honour package.json "browser" field. */
    browser?: boolean;
    mainFields: string[];
}
export declare const BROWSER_OPTS: ResolveOptions;
export declare const NODE_OPTS: ResolveOptions;
export interface PackageJson {
    name?: string;
    version?: string;
    main?: string;
    module?: string;
    browser?: string | Record<string, string | false>;
    exports?: unknown;
    imports?: unknown;
    type?: string;
    bin?: string | Record<string, string>;
    [k: string]: unknown;
}
export declare class ResolveError extends Error {
    code: string;
}
/** Result `false` means the module is intentionally empty (browser field mapping). */
export type Resolved = string | false;
export declare function readPackageJson(fs: ResolveFs, dir: string): PackageJson | null;
export declare function clearPackageCache(fs: ResolveFs): void;
/** Find nearest package.json dir at or above `dir`. */
export declare function findPackageRoot(fs: ResolveFs, dir: string): string | null;
export declare function isBuiltinLike(spec: string): boolean;
export declare function isBare(spec: string): boolean;
export declare function splitBare(spec: string): {
    name: string;
    sub: string;
};
export declare function resolveModule(fs: ResolveFs, spec: string, fromDir: string, opts: ResolveOptions): Resolved;
/** Resolve `sub` ('' for main) within an installed package dir. null if nothing found. */
export declare function resolvePackage(fs: ResolveFs, pkgDir: string, sub: string, opts: ResolveOptions): Resolved | null;
/** Match package.json exports/imports against a subpath ('.' or './x'). */
export declare function matchExports(exp: unknown, sub: string, conditions: string[]): string | null;
