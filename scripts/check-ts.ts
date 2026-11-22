// TypeScript guard (run by `pnpm typecheck`): fails when
//  - a JS file (.js/.mjs/.cjs/.jsx) exists outside the allowlist below, or
//  - owned TypeScript (or the JS checked in place) uses @ts-ignore / @ts-nocheck, or @ts-expect-error without a reason.
// Looks at tracked files plus untracked ones that aren't gitignored. See docs/typescript.md.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** JS that stays JS, each with why. Patterns: a path, or a prefix ending in `/`. */
const JS_ALLOWLIST: Record<string, string> = {
  'dist/': 'build output (committed: consumed via git / jsDelivr and vendored by the studio)',
  'e2e/fixtures/': "project content run inside the container (the app's own JS), not this repo's code",
  'src/css/worker.cjs': "run as-is by the container's `node` over the project's own sass/less/postcss/tailwind (raw import), and vendored verbatim into cresslet-cli as lib/compilers.cjs; checked in place by tsconfig.js.json",
  'src/node/shims/process.cjs': 'CommonJS shim aliased by esbuild for bundled polyfills (readable-stream expects `process`); checked by tsconfig.js.json',
  'src/node/shims/abort-controller.cjs': 'CommonJS shim aliased by esbuild for bundled polyfills; checked by tsconfig.js.json',
}

const JS = /\.(js|mjs|cjs|jsx)$/
const TS = /\.(ts|mts|cts|tsx)$/
/** TS that isn't ours to police: project content, and generated declarations. */
const NOT_OWNED = ['dist/', 'e2e/fixtures/']
/** The JS that tsconfig.js.json checks in place: an opt-out comment would switch that off. */
const CHECKED_JS = /^src\/(css\/worker|node\/shims\/[^/]+)\.cjs$/

// directives only (a comment, or a block comment's line, starting with one), not prose that mentions them
const DIRECTIVE = /(?:\/\/\/?|\/\*+|^\s*\*+)\s*@ts-(ignore|nocheck)\b/
const BARE_EXPECT_ERROR = /(?:\/\/\/?|\/\*+|^\s*\*+)\s*@ts-expect-error\s*(?:\*+\/\s*)?$/

const allowed = (f: string, list: Iterable<string>) => [...list].some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p))

function check(files: string[], read: (f: string) => string): string[] {
  const problems: string[] = []
  for (const f of files) {
    if (JS.test(f) && !allowed(f, Object.keys(JS_ALLOWLIST))) problems.push(`${f}: JavaScript outside the allowlist (write it in TypeScript, or add it to JS_ALLOWLIST in scripts/check-ts.ts with a reason)`)
    if (!(TS.test(f) || CHECKED_JS.test(f)) || allowed(f, NOT_OWNED)) continue
    read(f)
      .split('\n')
      .forEach((line, i) => {
        const m = DIRECTIVE.exec(line)
        if (m) problems.push(`${f}:${i + 1}: @ts-${m[1]} is not allowed (fix the type, or @ts-expect-error with a reason)`)
        if (BARE_EXPECT_ERROR.test(line)) problems.push(`${f}:${i + 1}: @ts-expect-error needs a reason after it`)
      })
  }
  return problems
}

const root = fileURLToPath(new URL('..', import.meta.url))
const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
// a tracked file deleted in the working tree is still listed: skip what's gone
const files = [...new Set(out.split('\0'))].filter((f) => f && existsSync(root + f))
const problems = check(files, (f) => readFileSync(root + f, 'utf8'))
for (const p of problems) console.error(p)
if (problems.length) {
  console.error(`check-ts: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('check-ts: ok')
