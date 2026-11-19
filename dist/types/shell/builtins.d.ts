import type { CommandContext } from '../process';
import { dirname } from '../path';
export interface ShellState {
    cwd: string;
    env: Record<string, string>;
    exitRequested?: number;
}
export type Builtin = (ctx: CommandContext, sh?: ShellState) => Promise<number> | number;
export declare const builtins: Record<string, Builtin>;
export { dirname };
