/** A word is a list of literal text and variable references. */
export type WordPart = string | {
    v: string;
    def?: string;
    colon?: boolean;
};
export type Word = WordPart[];
export interface Redirect {
    op: '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1';
    target: Word;
}
export interface SimpleCommand {
    assigns: [string, Word][];
    argv: Word[];
    redirects: Redirect[];
}
export type Pipeline = SimpleCommand[];
export interface ListItem {
    pipeline: Pipeline;
    /** Operator connecting to the NEXT item (null for last). */
    op: '&&' | '||' | ';' | null;
}
export type CommandList = ListItem[];
export declare class ParseError extends Error {
}
export declare function parse(src: string): CommandList;
export declare function expandWord(w: Word, env: Record<string, string | undefined>): string;
/** Quote a string for safe re-parsing. */
export declare function quote(s: string): string;
