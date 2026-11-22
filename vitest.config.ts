import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'
const nm = (p: string) => fileURLToPath(new URL('./node_modules/' + p, import.meta.url))
export default defineConfig({
  // mirror scripts/build.ts's shims so the dev server loads in node tests
  plugins: [
    {
      // `./file.ts?raw` (src/preview-ws.ts): its compiled JS, as scripts/build.ts embeds it (vite's own ?raw is the TS source)
      name: 'cresslet-raw-ts',
      enforce: 'pre',
      async load(id) {
        if (!id.endsWith('.ts?raw')) return null
        const { code } = await esbuild.transform(readFileSync(id.slice(0, -4), 'utf8'), { loader: 'ts', minify: true, legalComments: 'inline' })
        return `export default ${JSON.stringify(code)}`
      },
    },
    {
      name: 'cresslet-bundle', // `pkg?bundle` (scripts/build.ts bundleText)
      enforce: 'pre',
      resolveId: (id) => (id.endsWith('?bundle') ? '\0bundle:' + id.slice(0, -7) : null),
      async load(id) {
        if (!id.startsWith('\0bundle:')) return null
        const r = await esbuild.build({ entryPoints: [id.slice(8)], absWorkingDir: fileURLToPath(new URL('.', import.meta.url)), bundle: true, write: false, format: 'esm', minify: true, legalComments: 'inline', external: ['preact', 'preact/*'], logLevel: 'silent' })
        return `export default ${JSON.stringify(r.outputFiles[0].text)}`
      },
    },
  ],
  resolve: {
    alias: [
      { find: /^react-refresh\/(cjs\/.*\?raw)$/, replacement: nm('react-refresh/') + '$1' },
      { find: /^cjs-lexer-js$/, replacement: nm('cjs-module-lexer/lexer.js') },
      { find: /^brotli-wasm-web$/, replacement: nm('brotli-wasm/pkg.web/brotli_wasm.js') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
