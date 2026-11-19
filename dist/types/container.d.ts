import { VFS, type Dirent, type Stats } from './vfs';
import { type FileSystemTree } from './tree';
import { PortTable, type PortHandler } from './ports';
import { type Command, type CommandContext, type ContainerProcess, type SpawnOptions } from './process';
import { type Registry } from './npm/registry';
import { type ResolveFs } from './resolve';
import { type BuildOptions as EsbuildOptions } from './esbuild';
import { type DevServerHandle, type DevServerOptions } from './dev/server';
import { type BuildOptions } from './build/build';
export interface BootOptions {
    /** Service worker URL served by the host at its origin root. Default '/cresslet-sw.js'. `false` disables previews. */
    serviceWorkerUrl?: string | false;
    /** esbuild.wasm URL (must match esbuild-wasm version). Default: jsDelivr. */
    esbuildWasmUrl?: string;
    /** npm registry base. Default 'https://registry.npmjs.org'. */
    registry?: string;
    /** Project directory. Default '/home/project'. */
    workdir?: string;
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
    /** Create a runtime worker shipped next to this module (dist/node-worker.js). */
    createWorker(_name: 'node-worker.js'): Worker;
    private connectServiceWorker;
    teardown(): void;
}
export type { FileSystemTree, ContainerProcess, SpawnOptions, Command, CommandContext, DevServerOptions, DevServerHandle, BuildOptions, Dirent, Stats };
