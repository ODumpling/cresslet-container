declare module 'cjs-lexer-js' {
  export function parse(code: string, name?: string): { exports: string[]; reexports: string[] }
}
declare module '*?raw' {
  const text: string
  export default text
}
