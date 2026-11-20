export interface ModuleNode {
    importers: Set<string>;
    imports: Set<string>;
    /** 'self' = accepts its own updates (React Refresh boundary / plain CSS); 'link' = `<link rel=stylesheet>`. */
    accept: 'self' | 'link' | null;
    kind: 'js' | 'css';
    /**
     * `import.meta.hot.accept(...)` calls in the module: itself (`accept()` / `accept(cb)`), and/or these imports.
     * `auto`: a self-accept the dev server added (Preact refresh boundary): not for entries, like React's.
     */
    hot?: {
        self: boolean;
        deps: Set<string>;
        auto?: boolean;
    };
}
export interface HmrUpdate {
    /** 'hot': an `import.meta.hot` boundary (`accepted` is the module to re-import: the boundary itself, or a dep it accepts) */
    kind: 'js' | 'css' | 'css-link' | 'hot';
    /** VFS path of the boundary module */
    file: string;
    accepted?: string;
}
export declare class ModuleGraph {
    readonly nodes: Map<string, ModuleNode>;
    /** html file -> the module scripts it loads (entries are never refresh boundaries: re-running them re-mounts the app) */
    private entries;
    setEntries(html: string, files: Iterable<string>): void;
    isEntry(file: string): boolean;
    /** Forget everything page-scoped (a full reload): the new page's requests rebuild it. */
    reset(): void;
    /** Drop a deleted/renamed module: its node and the edges pointing at it. */
    remove(file: string): void;
    ensure(file: string, kind?: ModuleNode['kind']): ModuleNode;
    /** Replace a module's import edges (after a successful transform). */
    setImports(file: string, imports: Iterable<string>): void;
    /**
     * Walk importers from a changed file up to accepting boundaries. Returns the boundaries plus every module on the
     * way (they must be re-executed, i.e. re-imported with a fresh timestamp), or null when some path reaches a module
     * nobody accepts for (an entry script, index.html, unknown file) or only cycles back on itself: the caller falls
     * back to a full reload. An `import.meta.hot` boundary may be an entry: it opted in.
     */
    propagate(file: string): {
        updates: HmrUpdate[];
        chain: Set<string>;
    } | null;
    /**
     * `import.meta.hot.invalidate()` from `file` (already re-run with its new code): its importers are updated instead,
     * as if they had changed. null: a full reload (no importers, or one no boundary accepts for).
     */
    invalidate(file: string): {
        updates: HmrUpdate[];
        chain: Set<string>;
    } | null;
}
/** Dedupe key: a boundary can accept several of its imports in one flush. */
export declare const updateKey: (u: HmrUpdate) => string;
