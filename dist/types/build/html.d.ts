export interface Tag {
    name: string;
    start: number;
    end: number;
    raw: string;
    attrs: Record<string, string>;
}
export declare function parseAttrs(s: string): Record<string, string>;
export declare function findTags(html: string): Tag[];
export declare const isLocalRef: (u: string) => boolean;
/** `src` of local `<script type="module" src>` tags. */
export declare function findModuleScripts(html: string): string[];
/** Replace one attribute value inside a raw tag. */
export declare function setAttr(raw: string, name: string, value: string): string;
export interface HtmlEdit {
    start: number;
    end: number;
    text: string;
}
export declare function applyEdits(html: string, edits: HtmlEdit[]): string;
/** Insert markup right before </head> (or at the start). */
export declare function injectHead(html: string, markup: string): string;
export interface BuildRewriteInput {
    /** script src -> emitted js url */
    scripts: Record<string, string>;
    /** stylesheet href -> emitted css url */
    styles: Record<string, string>;
    /** other asset refs -> emitted url */
    assets: Record<string, string>;
    /** css emitted for script entries, to be linked */
    extraCss: string[];
    /** modulepreload hints */
    preload?: string[];
}
/** Rewrite index.html for production output. */
export declare function rewriteHtmlForBuild(html: string, r: BuildRewriteInput): string;
/** Short stable content hash (FNV-1a, base36). */
export declare function contentHash(data: Uint8Array): string;
