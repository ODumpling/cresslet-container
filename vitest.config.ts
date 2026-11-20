import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
const nm = (p: string) => fileURLToPath(new URL('./node_modules/' + p, import.meta.url))
export default defineConfig({
  // mirror scripts/build.mjs's shims so the dev server loads in node tests
  resolve: {
    alias: [
      { find: /^react-refresh\/(cjs\/.*\?raw)$/, replacement: nm('react-refresh/') + '$1' },
      { find: /^cjs-lexer-js$/, replacement: nm('cjs-module-lexer/lexer.js') },
      { find: /^brotli-wasm-web$/, replacement: nm('brotli-wasm/pkg.web/brotli_wasm.js') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
