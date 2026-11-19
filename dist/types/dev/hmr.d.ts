export interface ModuleNode {
    importers: Set<string>;
    imports: Set<string>;
    /** 'self' = accepts its own updates (React Refresh boundary / plain CSS); 'link' = `<link rel=stylesheet>`. */
    accept: 'self' | 'link' | null;
    kind: 'js' | 'css';
}
export interface HmrUpdate {
    kind: 'js' | 'css' | 'css-link';
    /** VFS path of the boundary module */
    file: string;
}
export declare class ModuleGraph {
    readonly nodes: Map<string, ModuleNode>;
    ensure(file: string, kind?: ModuleNode['kind']): ModuleNode;
    /** Replace a module's import edges (after a successful transform). */
    setImports(file: string, imports: Iterable<string>): void;
    /**
     * Walk importers from a changed file up to accepting boundaries. Returns the boundaries plus every module on the
     * way (they must be re-executed, i.e. re-imported with a fresh timestamp), or null when some path reaches a module
     * nobody accepts for (an entry script, index.html, unknown file): the caller falls back to a full reload.
     */
    propagate(file: string): {
        updates: HmrUpdate[];
        chain: Set<string>;
    } | null;
}
