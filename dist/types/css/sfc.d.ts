import type { Plugin } from '../vendor/esbuild-wasm';
import type { Container } from '../container';
import type { CssPipeline, SfcResult } from './pipeline';
/** Modules compiled as components: `.vue`, `.svelte`, and Svelte's rune modules `.svelte.js` / `.svelte.ts`. */
export declare const SFC_RE: RegExp;
/** A short stable id for a component file (Vue's HMR / scope id), from its root-relative URL. */
export declare function sfcId(url: string): string;
export interface SfcCompileOptions {
    root: string;
    file: string;
    hmrId: string;
    session: string;
    env: 'development' | 'production';
    tsconfigRaw?: unknown;
}
/**
 * Compile one component file in the CSS worker (retried once if a CSS config change restarted it). A `.svelte.ts`
 * module has its TypeScript stripped first (Svelte's `compileModule` takes JavaScript).
 */
export declare function compileSfc(c: Pick<Container, 'vfs' | 'cssWorker' | 'cssPlugins' | 'esbuildWasmUrl'>, o: SfcCompileOptions): Promise<SfcResult>;
export interface SfcStyles {
    css: string[];
    /** files the PostCSS / Tailwind output depends on (stylesheets, configs, plugins) */
    deps: string[];
    dirs: string[];
    /** the Tailwind scanners whose candidates the output was built from */
    scanners: string[];
}
/**
 * The pipeline's name for a component's style block `i`: a stylesheet beside the component (the worker made a `src=`
 * sheet's relative `url()`s and Tailwind directives relative to the component).
 */
export declare const styleFile: (file: string, i: number) => string;
/** Run a component's style blocks through the CSS pipeline (PostCSS / Tailwind, when the project uses them). */
export declare function processSfcStyles(pipe: CssPipeline, file: string, styles: string[]): Promise<SfcStyles>;
/**
 * Dev: relative `url()`s the pipeline added (Tailwind / PostCSS output: relative to the component, like the build's) made
 * root-relative for a `<style>` on the page. The worker already did this for the component's own.
 */
export declare function pageUrls(css: string, dir: string, toUrl: (abs: string) => string, wasmURL?: string): Promise<string>;
/**
 * Dev: a component's styles go in `<style>`s it owns, one per block (an `@import` must start its sheet), in order.
 * Its previous copy's extra ones are removed; a new one goes right after the component's others (or at the end of
 * `<head>`, for its first). It runs after the module body: a module that throws as it runs leaves the old styles.
 */
export declare function injectStyles(id: string, sheets: string[]): string;
/**
 * Build: compile `.vue` / `.svelte` / `.svelte.js` files in production mode. Each style block is a CSS module the
 * component imports (PostCSS / Tailwind, then esbuild bundles it with its `url()`s, into the entry's stylesheet).
 */
export declare function sfcBuildPlugin(c: Container, root: string, pipe: CssPipeline, tsconfigRaw?: unknown): Plugin;
