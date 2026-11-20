import type { Container } from '../container';
import type { VFS } from '../vfs';
import { CandidateScanner, type SourceRoot, type SourceSpec } from './scan';
/** CSS that needs Tailwind (keep in sync with TAILWIND_RE in worker.cjs). */
export declare const TAILWIND_RE: RegExp;
export declare const POSTCSS_CONFIGS: string[];
/** Files whose change re-detects the CSS mode (and restarts the worker). */
export declare const CSS_CONFIG_RE: RegExp;
export interface CssRequest {
    root: string;
    file: string;
    css: string;
    candidates: string[];
    postcssConfig: string | null;
    env: 'development' | 'production';
}
export interface CssResult {
    css: string;
    /** absolute paths the output depends on (Tailwind imports/plugins/configs, PostCSS `dependency` messages) */
    deps: string[];
    /** directories whose files the output depends on (PostCSS `dir-dependency`, e.g. Tailwind v3 content globs) */
    dirs: string[];
    /** one entry per Tailwind compile that ran: its `@source`s and `source(...)` root */
    tailwind: {
        sources: SourceSpec[];
        root: SourceRoot;
    }[];
    warnings: string[];
}
/** Where requests run: the node worker in the container; in-process in tests. */
export interface CssBackend {
    process(req: CssRequest): Promise<CssResult>;
    /** Drop the worker (plugins/config changed); the next request starts a fresh one. */
    restart(): void;
}
export interface CssMode {
    postcssConfig: string | null;
    tailwind: boolean;
}
export declare function detectCssMode(vfs: VFS, root: string): CssMode;
export interface CssProcessed {
    css: string;
    deps: string[];
    dirs: string[];
    /** output depends on project sources (Tailwind content scanning): re-process when they bring new candidates */
    content: boolean;
}
export declare class CssPipeline {
    private c;
    private root;
    private env;
    mode: CssMode;
    scanner: CandidateScanner;
    constructor(c: Pick<Container, 'vfs' | 'cssWorker'>, root: string, env: CssRequest['env']);
    get active(): boolean;
    /** Re-detect after package.json / PostCSS config / node_modules changes. */
    reset(): void;
    needs(text: string): boolean;
    process(file: string, css: string): Promise<CssProcessed>;
    private newScanner;
}
/** The container's CSS worker: one `node` process, started on first use, JSON lines over stdin/stdout. */
export declare function nodeCssBackend(c: Container): CssBackend & {
    close(): void;
};
