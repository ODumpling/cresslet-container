import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'
const nm = (p: string) => fileURLToPath(new URL('./node_modules/' + p, import.meta.url))
export default defineConfig({
  // mirror scripts/build.mjs's shims so the dev server loads in node tests
  plugins: [
    {
      name: 'cresslet-bundle', // `pkg?bundle` (scripts/build.mjs bundleText)
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
