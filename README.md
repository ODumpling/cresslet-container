# cresslet-container

In-browser runtime for small/medium web apps: in-memory FS, shell, real `npm install`, a Node-ish `node`, a vite-like dev server, production builds and live previews. Our own WebContainer-style runtime, not Node-in-WASM — pragmatic built-ins instead of running real vite/next.

## Quickstart

```html
<script type="module">
  import { Container } from '/dist/cresslet-container.js' // or https://cdn.jsdelivr.net/gh/ODumpling/cresslet-container@main/dist/cresslet-container.js

  const c = await Container.boot()
  await c.mount({
    'package.json': { file: { contents: '{"scripts":{"dev":"vite"},"dependencies":{"react":"^19","react-dom":"^19"}}' } },
    'index.html': { file: { contents: '<div id="root"></div><script type="module" src="/src/main.tsx"><\/script>' } },
    src: { directory: { 'main.tsx': { file: { contents: `import { createRoot } from 'react-dom/client'\ncreateRoot(root).render(<h1>hi</h1>)` } } } },
  })
  c.on('server-ready', (port, url) => (iframe.src = url))
  const p = await c.spawn('jsh', ['-c', 'npm install && npm run dev'])
  p.output.pipeTo(new WritableStream({ write: (s) => terminal.write(s) }))
</script>
```

Install: `pnpm add github:ODumpling/cresslet-container` (dist is committed) or load from jsDelivr.

### Host requirements

1. **Cross-origin isolation** on the host page (needed for sync fs in `node` via `SharedArrayBuffer`):
   `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
2. **Serve `dist/cresslet-sw.js` from your origin root** (default URL `/cresslet-sw.js`, scope `/`; override with `boot({ serviceWorkerUrl })`). Service workers must be same-origin, so copy it even when loading the library from a CDN.
3. `dist/node-worker.js` is loaded via `new URL('./node-worker.js', import.meta.url)`; cross-origin (CDN) copies are wrapped in a same-origin blob worker automatically.
4. esbuild-wasm (0.28.2) loads lazily from jsDelivr; override with `boot({ esbuildWasmUrl })`.

`pnpm demo` serves `demo/` with these headers (http://localhost:4400).

## API

```ts
const c = await Container.boot({ serviceWorkerUrl?, esbuildWasmUrl?, registry?, workdir? /* '/home/project' */ })
c.workdir; c.instanceId
c.fs.readFile(p, 'utf8'?) / writeFile(p, data) /* mkdir -p */ / readdir(p, { withFileTypes? }) / mkdir / rm / rename / stat / exists
c.fs.watch(p, { recursive? }, (event: 'change' | 'rename', filename) => {}) // { close() }
await c.mount(tree, { mountPoint? })              // WebContainer FileSystemTree
await c.export(path, { excludes?: ['node_modules/**'] }) // FileSystemTree
const p = await c.spawn(cmd, args?, { cwd?, env? }) // p.output: ReadableStream<string>, p.input: WritableStream<string>, p.exit, p.kill()
c.on('server-ready' | 'port' | 'error', fn)      // returns unsubscribe
c.registerCommand(name, async (ctx) => code)     // ctx: { args, cwd, env, stdout, stderr, stdin, signal, container }
c.servePort(port, (req: Request) => Response)   // { url, close() }
await c.createDevServer({ root?, port?, middleware? }) // { url, port, close() }
await c.build({ root?, outDir? = 'dist' })       // { files: absolute VFS paths }
await c.bundle(esbuildOptions)                   // { outputFiles: [{ path, text, contents }], errors, warnings, metafile }
c.teardown()
```

Extras (not in the original contract): `c.vfs` (sync FS), `c.ports`, `c.exec`, `c.which`, `c.path`, `boot({ serviceWorkerUrl: false })`, `spawn(..., { terminal: true })` (CRLF output).

Notes:
- Relative paths resolve against `workdir`.
- `spawn('jsh')` with no args is an interactive shell for xterm.js (raw keystrokes in, `\r\n` out, Ctrl+C kills the foreground job). Other commands emit `\n`.
- `servePort` handlers receive `Request` with URL `http://localhost:<port>/<path>`.
- `bundle` with `platform: 'node' | 'neutral'` keeps `node:*`/`npm:`/`jsr:` imports external; `external` globs and `packages: 'external'` are honoured.

## Previews

Preview URL: `${origin}/__cresslet__/<instanceId>/<port>/`. The SW forwards requests to the owning page (MessageChannel, streamed bodies) and adds `COEP: require-corp` + `CORP: same-origin`.

Root-relative paths keep working: the SW injects a one-line script into preview HTML that `history.replaceState`s the prefix away (apps and routers see `/`), and attributes later requests to the preview by the document's client id (persisted in Cache Storage across SW restarts). Full navigations inside a preview (links, reloads) are matched by the frame's current URL; live reload navigates through the prefixed URL so it works in every browser.

## Commands

