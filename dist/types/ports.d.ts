export type PortHandler = (req: Request) => Promise<Response> | Response;
export declare const PREVIEW_PREFIX = "/__clover__/";
export interface PortEvents {
    open(port: number, url: string): void;
    close(port: number, url: string): void;
}
/** Message the SW posts to pages (with a MessagePort for the reply). */
export interface SwRequest {
    type: 'clover-request';
    instanceId: string;
    port: number;
    /** Path after the port prefix, incl. query. */
    path: string;
    method: string;
    headers: [string, string][];
    body: ArrayBuffer | null;
}
export declare class PortTable {
    instanceId: string;
    private events;
    private ports;
    constructor(instanceId: string, events: PortEvents);
    url(port: number): string;
    open(port: number, handler: PortHandler, owner?: string): string;
    close(port: number): void;
    has(port: number): boolean;
    list(): number[];
    /** Lowest free port >= start. */
    free(start: number): number;
    dispatch(port: number, req: Request): Promise<Response>;
    /** Answer a request bridged from the service worker. Streams the body back over `reply`. */
    answer(m: SwRequest, reply: MessagePort): Promise<void>;
}
