export declare const REFRESH_RUNTIME_URL = "/@cresslet/react-refresh";
export declare const REFRESH_UTILS_URL = "/@cresslet/refresh";
export interface RefreshResult {
    code: string;
    /** All exports look like components: the module can accept its own updates. */
    boundary: boolean;
    registered: string[];
}
/** Exported name -> local name from the trailing `export { a, b as c }` clause; null if there are other export forms. */
export declare function parseExports(code: string): Map<string, string> | null;
export declare function refreshTransform(code: string, id: string): RefreshResult;
/** Browser module served at REFRESH_UTILS_URL; also loaded first by the HTML so it hooks React before react-dom runs. */
export declare function refreshUtilsCode(): string;
/** Wrap react-refresh's CJS runtime as an ES module. */
export declare function refreshRuntimeModule(cjs: string): string;
