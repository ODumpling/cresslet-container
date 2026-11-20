export declare const RELAY_HELLO = "cresslet-relay-hello";
export declare const RELAY_INIT = "cresslet-relay-init";
export declare const RELAY_READY = "cresslet-relay-ready";
export declare const RELAY_ERROR = "cresslet-relay-error";
export declare const BROADCAST = "cresslet-broadcast";
export declare const BROADCAST_CLOSE = "cresslet-broadcast-close";
/** SW -> owning page messages the relay forwards. */
export declare const SW_TO_PAGE: Set<string>;
/** Host -> SW messages the relay forwards. */
export declare const PAGE_TO_SW: Set<string>;
/** Origin of a URL-ish string, or null when it isn't an http(s) origin. */
export declare function toOrigin(s: string | null | undefined): string | null;
export declare function relayUrl(previewOrigin: string, hostOrigin: string): string;
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
/** Relay side: a SW -> page message worth forwarding (always carries exactly one reply port). */
export declare function isSwToPage(d: unknown, ports: readonly unknown[]): boolean;
export declare function isChannelName(s: unknown): s is string;
