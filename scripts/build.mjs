// Build dist/: library (ESM), node worker (ESM), service worker + preview relay (IIFE, + relay HTML), then .d.ts via tsc.
import * as esbuild from 'esbuild'
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const watch = process.argv.includes('--watch')
rmSync(`${root}dist`, { recursive: true, force: true })

const shims = {
  name: 'cresslet-shims',
  setup(b) {
    // readable-stream & friends expect browserify-style globals
    b.onResolve({ filter: /^process\/?$/ }, () => ({ path: `${root}src/node/shims/process.cjs` }))
    b.onResolve({ filter: /^abort-controller$/ }, () => ({ path: `${root}src/node/shims/abort-controller.cjs` }))
    b.onResolve({ filter: /^cjs-lexer-js$/ }, () => ({ path: `${root}node_modules/cjs-module-lexer/lexer.js` }))
    // brotli-wasm's `web` glue (its package exports don't expose it); the .wasm loads at runtime (boot({ brotliWasmUrl }))
    b.onResolve({ filter: /^brotli-wasm-web$/ }, () => ({ path: `${root}node_modules/brotli-wasm/pkg.web/brotli_wasm.js` }))
    // `import text from 'pkg/file.js?raw'` (as in vite/vitest): embed a file's source as a minified string
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: a.path.startsWith('.') ? join(a.resolveDir, a.path.slice(0, -4)) : `${root}node_modules/${a.path.slice(0, -4)}`, namespace: 'raw' }))
    // `import text from 'pkg?bundle'`: a browser package bundled to one ES module string, its peer `preact` external
    b.onResolve({ filter: /\?bundle$/ }, (a) => ({ path: a.path.slice(0, -7), namespace: 'bundle' }))
    b.onLoad({ filter: /.*/, namespace: 'bundle' }, async (a) => ({ contents: await bundleText(a.path), loader: 'text' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => {
      const { code } = await esbuild.transform(readFileSync(a.path, 'utf8'), { minify: true, legalComments: 'inline' })
      return { contents: code, loader: 'text' }
    })
  },
}

/** Keep in sync with vitest.config.ts. */
async function bundleText(pkg) {
  const r = await esbuild.build({ entryPoints: [pkg], absWorkingDir: root, bundle: true, write: false, format: 'esm', minify: true, legalComments: 'inline', external: ['preact', 'preact/*'], logLevel: 'silent' })
  return r.outputFiles[0].text
}

const common = {
  bundle: true,
  target: 'es2022',
  platform: 'browser',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
  plugins: [shims],
  define: { 'process.env.NODE_ENV': '"production"' },
}

const configs = [
  { ...common, entryPoints: { 'cresslet-container': 'src/index.ts' }, format: 'esm', outdir: 'dist', minify: true },
  { ...common, entryPoints: { 'node-worker': 'src/node/worker.ts' }, format: 'esm', outdir: 'dist', minify: true, define: {} },
  { ...common, entryPoints: { 'cresslet-sw': 'src/sw.ts' }, format: 'iife', outdir: 'dist', minify: true },
  { ...common, entryPoints: { 'cresslet-relay': 'src/relay.ts' }, format: 'iife', outdir: 'dist', minify: true },
]

mkdirSync(`${root}dist`, { recursive: true })
copyFileSync(`${root}src/relay.html`, `${root}dist/cresslet-relay.html`)

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch()
} else {
  await Promise.all(configs.map((c) => esbuild.build({ ...c, absWorkingDir: root })))
  execSync('node_modules/.bin/tsc -p tsconfig.build.json', { cwd: root, stdio: 'inherit' })
  writeFileSync(`${root}dist/index.d.ts`, "export * from './types/index'\n")
  vendorTypes()
}

/** Make dist typings self-contained: vendor esbuild-wasm's d.ts and point imports at it. */
function vendorTypes() {
  const types = `${root}dist/types`
  mkdirSync(`${types}/vendor`, { recursive: true })
  copyFileSync(`${root}node_modules/esbuild-wasm/esm/browser.d.ts`, `${types}/vendor/esbuild-wasm.d.ts`)
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  for (const f of walk(types).filter((f) => f.endsWith('.d.ts') && !f.includes('/vendor/'))) {
    const src = readFileSync(f, 'utf8')
    let rel = relative(dirname(f), `${types}/vendor/esbuild-wasm`)
    if (!rel.startsWith('.')) rel = './' + rel
    const out = src.replace(/(["'])esbuild-wasm\1/g, `'${rel}'`)
    if (out !== src) writeFileSync(f, out)
  }
}
