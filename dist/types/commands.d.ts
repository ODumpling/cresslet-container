import type { Container } from './container';
import type { Command } from './process';
import { builtins } from './shell/builtins';
import { NODE_VERSION } from './node/host';
export declare const NPM_VERSION = "10.9.0";
export declare const npm: Command;
export declare const npx: Command;
/** `vite` / `vite dev` / `vite build` / `vite preview` mapped to built-ins. */
export declare const vite: Command;
export declare function staticHandler(c: Container, dir: string, spa?: boolean): (req: Request) => Response;
export declare const serve: Command;
export declare const tsc: Command;
export declare const jsh: Command;
export declare const COMMANDS: Record<string, Command>;
export { builtins, NODE_VERSION };
