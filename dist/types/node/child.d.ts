import type { CommandContext } from '../process';
import type { ChildEvent, ChildSpec, ChildSyncResult } from './protocol';
/** A spawn request from the worker, or null when malformed. */
export declare function parseSpec(m: unknown): ChildSpec | null;
export declare class ChildHost {
    private ctx;
    private send;
    private procs;
    private syncIds;
    private closed;
    constructor(ctx: CommandContext, send: (e: ChildEvent) => void);
    /** Resolve what `spec` runs; null when there's no such command or cwd (Node's ENOENT). */
    private runner;
    private writers;
    private run;
    /** `spawn`: events go back to the worker as `child` messages. */
    spawn(id: number, spec: ChildSpec): void;
    /** `spawnSync` / `execSync`: run to completion (the worker is blocked meanwhile), collecting piped output. */
    spawnSync(spec: ChildSpec, input: string | null, timeout: number): Promise<ChildSyncResult>;
    stdin(id: number, data: string | null): void;
    kill(id: number, signal: string): void;
    /** The parent exited: its children go with it. */
    killAll(): void;
}
