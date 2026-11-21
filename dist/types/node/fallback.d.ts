import type { CommandContext } from '../process';
import type { VFS } from '../vfs';
/** What a `fallbackRuntime` is called with: the command's context, plus which CLI it is. */
export interface FallbackContext extends CommandContext {
    /** The CLI's package name, e.g. 'next'. */
    package: string;
    /** The bin name, e.g. 'next'. */
    bin: string;
    /** Absolute VFS path of the bin script `node` was asked to run. `args` are the arguments after it. */
    entry: string;
}
/** Runs a CLI cresslet's `node` can't (`boot({ fallbackRuntime })`); resolves to its exit code. */
export type FallbackRuntime = (ctx: FallbackContext) => Promise<number>;
/** The heavy CLI `entry` is the bin script of (in a `node_modules/<pkg>/` of HEAVY_CLIS), else null. */
export declare function heavyCli(vfs: VFS, entry: string): {
    package: string;
    bin: string;
} | null;
export declare function heavyCliError(pkg: string, bin: string): string;
