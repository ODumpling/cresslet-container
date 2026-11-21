import type { Plugin } from '../vendor/esbuild-wasm';
import type { Container } from '../container';
import { type ProjectConfig } from '../dev/project';
export interface BuildOptions {
    root?: string;
    outDir?: string;
    minify?: boolean;
    sourcemap?: boolean;
}
export declare function pathsPlugin(c: Container, cfg: ProjectConfig, resolve?: {
    conditions: string[];
    extensions: string[];
    browser?: boolean;
    mainFields: string[];
}): Plugin;
export declare function build(c: Container, o?: BuildOptions): Promise<{
    files: string[];
}>;
