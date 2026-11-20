import * as esbuild from './vendor/esbuild-wasm';
import type { BuildOptions, Loader, Plugin } from './vendor/esbuild-wasm';
import type { VFS } from './vfs';
import { type ResolveOptions } from './resolve';
export type { BuildOptions, BuildResult, Plugin, Loader, Metafile, OutputFile } from './vendor/esbuild-wasm';
export declare const ESBUILD_VERSION: string;
export declare const DEFAULT_WASM_URL: string;
export declare function loadEsbuild(wasmURL?: string): Promise<typeof esbuild>;
export declare const LOADERS: Record<string, Loader>;
export declare function loaderFor(path: string): Loader;
export declare const isNodeBuiltin: (s: string) => boolean;
export interface VfsPluginOptions {
    resolve?: ResolveOptions;
    /** Return a path to mark external (string), or undefined to resolve normally. */
    external?: (spec: string, importer: string, kind: string) => string | undefined | false;
    /** Node builtins: 'empty' (browser shim) or 'external'. */
    builtins?: 'empty' | 'external';
    /** Post-process every loaded stylesheet (PostCSS / Tailwind). */
    transformCss?: (path: string, css: string) => Promise<string>;
}
/** Resolve + load everything from the VFS. */
export declare function vfsPlugin(vfs: VFS, opts?: VfsPluginOptions): Plugin;
export declare function splitQuery(p: string): [string, string];
/** Run esbuild over the VFS. Paths in entryPoints are resolved against `cwd`. */
export declare function bundleVfs(vfs: VFS, options: BuildOptions & {
    cwd?: string;
    wasmURL?: string;
    vfsPlugin?: VfsPluginOptions;
}): Promise<esbuild.BuildResult & {
    outputFiles: esbuild.OutputFile[];
}>;
export declare function formatErrors(e: unknown): string;
