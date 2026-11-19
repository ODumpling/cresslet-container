import type { CommandContext } from '../process';
export interface ShellState {
    cwd: string;
    env: Record<string, string>;
    exitRequested?: number;
}
export type Builtin = (ctx: CommandContext, sh?: ShellState) => Promise<number> | number;
export declare const builtins: Record<string, Builtin>;
