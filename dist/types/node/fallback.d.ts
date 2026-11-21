import type { CommandContext } from '../process';
import type { VFS } from '../vfs';
/** What a `fallbackRuntime` is called with: the command's context, plus which CLI it is. */
export interface FallbackContext extends CommandContext {
    /** The CLI's package name, e.g. 'next'. */
    package: string;
    /** The bin name, e.g. 'next'. */
    bin: string;
    /** Absolute VFS path of the package's bin script (also when `node` was given its `.bin` shim). `args` are the arguments after it. */
    entry: string;
}
/** Runs a CLI cresslet's `node` can't (`boot({ fallbackRuntime })`); resolves to its exit code. */
export type FallbackRuntime = (ctx: FallbackContext) => Promise<number>;
/**
 * The heavy CLI `entry` (as `node` was given it) runs: the bin script of a HEAVY_CLIS package (by its package.json
 * name, in the last `node_modules/<pkg>/` of its real path), directly or through its `.bin` shim. Else null.
 */
export declare function heavyCli(vfs: VFS, entry: string): Pick<FallbackContext, 'package' | 'bin' | 'entry'> | null;
/** The error for running `cli` on `node` with `args`, or null when it runs there anyway (`next --version`). */
export declare function heavyCliError(cli: {
    package: string;
    bin: string;
}, args: string[]): string | null;
