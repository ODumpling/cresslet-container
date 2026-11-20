import { VFS, type Dirent, type Stats } from './vfs';
import { type FileSystemTree } from './tree';
import { PortTable, type PortHandler } from './ports';
import { type Command, type CommandContext, type ContainerProcess, type SpawnOptions } from './process';
import { type Registry } from './npm/registry';
import { type ResolveFs } from './resolve';
import { type BuildOptions as EsbuildOptions } from './esbuild';
import { type DevServerHandle, type DevServerOptions } from './dev/server';
import { type BuildOptions } from './build/build';
import { type CssBackend } from './css/pipeline';
import { type NodeChannel, type ProjectWorker } from './node/channel';
export interface BootOptions {
    /** Service worker URL served by the host at its origin root. Default '/cresslet-sw.js'. `false` disables previews. */
    serviceWorkerUrl?: string | false;
    /** esbuild.wasm URL (must match esbuild-wasm version). Default: jsDelivr. */
    esbuildWasmUrl?: string;
    /** npm registry base. Default 'https://registry.npmjs.org'. */
    registry?: string;
    /** Project directory. Default '/home/project'. */
    workdir?: string;
    /** Persist npm tarballs + packuments in IndexedDB across reloads. Default true; silently off if IndexedDB is unavailable. */
    npmCache?: boolean;
    /**
     * Serve previews from this origin (e.g. 'https://preview.example.com') instead of the host page's, so preview code
     * can't read the host's storage. The container frames `${previewOrigin}/cresslet-relay.html`, which registers
     * `${previewOrigin}/cresslet-sw.js` and also runs `node` processes (server code, npm bins, the CSS worker) on that
     * origin; `serviceWorkerUrl` is then unused (`false` disables previews, and then `node` / `projectWorker` fail to start).
     * Unset (or equal to the page's origin): previews share the host origin.
     */
    previewOrigin?: string;
    /**
     * Run project code when processing CSS: PostCSS configs (and their plugins), Tailwind `@plugin` / `@config`.
     * Default true. `false`: PostCSS configs are ignored and `@plugin`/`@config` fail; Tailwind v4 itself still compiles.
     */
    cssPlugins?: boolean;
}
export interface ContainerEvents {
    'server-ready': (port: number, url: string) => void;
    port: (port: number, type: 'open' | 'close', url: string) => void;
    error: (error: {
        message: string;
    }) => void;
}
export interface FsApi {
    readFile(path: string): Promise<Uint8Array>;
    readFile(path: string, encoding: 'utf8' | 'utf-8'): Promise<string>;
    readFile(path: string, encoding?: 'utf8' | 'utf-8'): Promise<Uint8Array | string>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readdir(path: string, opts: {
        withFileTypes: true;
    }): Promise<Dirent[]>;
    readdir(path: string, opts?: {
        withFileTypes?: boolean;
    }): Promise<string[] | Dirent[]>;
    mkdir(path: string, opts?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, opts?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<Stats>;
    exists(path: string): Promise<boolean>;
    watch(path: string, opts: {
        recursive?: boolean;
    }, cb: (event: 'change' | 'rename', filename: string) => void): {
        close(): void;
    };
}
export interface CommandRegistrationContext extends CommandContext {
}
export interface BundleOptions extends EsbuildOptions {
}
export interface BundleResult {
    outputFiles: {
        path: string;
        text: string;
        contents: Uint8Array;
    }[];
    errors: unknown[];
    warnings: unknown[];
    metafile?: unknown;
}
/** Where the dev server sends live-reload / HMR / overlay notifications for its previews. */
export interface PreviewChannel {
    postMessage(message: unknown): void;
    close(): void;
}
export declare class Container {
    readonly instanceId: string;
    readonly workdir: string;
    /** Synchronous in-memory file system (advanced use). */
    readonly vfs: VFS;
    readonly ports: PortTable;
    readonly registry: Registry;
    readonly esbuildWasmUrl: string;
    readonly resolveFs: ResolveFs;
    readonly fs: FsApi;
    /** Origin previews are served from when it differs from the page's (`boot({ previewOrigin })`), else null. */
    readonly previewOrigin: string | null;
    /** Whether CSS processing runs project code (`boot({ cssPlugins })`). */
    readonly cssPlugins: boolean;
    private relayPort;
    /** Whether the relay connected at boot (previews, and `node`, run on the preview origin). */
    private relayBooted;
    /** The current relay connection once it's ready (set up its service worker and message handler), else rejected. */
    private relayConn;
    /** The relay port the node worker script was last sent on. */
    private relayScriptPort;
    /** Kill switches of `node` processes and project workers running in the relay (they die with its document). */
    private relayProcs;
    private listeners;
    private commands;
    private procs;
    private cleanups;
    private torndown;
    private constructor();
    /** Boot a container. Registers the preview service worker (unless disabled). */
    static boot(opts?: BootOptions): Promise<Container>;
    on<E extends keyof ContainerEvents>(event: E, fn: ContainerEvents[E]): () => void;
    private emit;
    /** Resolve a path against the workdir. */
    path(p: string): string;
    private makeFs;
    mount(tree: FileSystemTree, opts?: {
        mountPoint?: string;
    }): Promise<void>;
    export(path: string, opts?: {
        excludes?: string[];
    }): Promise<FileSystemTree>;
    registerCommand(name: string, fn: Command): () => void;
    defaultEnv(): Record<string, string>;
    spawn(cmd: string, args?: string[], opts?: SpawnOptions): Promise<ContainerProcess>;
    /** Locate a command: registered, builtin, bundled or on PATH. */
    which(name: string, cwd: string, env: Record<string, string | undefined>): string | null;
    /** Run a command by name in an existing context (used by jsh, npm run, …). */
    exec(name: string, ctx: CommandContext): Promise<number>;
    private runFile;
    servePort(port: number, handler: PortHandler): {
        url: string;
        close(): void;
    };
    createDevServer(opts?: DevServerOptions): Promise<DevServerHandle>;
    build(opts?: BuildOptions): Promise<{
        files: string[];
    }>;
    /** esbuild over the VFS. Relative entry points resolve against workdir. */
    bundle(options: BundleOptions): Promise<BundleResult>;
    private css;
    /** The CSS worker (PostCSS / Tailwind) shared by dev servers and builds; a `node` process started on first use. */
    cssWorker(): CssBackend;
    /** Create a runtime worker shipped next to this module (dist/node-worker.js). */
    createWorker(_name: 'node-worker.js'): Worker;
    /**
     * Start a `node` worker: on the preview origin (run by the relay) when previews are served from a separate
     * `previewOrigin`, so project code there can't open this page's IndexedDB / Cache Storage; on this page otherwise.
     * @internal
     */
    nodeChannel(): Promise<NodeChannel>;
    /**
     * Start a module Web Worker for project code (e.g. an app's server handler) where `node` runs: on the preview origin
     * when previews are served from a separate `previewOrigin` (the page fetches `url` and the relay runs it from a
     * `blob:` URL there, so its imports must be absolute URLs), else `new Worker(url, { type: 'module' })` on this page.
     * Messages are structured-cloned and MessagePorts passed on; values that can only be transferred (streams, ...) fail;
     * `onerror` gets `{ message }`. With a `previewOrigin` it never falls back to this page's origin: it rejects when
     * there's no relay (`serviceWorkerUrl: false`).
     */
    projectWorker(url: string | URL, opts?: {
        name?: string;
    }): Promise<ProjectWorker>;
    /** The relay port to start workers on. Never falls back to this page's origin when there is a `previewOrigin`. */
    private workerRelay;
    private checkRelayEnabled;
    /**
     * A message the SW posts to the page that owns an instance (directly, or forwarded by the relay). `exclusive`: the
     * channel is this container's own (the relay port), so every request on it is ours to answer, if only with a 400;
     * on the page's shared SW channel, requests for other instance ids belong to other containers in this page.
     */
    private onSwMessage;
    /**
     * Channel for notifying this container's previews (used by the dev server). A BroadcastChannel on the page's origin,
     * or, with a separate preview origin, re-posted by the relay on the preview origin's BroadcastChannel of that name.
     */
    previewChannel(name: string): PreviewChannel;
    /**
     * Frame the preview origin's relay and bridge its service worker over a MessagePort (see relay-protocol.ts). Rejects
     * (leaving no frame or listener behind) if the first handshake fails or times out.
     */
    private connectRelay;
    private connectServiceWorker;
    teardown(): void;
}
export type { FileSystemTree, ContainerProcess, SpawnOptions, Command, CommandContext, DevServerOptions, DevServerHandle, BuildOptions, Dirent, Stats };
