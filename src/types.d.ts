declare module 'cjs-lexer-js' {
  export function parse(code: string, name?: string): { exports: string[]; reexports: string[] }
}
