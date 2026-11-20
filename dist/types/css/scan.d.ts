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
/** One stylesheet's source rules: one entry per Tailwind compile it ran (usually one). */
export type SourceRules = {
    root: SourceRoot;
    sources: SourceSpec[];
}[];
export declare const rulesKey: (rules: SourceRules) => string;
/** Minimal glob -> RegExp (`**`, `*`, `?`, `{a,b}`), matched against an absolute path. */
export declare function globToRegExp(glob: string): RegExp;
/** One set of source rules (a stylesheet's), and the candidates found in its sources (only ever grows, like Tailwind). */
export declare class CandidateScanner {
    private vfs;
    private root;
    /** Unique per scanner: names its candidate set in the CSS worker. */
    readonly id: number;
    private scopes;
    private excludes;
    private files;
    readonly candidates: Set<string>;
    /** Bumped when a changed file brings new candidates after the scan (a build that read the old set is stale). */
    revision: number;
    private scan;
    private done;
    constructor(vfs: VFS, root: string, rules?: SourceRules);
    /** Every candidate in every source file (scans once, lazily, yielding between slices of a large tree). */
    all(): Promise<string[]>;
    /**
     * A file changed: re-extract it if it's a source. Applies as soon as the scan has started (the walk skips files this
     * already read); before that the scan will read it. Returns true when it brought new candidates.
     */
    update(file: string): boolean;
    private read;
    private extract;
    private inScope;
    private isSource;
    private walkAll;
    private visitFile;
}
