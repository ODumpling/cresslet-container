export interface TarEntry {
    path: string;
    type: 'file' | 'dir' | 'symlink';
    data: Uint8Array;
    linkname?: string;
    mode: number;
}
/** Parse an uncompressed tar archive. `strip` removes leading path components. */
export declare function untar(buf: Uint8Array, strip?: number): TarEntry[];
export declare function gunzip(data: Uint8Array): Promise<Uint8Array>;
export declare function gzip(data: Uint8Array): Promise<Uint8Array>;
/** Build a tar archive (used by tests and `npm pack`-style helpers). */
export declare function tar(files: {
    path: string;
    data: string | Uint8Array;
    linkname?: string;
}[]): Uint8Array;
