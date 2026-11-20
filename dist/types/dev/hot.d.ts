export declare const HOT_ID = "__cresslet_hot";
export declare const CLIENT_URL = "/@cresslet/client";
/** Whether a module's source uses the API (cheap text check before the transform). */
export declare const usesHot: (source: string) => boolean;
/** Banner that creates the module's hot context (`url`: its path, no query). */
export declare function hotBanner(url: string): string;
export interface HotAccepts {
    code: string;
    /** `accept()` / `accept(cb)`: the module accepts its own updates */
    self: boolean;
    /** resolved deps of `accept(dep, cb)` / `accept([deps], cb)` */
    deps: string[];
}
/**
 * Find the `accept` calls in esbuild output and resolve their dep specifiers: `resolve(spec)` returns
 * `{ file, url }` (the URL replaces the literal) or null (left as-is; no update reaches it).
 */
export declare function analyzeHot(code: string, resolve: (spec: string) => {
    file: string;
    url: string;
} | null): HotAccepts;
