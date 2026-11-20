import type { VFS } from '../vfs';
/** Class-candidate tokens in a source file. */
export declare function extractCandidates(text: string, into?: Set<string>): Set<string>;
export interface SourceSpec {
    base: string;
    pattern: string;
    negated: boolean;
}
/** compile()'s `root`: null = auto-detect from the project root, 'none' = `source(none)`, or `source("dir")`. */
export type SourceRoot = null | 'none' | {
    base: string;
    pattern: string;
};
/** Minimal glob -> RegExp (`**`, `*`, `?`, `{a,b}`), matched against an absolute path. */
export declare function globToRegExp(glob: string): RegExp;
/** The union of every Tailwind stylesheet's sources, and the candidates found in them (only ever grows, like Tailwind). */
export declare class CandidateScanner {
    private vfs;
    private root;
    private scopes;
    private excludes;
    private keys;
    private files;
    readonly candidates: Set<string>;
    private scanned;
    constructor(vfs: VFS, root: string);
    /** Add a stylesheet's sources; returns true when that widened the scan (callers must re-request with candidates()). */
    addSources(root: SourceRoot, sources: SourceSpec[]): boolean;
    /** Every candidate in every source file (scans lazily, once). */
    all(): string[];
    /** Whether a changed file is a source; re-extracts it. Returns true when it brought new candidates. */
    update(file: string): boolean;
    private extract;
    private inScope;
    private isSource;
    private autoSkips;
    private walk;
}
