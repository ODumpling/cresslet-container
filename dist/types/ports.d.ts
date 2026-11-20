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
    /** A preview's WebSocket (see preview-ws.js): comes with the socket's server end; answered with `open` or `refused`. */
    websocket?: boolean;
}
/** Headers of a WebSocket upgrade request (what a server would see; `Request` itself can't carry them). */
export declare function websocketHeaders(protocols: string[], origin: string): [string, string][];
/** The subprotocols a forwarded upgrade offers, or null when they aren't distinct tokens. */
export declare function offeredProtocols(headers: [string, string][]): string[] | null;
/** A well-formed `cresslet-request` (checked before anything is dispatched to a port handler). */
export declare function isSwRequest(d: unknown): d is SwRequest;
/** Reply to a request that failed validation: 400 (or `status`), then close the reply port (the SW would otherwise wait for its deadline). */
export declare function rejectRequest(reply: MessagePort, status?: 400 | 403, text?: string): void;
/** What `Container.upgradeWebSocket` returns. */
export interface WebSocketUpgrade {
    /**
     * The server end of the preview's socket. Both ways: `{ type: 'message', data: string | ArrayBuffer }` and
     * `{ type: 'close', code?, reason? }` (whoever sends `close` is done with the port; whoever gets it closes the port). May be transferred (e.g. to a
     * project worker). If the handler refuses after all (or the preview gave up), the preview sends it `close`.
     */
    socket: MessagePort;
    /** Return this from the port handler to accept the upgrade. Any other response refuses it. */
    response: Response;
}
/** See `Container.upgradeWebSocket`. */
export declare function upgradeWebSocket(req: Request, opts?: {
    protocol?: string;
}): WebSocketUpgrade;
export declare class PortTable {
    instanceId: string;
    private events;
    /** Origin previews are served from, or one per port (`boot({ previewOrigins })`). Default: the page's own origin. */
    private previewOrigin?;
    private ports;
    constructor(instanceId: string, events: PortEvents, 
    /** Origin previews are served from, or one per port (`boot({ previewOrigins })`). Default: the page's own origin. */
    previewOrigin?: string | ((port: number) => string) | undefined);
    /** Origin previews (`port`'s, with per-preview origins: then `port` is required) are served from. */
    origin(port?: number): string;
    url(port: number): string;
    /** Throws a RangeError for a port previews can't use (per-preview origins: 1-65535; {port} 0 is the workers' origin). */
    checkPort(port: number): void;
    open(port: number, handler: PortHandler, owner?: string): string;
    close(port: number): void;
    has(port: number): boolean;
    list(): number[];
    /** Lowest free port >= start. */
    free(start: number): number;
    dispatch(port: number, req: Request): Promise<Response>;
    /** Answer a request bridged from the service worker. Streams the body back over `reply`, then closes it. */
    /** `socket`: a WebSocket request's server end (see `SwRequest.websocket`). */
    answer(m: SwRequest, reply: MessagePort, socket?: MessagePort): Promise<void>;
    /**
     * A preview's WebSocket: dispatch it as a GET with the upgrade headers (shadowing `req.headers`, since `Request` drops
     * `Upgrade`/`Sec-*`), then hand the preview its end of the socket (`open`) if the handler accepted, else `refused`.
     * The headers are made here, not taken from the message (the relay is scriptable by previews): only the offered
     * subprotocols come from the preview.
     */
    private answerSocket;
}