- **jsh**: quotes, `$VAR`/`${VAR:-x}`, `VAR=x cmd`, `|`, `&&`, `||`, `;`, `>`, `>>`, `<`, `2>`, `2>&1`, `&>`. Builtins: `cd pwd ls cat echo mkdir rm rmdir mv cp touch env export unset which clear exit head tail grep wc sleep true false help`.
- **npm**: `install|i|add [pkgs] [-D] [-E]`, `ci`, `uninstall`, `run`, `start`, `test`, `init -y`, `exec`, `ls`, `pkg get/set`. Registry installs: semver, abbreviated packuments, parallel tarball fetch, sha integrity check, gunzip + untar, hoisting with nesting on conflict, peers, optional deps, `npm:` aliases, `.bin` shims, `package-lock.json` (written, not read). Tarballs cached in memory + Cache Storage. `github:`/`git+`/`file:`/URL specs are skipped with a warning; install scripts are skipped with a warning.
- **npx**: local `.bin`, built-ins, or temp-installs the package.
- **node**: Web Worker with CommonJS loader over the VFS; ESM/TS/JSX transformed to CJS by esbuild (top-level await supported). Builtins: fs (sync + promises + streams), path, events, process, buffer, util, url, os, assert, stream, timers(/promises), crypto (randomUUID/randomBytes/createHash/createHmac for sha1/256/384/512), http/https (`createServer().listen()` → virtual port; `request`/`get`/`fetch` incl. `localhost:<port>`), querystring, string_decoder, readline, module, tty, net (isIP only), vm, async_hooks, perf_hooks, worker_threads (stub). `child_process`, `net` sockets, `tls`, `zlib`, `dns`, `http2`… throw `[cresslet] … is not supported`. Express works.
- **vite** / **vite dev** / **vite --port N**: built-in dev server. **vite build**: production build. **vite preview**, **serve [dir] [-p N]**: static server with SPA fallback.
- **tsc**: no-op stub (type-checking skipped; esbuild strips types) so `tsc -b && vite build` scripts work.

## Dev server

Serves `index.html` (+ live-reload client), `public/`, SPA fallback. Transforms `.ts/.tsx/.jsx/.js` with esbuild (automatic JSX; import source from tsconfig `jsxImportSource` or react/preact deps; tsconfig `paths` aliases). Bare imports → `/@modules/<spec>`: all deps pre-bundled together in one esbuild run with code splitting (one copy of react), CJS named exports via cjs-module-lexer; newly discovered deps re-optimize and reload. CSS imports inject `<style>`, CSS modules (`*.module.css`), `?url`/`?raw`, asset and JSON imports, `import.meta.env` (`MODE`, `DEV`, `PROD`, `BASE_URL`, `VITE_*` from `.env*`), `%VITE_X%` in HTML. File changes → full reload; errors → overlay.

## Build

Parses `index.html`, bundles each `<script type="module" src>` and local stylesheet (minify, splitting, `process.env.NODE_ENV=production`), emits CSS, hashes everything into `dist/assets/`, rewrites HTML, copies `public/` and HTML-referenced assets.

## Limitations

- Not real Node: real `vite`, `next`, `tsc`, native addons, `child_process`, raw sockets don't run (built-ins cover the common workflow).
- No HMR (full reload). No PostCSS/Tailwind v3/Sass/Less (Tailwind via CDN works).
- `node` needs a cross-origin isolated page; without it sync fs/`require` fail with a clear error.
- `npm`: no lockfile-driven installs, no workspaces, no git/file deps, no lifecycle scripts.
- Previews share the host origin: a preview at `/` and a host page at `/` can't be told apart on a *top-level* reload; manual reload of a preview frame after `pushState` is best-effort in WebKit.
- In-memory only: the VFS is lost on reload (persist with `export()`/`mount()`).

## Architecture

```
host page ──────────────────────────────────────────────────────────────┐
  Container ── VFS (main thread, in-memory)                             │
     ├─ jsh (parser + builtins) ── commands: npm · npx · vite · serve · node · registered
     ├─ npm: resolver (semver, hoist) → registry fetch → gunzip/untar → VFS
     ├─ node → Web Worker (CJS loader, polyfills) ⇄ SAB/Atomics sync RPC (fs, resolve, esbuild transform)
     ├─ dev server / build → esbuild-wasm (VFS plugin)
     └─ PortTable ⇄ cresslet-sw.js ⇄ preview iframes (/__cresslet__/<id>/<port>/…)
```

## Development

```sh
pnpm install
pnpm build       # dist/: cresslet-container.js, node-worker.js, cresslet-sw.js, index.d.ts (+ types/)
pnpm test        # vitest: VFS, parser, resolver/hoisting, tar, html, module resolution
pnpm test:e2e    # Playwright (chromium); test:e2e:all adds firefox + webkit
pnpm demo        # http://localhost:4400
```

## Roadmap

Persistence (IndexedDB/OPFS snapshots), HMR (React Fast Refresh), lockfile-driven installs + workspaces, PostCSS/Tailwind, more Node compat (zlib, child_process via jsh), real Node via WASM for big CLIs, subdomain-isolated previews.

## License

MIT
