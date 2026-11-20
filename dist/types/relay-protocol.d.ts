export declare const RELAY_HELLO = "cresslet-relay-hello";
export declare const RELAY_INIT = "cresslet-relay-init";
export declare const RELAY_READY = "cresslet-relay-ready";
export declare const RELAY_ERROR = "cresslet-relay-error";
export declare const BROADCAST = "cresslet-broadcast";
export declare const BROADCAST_CLOSE = "cresslet-broadcast-close";
export declare const WORKER_SCRIPT = "cresslet-worker-script";
export declare const PROC_SPAWN = "cresslet-proc-spawn";
export declare const WORKER_SPAWN = "cresslet-worker-spawn";
/** host -> relay: the container is going away; unregister this origin's service worker (per-preview origins only). */
export declare const RELAY_DISPOSE = "cresslet-relay-dispose";
/** SW -> owning page messages the relay forwards. */
export declare const SW_TO_PAGE: Set<string>;
/** Host -> SW messages the relay forwards. */
export declare const PAGE_TO_SW: Set<string>;
/** Origin of a URL-ish string, or null when it isn't an http(s) origin. */
export declare function toOrigin(s: string | null | undefined): string | null;
/** `sw: false`: a relay that only runs workers (no service worker on its origin; see `previewOrigins`). */
export declare function relayUrl(previewOrigin: string, hostOrigin: string, opts?: {
    sw?: boolean;
}): string;
/** `boot({ previewOrigins })`: the origin for one preview port (`port` 0: where the container's workers run). */
export declare function expandOriginTemplate(template: string, instanceId: string, port: number): string;
/**
 * Check a `previewOrigins` template: once `{id}` and `{port}` are filled in, it must be a bare http(s) origin, and both
 * placeholders must change it (so every container and port gets an origin of its own). Returns the error, or null.
 */
export declare function originTemplateError(template: unknown): string | null;
/**
 * Relay side: accept an INIT only from the host named in the relay's own URL, sent by its parent window, and (where
 * the browser exposes it) only when the parent really is that origin.
 */
export declare function acceptInit(ev: {
    origin: string;
    source: unknown;
    data: unknown;
    ports: readonly unknown[];
}, ctx: {
    host: string | null;
    parent: unknown;
    ancestorOrigins?: ArrayLike<string> | null;
}): boolean;
/** Host side: accept a relay HELLO only from the relay iframe's window on the preview origin. */
export declare function acceptHello(ev: {
    origin: string;
    source: unknown;
    data: unknown;
}, ctx: {
    previewOrigin: string;
    relay: unknown;
}): boolean;
/** Relay side: a host -> SW message worth forwarding. */
export declare function isPageToSw(d: unknown): d is {
    type: string;
    instanceId: string;
};
/** Relay side: a SW -> page message worth forwarding (one reply port; a WebSocket request also carries its socket). */
export declare function isSwToPage(d: unknown, ports: readonly unknown[]): boolean;
/** Relay side: the node worker script to run processes with. */
export declare function isWorkerScript(d: unknown): d is {
    type: string;
    source: string;
};
/** Relay side: start a process, talking to the host over the one transferred port. */
export declare function isProcSpawn(d: unknown, ports: readonly unknown[]): boolean;
/** Relay side: start a project worker from `source`, talking to the host over the one transferred port. */
export declare function isWorkerSpawn(d: unknown, ports: readonly unknown[]): d is {
    type: string;
    source: string;
    name?: string;
};
export declare function isChannelName(s: unknown): s is string;
/** Shown with relay setup errors: cross-site preview origins need third-party service workers/storage. */
export declare const THIRD_PARTY_HINT = "if the preview origin is cross-site, this browser may block third-party service workers/storage";
/** Host side: the text of a RELAY_ERROR (relay frames are scriptable by previews): prefixed, no control chars, capped. */
export declare function relayErrorText(message: unknown): string;
interface WorkerLike {
    state: string;
    addEventListener(type: 'statechange', fn: () => void): void;
    removeEventListener(type: 'statechange', fn: () => void): void;
}
/**
 * The worker to talk to after `register()`: a newer one installing/waiting (skipWaiting + claim make it take over) wins
 * over an older active one (which is the fallback if the newer one turns redundant); otherwise the active one, or
 * whatever `ready` brings.
 */
export declare function newestWorker<W extends WorkerLike>(reg: {
    installing: W | null;
    waiting: W | null;
    active: W | null;
}, ready: () => Promise<{
    active: W | null;
}>): Promise<W>;
export {};
