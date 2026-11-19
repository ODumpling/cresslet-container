// Build dist/: library (ESM), node worker (ESM), service worker (IIFE), then .d.ts via tsc.
import * as esbuild from 'esbuild'
import { execSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const watch = process.argv.includes('--watch')
rmSync(`${root}dist`, { recursive: true, force: true })

const shims = {
  name: 'clover-shims',
  setup(b) {
    // readable-stream & friends expect browserify-style globals
    b.onResolve({ filter: /^process\/?$/ }, () => ({ path: `${root}src/node/shims/process.cjs` }))
    b.onResolve({ filter: /^abort-controller$/ }, () => ({ path: `${root}src/node/shims/abort-controller.cjs` }))
    b.onResolve({ filter: /^cjs-lexer-js$/ }, () => ({ path: `${root}node_modules/cjs-module-lexer/lexer.js` }))
  },
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
  { ...common, entryPoints: { 'clover-container': 'src/index.ts' }, format: 'esm', outdir: 'dist', minifySyntax: true },
  { ...common, entryPoints: { 'node-worker': 'src/node/worker.ts' }, format: 'esm', outdir: 'dist', minifySyntax: true, define: {} },
  { ...common, entryPoints: { 'clover-sw': 'src/sw.ts' }, format: 'iife', outdir: 'dist', minify: true },
]

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch()
} else {
  await Promise.all(configs.map((c) => esbuild.build({ ...c, absWorkingDir: root })))
  execSync('node_modules/.bin/tsc -p tsconfig.build.json', { cwd: root, stdio: 'inherit' })
  writeFileSync(`${root}dist/index.d.ts`, "export * from './types/index'\n")
}
