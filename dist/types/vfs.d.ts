export type WatchEvent = 'change' | 'rename';
export type WatchListener = (event: WatchEvent, filename: string) => void;
interface Base {
    mtime: number;
    ctime: number;
}
export interface FileNode extends Base {
    type: 'file';
    data: Uint8Array;
}
export interface DirNode extends Base {
    type: 'dir';
    children: Map<string, Node>;
}
export interface SymlinkNode extends Base {
    type: 'symlink';
    target: string;
}
export type Node = FileNode | DirNode | SymlinkNode;
export interface Stats {
    type: 'file' | 'dir' | 'symlink';
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    mode: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
export declare class FsError extends Error {
    code: string;
    path: string;
    constructor(code: string, op: string, path: string);
    get errno(): number;
    get syscall(): string;
}
export declare const toBytes: (d: string | Uint8Array) => Uint8Array;
export declare const toText: (d: Uint8Array) => string;
export declare function makeStats(n: Node): Stats;
export declare class VFS {
    root: DirNode;
    private watchers;
    private split;
    /** Resolve a path to its node. followLast=false returns a symlink itself. */
    private lookup;
    private parentOf;
    exists(p: string): boolean;
    stat(p: string): Stats;
    lstat(p: string): Stats;
    isFile(p: string): boolean;
    isDir(p: string): boolean;
    readFile(p: string): Uint8Array;
    readText(p: string): string;
    /** Returns file text or null (no throw). */
    tryReadText(p: string): string | null;
    readdir(p: string): string[];
    readdirEntries(p: string): Dirent[];
    readlink(p: string): string;
    realpath(p: string): string;
    mkdir(p: string, opts?: {
        recursive?: boolean;
    }): void;
    writeFile(p: string, data: string | Uint8Array, opts?: {
        mkdirp?: boolean;
        append?: boolean;
    }): void;
    symlink(target: string, p: string): void;
    rm(p: string, opts?: {
        recursive?: boolean;
        force?: boolean;
    }): void;
    unlink(p: string): void;
    rmdir(p: string): void;
    rename(from: string, to: string): void;
    copyFile(from: string, to: string): void;
    /** Recursively copy a file or directory. */
    cp(from: string, to: string): void;
    utimes(p: string, mtime: number): void;
    /** Walk all files under dir (absolute paths). */
    walk(dir: string, skip?: (path: string, isDir: boolean) => boolean): Generator<string>;
    watch(path: string, opts: {
        recursive?: boolean;
    }, fn: WatchListener): {
        close(): void;
    };
    private emit;
}
export {};
