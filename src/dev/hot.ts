// `import.meta.hot` (the Vite-compatible subset: accept, dispose, data, invalidate) in served modules.
//
// A module that mentions `import.meta.hot` gets a hot context bound to its URL: esbuild `define`s `import.meta.hot` to
// HOT_ID, and a banner (source-map aware) creates it. The `accept` calls in esbuild's output tell the module graph
// what the module accepts; dep specifiers in them are rewritten to the URLs the client matches updates by.

export const HOT_ID = '__cresslet_hot'
export const CLIENT_URL = '/@cresslet/client'

/** Whether a module's source uses the API (cheap text check before the transform). */
export const usesHot = (source: string): boolean => source.includes('import.meta.hot')

/** Banner that creates the module's hot context (`url`: its path, no query). */
export function hotBanner(url: string): string {
  return `import { createHotContext as ${HOT_ID}_create } from ${JSON.stringify(CLIENT_URL)};const ${HOT_ID} = ${HOT_ID}_create(${JSON.stringify(url)});`
}

const ACCEPT = new RegExp(`\\b${HOT_ID}\\s*\\??\\.\\s*accept\\s*\\(\\s*`, 'g')
// esbuild prints string literals with double quotes (and keeps template literals)
const LIT = '"(?:[^"\\\\\\n]|\\\\.)*"|`(?:[^`\\\\$]|\\$(?!\\{))*`' // a template literal without ${...}
const STRING = new RegExp(`^(?:${LIT})`)
const ARRAY = new RegExp(`^\\[\\s*((?:(?:${LIT})\\s*,?\\s*)*)\\]`)

export interface HotAccepts {
  code: string
  /** `accept()` / `accept(cb)`: the module accepts its own updates */
  self: boolean
  /** resolved deps of `accept(dep, cb)` / `accept([deps], cb)` */
  deps: string[]
}

/**
 * Find the `accept` calls in esbuild output and resolve their dep specifiers: `resolve(spec)` returns
 * `{ file, url }` (the URL replaces the literal) or null (left as-is; no update reaches it).
 */
export function analyzeHot(code: string, resolve: (spec: string) => { file: string; url: string } | null): HotAccepts {
  let self = false
  const deps: string[] = []
  const edits: { start: number; end: number; text: string }[] = []
  const lit = (s: string, at: number) => {
    let spec: string
    try {
      // JS escapes JSON lacks (esbuild writes non-ASCII as \xHH / \u{...})
      spec = JSON.parse(`"${s.slice(1, -1).replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1').replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => JSON.stringify(String.fromCodePoint(parseInt(h, 16))).slice(1, -1))}"`)
    } catch {
      return
    }
    const r = resolve(spec)
    if (!r) return
    deps.push(r.file)
    edits.push({ start: at, end: at + s.length, text: JSON.stringify(r.url) })
  }
  for (const m of code.matchAll(ACCEPT)) {
    const at = m.index! + m[0].length
    const rest = code.slice(at, at + 4096)
    const str = STRING.exec(rest)
    if (str) {
      lit(str[0], at)
      continue
    }
    const arr = ARRAY.exec(rest)
    if (arr) {
      const inner = at + arr[0].indexOf(arr[1])
      for (const e of arr[1].matchAll(new RegExp(LIT, 'g'))) lit(e[0], inner + e.index!)
      continue
    }
    self = true // no args, or a callback
  }
  let out = code
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return { code: out, self, deps }
}
