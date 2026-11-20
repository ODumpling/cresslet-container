// Tiny static server for the demo + e2e: serves repo root with COOP/COEP so the page is cross-origin isolated.
// Routes: / -> demo/index.html, /cresslet-sw.js -> dist/cresslet-sw.js (origin root => scope "/").
// A second listener (PREVIEW_PORT, default PORT+1) is a separate preview origin for `boot({ previewOrigin })`: it serves
// only the relay, the service worker and a blank page, with the headers the README asks of a preview origin.
// Open http://localhost:4400/?previewOrigin=http://127.0.0.1:4401 to try it.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const port = Number(process.env.PORT ?? 4400)
const previewPort = Number(process.env.PREVIEW_PORT ?? port + 1)
const hostOrigin = `http://localhost:${port}`
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }
const routes = { '/': 'demo/index.html', '/cresslet-sw.js': 'dist/cresslet-sw.js' }
const previewRoutes = {
  '/cresslet-relay.html': 'dist/cresslet-relay.html',
  '/cresslet-relay.js': 'dist/cresslet-relay.js',
  '/cresslet-sw.js': 'dist/cresslet-sw.js',
  '/blank.html': 'demo/blank.html', // e2e: a page on the preview origin
}

async function send(res, file, headers) {
  try {
    if (!file || !file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('nf')
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404, headers)
    res.end('not found')
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const rel = routes[url.pathname] ?? normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, '')
  await send(res, join(root, rel), {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-cache',
  })
}).listen(port, () => console.log(`cresslet demo: http://localhost:${port}/`))

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const rel = previewRoutes[url.pathname]
  const headers = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-cache',
  }
  if (url.pathname === '/cresslet-relay.html') headers['Content-Security-Policy'] = `frame-ancestors ${hostOrigin}`
  await send(res, rel && join(root, rel), headers)
}).listen(previewPort, () => console.log(`cresslet preview origin: http://127.0.0.1:${previewPort}/ (frame-ancestors ${hostOrigin})`))
