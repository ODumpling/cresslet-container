import type { Container } from './container';
export interface Writer {
    write(s: string): void;
}
export interface CommandContext {
    args: string[];
    cwd: string;
    env: Record<string, string>;
    stdout: Writer;
    stderr: Writer;
    stdin: AsyncIterable<string>;
    signal: AbortSignal;
    container: Container;
    /** True when attached to an interactive terminal (jsh). */
    isTTY?: boolean;
}
export type Command = (ctx: CommandContext) => Promise<number>;
export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    /** Write '\r\n' line endings (default: false, except for interactive `jsh`). */
    terminal?: boolean;
}
export interface ContainerProcess {
    output: ReadableStream<string>;
    input: WritableStream<string>;
    exit: Promise<number>;
    kill(): void;
}
/** Unbounded async string queue. */
export declare class Channel implements AsyncIterable<string> {
    private buf;
    private waiters;
    closed: boolean;
    push(s: string): void;
    close(): void;
    /** Drain without awaiting. */
    takeAll(): string[];
    next(): Promise<IteratorResult<string>>;
    [Symbol.asyncIterator](): AsyncIterator<string>;
}
export declare const EMPTY_STDIN: AsyncIterable<string>;
/** Read all of stdin into a string. */
export declare function readAll(it: AsyncIterable<string>): Promise<string>;
/** Write helper that converts '\n' to '\r\n' for terminals. */
export declare function crlf(w: Writer): Writer;
/** Build a ContainerProcess around a running command. */
export declare function createProcess(run: (io: {
    stdout: Writer;
    stderr: Writer;
    stdin: Channel;
    signal: AbortSignal;
}) => Promise<number>, opts?: {
    terminal?: boolean;
}): ContainerProcess;
export declare function errorMessage(e: unknown): string;
/** Resolve when the signal aborts. */
export declare function aborted(signal: AbortSignal): Promise<void>;
