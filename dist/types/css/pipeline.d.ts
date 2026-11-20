import type { Container } from '../container';
import type { VFS } from '../vfs';
import { type SourceRules } from './scan';
/** CSS that needs Tailwind (keep in sync with TAILWIND_RE in worker.cjs). */
export declare const TAILWIND_RE: RegExp;
/** Stylesheets a preprocessor compiles first: Sass (`sass`) and Less (`less`), from the project's deps (keep in sync with worker.cjs). */
export declare const PREPROCESSED_RE: RegExp;
/** Every stylesheet extension the dev server and build treat as CSS. */
export declare const STYLE_RE: RegExp;
/** CSS modules: `*.module.css`, `*.module.scss`, ... (class names are exports). */
export declare const CSS_MODULE_RE: RegExp;
export declare const POSTCSS_CONFIGS: string[];
/** Files whose change re-detects the CSS mode (and restarts the worker). */
export declare const CSS_CONFIG_RE: RegExp;
export interface CssRequest {
    root: string;
    file: string;
    css: string;
    /** Every candidate for this stylesheet (the backend sends the worker only what it hasn't seen for `candidateSet`). */
    candidates: string[];
    /** Names an append-only candidate set (one per scanner): the worker accumulates it across requests. */
    candidateSet?: string;
    /** Owner of the worker-side state (compilers, candidate sets): a dev server, or one build. */
    session?: string;
    /** Only report the stylesheet's Tailwind source rules (no utilities built): the caller then scans those sources. */
    discover?: boolean;
    postcssConfig: string | null;
    env: 'development' | 'production';
    /** The project depends on Tailwind: a PostCSS config without a Tailwind plugin still gets v4 compiled. */
    tailwind?: boolean;
    /** false: project code (`@plugin`, `@config`) is not run (`boot({ cssPlugins: false })`). */
    plugins?: boolean;
}
export interface CssResult {
    css: string;
    /** absolute paths the output depends on (Tailwind imports/plugins/configs, PostCSS `dependency` messages) */
    deps: string[];
    /** directories whose files the output depends on (PostCSS `dir-dependency`, e.g. Tailwind v3 content globs) */
    dirs: string[];
    /** one entry per Tailwind compile that ran: its `@source`s and `source(...)` root */
    tailwind: SourceRules;
    warnings: string[];
}
/**
 * A failed request: what the compile had read (or tried to) before it failed, so changing/creating those retries it.
 * `restarted`: a restart (config/plugins changed) cut it off; the caller sends it again with its current mode.
 */
export type CssError = Error & {
    deps?: string[];
    dirs?: string[];
    restarted?: boolean;
};
/** A `.vue` / `.svelte` module for the dev server, compiled by the same worker with the project's own compiler. */
export interface SfcRequest {
    root: string;
    file: string;
    source: string;
    /** stable per-file id (Vue's HMR id / scope id); not `id`, which numbers the worker's messages */
    hmrId: string;
    session?: string;
    /** false: `boot({ cssPlugins: false })` (Less `@plugin` in a `<style lang="less">` block is refused) */
    plugins?: boolean;
}
export interface SfcResult {
    /** ES module code (TypeScript when `lang` is 'ts'), with `import.meta.hot` handling */
    code: string;
    lang: 'js' | 'ts';
    /** other files the output depends on (Sass/Less imports of `<style>` blocks) */
    deps: string[];
    warnings: string[];
}
/** Where requests run: the node worker in the container; in-process in tests. */
export interface CssBackend {
    process(req: CssRequest): Promise<CssResult>;
    compile?(req: SfcRequest): Promise<SfcResult>;
    /** Drop the worker (plugins/config changed); the next request starts a fresh one. */
    restart(): void;
    /** Forget a session's worker-side state (its dev server closed / its build finished). */
    release?(session: string): void;
}
export interface CssMode {
    postcssConfig: string | null;
    tailwind: boolean;
}
export declare function detectCssMode(vfs: VFS, root: string, plugins?: boolean): CssMode;
export interface CssProcessed {
    css: string;
    deps: string[];
    dirs: string[];
    /** the scanner (source rules key) whose candidates the output was built from: re-process when it grows; null: none */
    scanner: string | null;
}
export declare class CssPipeline {
    private c;
    private root;
    private env;
    mode: CssMode;
    /** Names this pipeline's state in the worker: a build gets a fresh one (no classes from dev or earlier builds). */
    readonly session: string;
    /** One scanner per distinct set of source rules: stylesheets with different `@source`/`source()` don't mix. */
    private scanners;
    /** Last source rules seen per stylesheet (for its text): known before its first candidate build. null: no Tailwind v4. */
    private rules;
    /** Bumped whenever a scanner gains candidates (a build that read the old ones is stale). */
    revision: number;
    private plugins;
    private released;
    /** Bumped by reset(): a request prepared under an older mode is prepared again. */
    private generation;
    constructor(c: Pick<Container, 'vfs' | 'cssWorker'> & {
        cssPlugins?: boolean;
    }, root: string, env: CssRequest['env']);
    /** Re-detect after package.json / PostCSS config / node_modules changes. */
    reset(): void;
    /** Free this pipeline's worker-side state. */
    release(): void;
    /** Whether a stylesheet goes to the worker: Sass/Less always (compiled there), CSS for PostCSS/Tailwind. */
    needs(file: string, text: string): boolean;
    /** A project file changed: the scanners whose candidates it grew (their stylesheets need re-serving). */
    update(file: string): string[];
    process(file: string, css: string): Promise<CssProcessed>;
    private scannerFor;
}
/** A running CSS worker: JSON lines in, output to the `io` callbacks. */
export interface CssWorkerProcess {
    write(line: string): void;
    kill(): void;
    exited: Promise<number>;
}
export type CssWorkerSpawn = (io: {
    stdout(s: string): void;
    stderr(s: string): void;
}) => CssWorkerProcess;
/**
 * The container's CSS worker: one `node` process, started on first use, JSON lines over stdin/stdout. It handles
 * requests in order; the one it is on has a timeout (the worker is recycled, the others are retried once on a new
 * one). A restart rejects pending requests as `restarted` (the pipeline sends them again with its new mode). Candidate
 * sets go over as deltas (per worker instance: a new worker gets the whole set).
 */
export declare function nodeCssBackend(c: Container, o?: {
    timeoutMs?: number;
    spawn?: CssWorkerSpawn;
}): CssBackend & {
    close(): void;
};
