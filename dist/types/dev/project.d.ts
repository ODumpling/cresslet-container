import type { VFS } from '../vfs';
export declare function parseJsonc(text: string): unknown;
export declare function parseDotenv(text: string): Record<string, string>;
/** Vite-style env: .env, .env.local, .env.[mode], .env.[mode].local; only VITE_* exposed. */
export declare function loadEnv(vfs: VFS, root: string, mode: string, prefix?: string): Record<string, string | boolean>;
export declare function envDefines(env: Record<string, string | boolean>): Record<string, string>;
export interface ProjectConfig {
    jsx: 'automatic' | 'transform' | 'preserve';
    jsxImportSource: string;
    jsxFactory?: string;
    jsxFragment?: string;
    /** tsconfig `paths` as [prefix, replacement dirs] with '*' wildcard support */
    paths: {
        pattern: string;
        targets: string[];
    }[];
    tsconfigRaw: Record<string, unknown>;
    /** React DOM project with React JSX: enable React Fast Refresh in the dev server. */
    refresh: boolean;
}
export declare function readProjectConfig(vfs: VFS, root: string): ProjectConfig;
/** Apply tsconfig paths; returns candidate absolute paths (unresolved) or null. */
export declare function matchPaths(cfg: ProjectConfig, spec: string): string[] | null;
export declare function jsxOptions(cfg: ProjectConfig): {
    jsx: "automatic";
    jsxImportSource: string;
    jsxFactory?: undefined;
    jsxFragment?: undefined;
} | {
    jsx: "transform";
    jsxFactory: string;
    jsxFragment: string;
    jsxImportSource?: undefined;
};
export declare const mimeType: (p: string) => string;
export declare const SCRIPT_EXT: RegExp;
export declare const ASSET_EXT: RegExp;
