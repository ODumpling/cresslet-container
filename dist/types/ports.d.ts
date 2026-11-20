export type PortHandler = (req: Request) => Promise<Response> | Response;
export declare const PREVIEW_PREFIX = "/__cresslet__/";
export interface PortEvents {
    open(port: number, url: string): void;
    close(port: number, url: string): void;
}
/** Message the SW posts to pages (with a MessagePort for the reply). */
export interface SwRequest {
    type: 'cresslet-request';
    instanceId: string;
    port: number;
    /** Path after the port prefix, incl. query. */
    path: string;
    method: string;
    headers: [string, string][];
    body: ArrayBuffer | null;
}
/** A well-formed `cresslet-request` (checked before anything is dispatched to a port handler). */
export declare function isSwRequest(d: unknown): d is SwRequest;
/** Reply to a request that failed validation: 400, then close the reply port (the SW would otherwise wait for its deadline). */
export declare function rejectRequest(reply: MessagePort): void;
export declare class PortTable {
    instanceId: string;
    private events;
    /** Origin previews are served from. Default: the page's own origin. */
    private previewOrigin?;
    private ports;
    constructor(instanceId: string, events: PortEvents, 
    /** Origin previews are served from. Default: the page's own origin. */
    previewOrigin?: string | undefined);
    url(port: number): string;
    open(port: number, handler: PortHandler, owner?: string): string;
    close(port: number): void;
    has(port: number): boolean;
    list(): number[];
    /** Lowest free port >= start. */
    free(start: number): number;
    dispatch(port: number, req: Request): Promise<Response>;
    /** Answer a request bridged from the service worker. Streams the body back over `reply`, then closes it. */
    answer(m: SwRequest, reply: MessagePort): Promise<void>;
}
