export declare const sep = "/";
export declare const delimiter = ":";
export declare function isAbsolute(p: string): boolean;
export declare function normalize(p: string): string;
export declare function join(...parts: string[]): string;
/** Set the cwd provider used by resolve() (node worker sets process.cwd). */
export declare function setCwd(fn: () => string): void;
export declare function resolve(...parts: string[]): string;
export declare function dirname(p: string): string;
export declare function basename(p: string, ext?: string): string;
export declare function extname(p: string): string;
export declare function relative(from: string, to: string): string;
export interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
}
export declare function parse(p: string): ParsedPath;
export declare function format(o: Partial<ParsedPath>): string;
export declare function toNamespacedPath(p: string): string;
declare const path: {
    sep: string;
    delimiter: string;
    isAbsolute: typeof isAbsolute;
    normalize: typeof normalize;
    join: typeof join;
    resolve: typeof resolve;
    dirname: typeof dirname;
    basename: typeof basename;
    extname: typeof extname;
    relative: typeof relative;
    parse: typeof parse;
    format: typeof format;
    toNamespacedPath: typeof toNamespacedPath;
    posix: unknown;
    win32: unknown;
};
export default path;
