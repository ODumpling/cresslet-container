// Tiny static server for the demo + e2e: serves repo root with COOP/COEP so the page is cross-origin isolated.
// Routes: / -> demo/index.html, /clover-sw.js -> dist/clover-sw.js (origin root => scope "/").
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT ?? 4400)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const routes = { '/': 'demo/index.html', '/clover-sw.js': 'dist/clover-sw.js' }

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const rel = routes[url.pathname] ?? normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
  const file = join(root, rel)
  const headers = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-cache',
  }
  try {
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('nf')
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404, headers)
    res.end('not found')
  }
}).listen(port, () => console.log(`clover demo: http://localhost:${port}/`))
