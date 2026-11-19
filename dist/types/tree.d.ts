import type { VFS } from './vfs';
export interface FileNodeTree {
    file: {
        contents: string | Uint8Array;
    };
}
export interface SymlinkNodeTree {
    file: {
        symlink: string;
    };
}
export interface DirectoryNodeTree {
    directory: FileSystemTree;
}
export interface FileSystemTree {
    [name: string]: FileNodeTree | SymlinkNodeTree | DirectoryNodeTree;
}
export declare function mountTree(fs: VFS, tree: FileSystemTree, at: string): void;
export declare function exportTree(fs: VFS, dir: string, excludes?: RegExp[], rel?: string): FileSystemTree;
/** Convert a glob ('**', '*', '?', '{a,b}') to an anchored RegExp over relative POSIX paths. */
export declare function globToRegExp(glob: string): RegExp;
