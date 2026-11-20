export declare const REFRESH_RUNTIME_URL = "/@cresslet/react-refresh";
export declare const REFRESH_UTILS_URL = "/@cresslet/refresh";
/** Preact: the same registration pass, against prefresh (@prefresh/core, served with its `preact` import shared). */
export declare const PREFRESH_CORE_URL = "/@cresslet/prefresh-core";
export declare const PREFRESH_UTILS_URL = "/@cresslet/prefresh";
export interface RefreshResult {
    code: string;
    /** All exports look like components: the module can accept its own updates. */
    boundary: boolean;
    registered: string[];
}
/** Exported name -> local name from the trailing `export { a, b as c }` clause; null if there are other export forms. */
export declare function parseExports(code: string): Map<string, string> | null;
/**
 * `utilsUrl`: the registration module (React's, or prefresh's). `hot`: the module's `import.meta.hot` binding; a
 * boundary then accepts itself through it (Preact), flushing prefresh or invalidating when its exports changed.
 */
export declare function refreshTransform(code: string, id: string, utilsUrl?: string, hot?: string): RefreshResult;
/** Browser module served at REFRESH_UTILS_URL; also loaded first by the HTML so it hooks React before react-dom runs. */
export declare function refreshUtilsCode(): string;
/**
 * Browser module served at PREFRESH_UTILS_URL (loaded first by the HTML, so prefresh hooks Preact's options before the
 * app renders): the registration API refreshTransform emits, over prefresh's `self.__PREFRESH__`. Boundaries
 * accept themselves through `import.meta.hot` and call `flush()` (or invalidate when their exports changed).
 */
export declare function prefreshUtilsCode(): string;
/** prefresh's runtime (bundled with \`preact\` external) with its imports pointed at the app's optimized Preact. */
export declare function prefreshCoreModule(bundle: string): string;
/** Wrap react-refresh's CJS runtime as an ES module. */
export declare function refreshRuntimeModule(cjs: string): string;
