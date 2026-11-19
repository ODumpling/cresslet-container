import type { Container } from '../container';
import type { Writer } from '../process';
import { Channel } from '../process';
import { type ShellState } from './builtins';
export interface ShellIO {
    stdout: Writer;
    stderr: Writer;
    stdin: AsyncIterable<string>;
    signal: AbortSignal;
    isTTY?: boolean;
}
export declare class Shell {
    private c;
    state: ShellState;
    status: number;
    constructor(c: Container, cwd: string, env: Record<string, string>);
    /** Run a command line; returns exit status of the last pipeline. */
    run(line: string, io: ShellIO): Promise<number>;
    private envFor;
    private runPipeline;
    private runSimple;
}
/** Interactive jsh session for a terminal. Input is raw keystrokes; output uses \r\n. */
export declare function interactive(c: Container, sh: Shell, io: {
    stdout: Writer;
    stdin: Channel;
    signal: AbortSignal;
}): Promise<number>;
