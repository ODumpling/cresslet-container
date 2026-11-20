import type { VFS } from '../vfs';
import { type ResolveFs } from '../resolve';
export interface DepsResult {
    id: number;
    /** spec -> output text */
    entries: Map<string, string>;
    /** chunk file name -> text */
    chunks: Map<string, string>;
    errors: Map<string, string>;
}
export declare class DepOptimizer {
    private vfs;
    private fs;
    private root;
    private opts;
    private specs;
    private current;
    private builtFor;
    private buildId;
    private timer;
    private pendingResolve;
    /** Called when already-served modules became stale (page must reload). */
    onStale?: () => void;
    private lastServed;
    constructor(vfs: VFS, fs: ResolveFs, root: string, opts: {
        wasmURL?: string;
        define: Record<string, string>;
        conditions?: string[];
        preprocess?: (file: string, text: string) => Promise<string>;
    });
    has(spec: string): boolean;
    /** Add specs (e.g. from the initial scan) without serving. */
    add(specs: Iterable<string>): void;
    invalidate(): void;
    get(spec: string): Promise<{
        code: string;
    } | {
        error: string;
    }>;
    chunk(name: string): Promise<string | undefined>;
    private markServed;
    private result;
    private schedule;
    private build;
    /** Named exports of a CJS module, following `module.exports = require(...)` re-exports. */
    private cjsExports;
}
/** Collect bare imports reachable from entry files (vite-like dependency scan). */
export declare function scanImports(vfs: VFS, root: string, entries: string[], opts: {
    wasmURL?: string;
    jsx?: Record<string, string>;
    resolveLocal: (spec: string, importer: string) => string | null;
}): Promise<Set<string>>;
