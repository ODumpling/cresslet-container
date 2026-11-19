import type { Container } from '../container';
import type { CommandContext } from '../process';
/** Execute one RPC op against the container. Shared by sync and async channels. */
export declare function runOp(c: Container, op: string, args: unknown[]): Promise<unknown>;
/** The `node` command. */
export declare function nodeCommand(ctx: CommandContext): Promise<number>;
export declare const NODE_VERSION = "v22.12.0";
export declare function runNode(ctx: CommandContext, entry: string, args: string[]): Promise<number>;
