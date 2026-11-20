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
5. Optional, recommended when the host keeps secrets in storage: a **separate preview origin** (`boot({ previewOrigin })`, see [below](#separate-preview-origin)).

`pnpm demo` serves `demo/` with these headers (http://localhost:4400), plus a preview origin on http://127.0.0.1:4401 (try http://localhost:4400/?previewOrigin=http://127.0.0.1:4401).

## API

```ts
const c = await Container.boot({ serviceWorkerUrl?, esbuildWasmUrl?, registry?, workdir? /* '/home/project' */, npmCache? /* true */, previewOrigin? /* e.g. 'https://preview.example.com' */ })
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

Extras (not in the original contract): `c.vfs` (sync FS), `c.ports`, `c.exec`, `c.which`, `c.path`, `boot({ serviceWorkerUrl: false })`, `boot({ npmCache: false })` (no persistent npm cache), `spawn(..., { terminal: true })` (CRLF output), `c.previewOrigin` (separate preview origin or `null`), `c.previewChannel(name)` (what the dev server notifies previews through).

Notes:
- Relative paths resolve against `workdir`.
- `spawn('jsh')` with no args is an interactive shell for xterm.js (raw keystrokes in, `\r\n` out, Ctrl+C kills the foreground job). Other commands emit `\n`.
- `servePort` handlers receive `Request` with URL `http://localhost:<port>/<path>`.
- `bundle` with `platform: 'node' | 'neutral'` keeps `node:*`/`npm:`/`jsr:` imports external; `external` globs and `packages: 'external'` are honoured.

## Previews

Preview URL: `${origin}/__cresslet__/<instanceId>/<port>/`. The SW forwards requests to the owning page (MessageChannel, streamed bodies) and adds `COEP: require-corp` + `CORP: same-origin`.

Root-relative paths keep working: the SW injects a one-line script into preview HTML that `history.replaceState`s the prefix away (apps and routers see `/`), and attributes later requests to the preview by the document's client id (persisted in Cache Storage across SW restarts). Full navigations inside a preview (links, reloads) are matched by the frame's current URL; live reload navigates through the prefixed URL so it works in every browser.

### Separate preview origin

By default previews share the host page's origin, so preview code (the user's app and its npm deps) can read the host's `localStorage`, IndexedDB and cookies. `boot({ previewOrigin: 'https://preview.example.com' })` serves them from another origin instead:

- The container adds a hidden iframe `${previewOrigin}/cresslet-relay.html?host=<host origin>`. The relay registers `${previewOrigin}/cresslet-sw.js?xorigin=1` (scope `/`) and bridges it to the container over one `MessageChannel`: the SW's requests for the owning page (`cresslet-who`, `cresslet-request`, reply ports and bodies transferred) go relay → container, (un)registration goes container → relay → SW. The relay accepts the handshake only from its `host` param's origin, from its parent window, and (where `location.ancestorOrigins` exists) only when the parent really is that origin; the container accepts the relay's hello only from `previewOrigin` and the relay iframe's window.
- Dev server notifications (live reload, HMR updates, overlay errors) go container → relay, which re-posts them on the same-named `BroadcastChannel` on the preview origin.
- `server-ready` / `port` URLs and `c.ports.url()` are `${previewOrigin}/__cresslet__/<id>/<port>/`. With `?xorigin=1` the SW sends `Cross-Origin-Resource-Policy: cross-origin` on preview responses, so the cross-origin-isolated host can frame them.
- Previews are same-origin with the relay (and so can script it); the container treats relay messages as untrusted and only answers what the SW could ask anyway: requests to this container's own ports. The SW takes ownership (register/unregister, owner probes, recovery after an SW restart) only from relay frames (`/cresslet-relay.html`, nested), never from preview windows, and never routes `/cresslet-relay.html`, `/cresslet-relay.js` or `/cresslet-sw.js` to a preview, so the relay always comes from your server with its `frame-ancestors`. Relay errors are shown only during its setup, prefixed `preview relay:`.
- A forwarded request whose head doesn't arrive within 30 s (e.g. the relay reloaded mid-request) gets a `504` with `Retry-After: 1`; it isn't replayed.
- `serviceWorkerUrl` is unused with `previewOrigin` (`false` still disables previews). If the relay reports an error or doesn't connect within 20 s, `boot` rejects (and removes the relay frame).

The host page keeps COOP/COEP as above. At the **preview origin's root**, serve these files from `dist/`, with these headers:

| Path | Headers |
| --- | --- |
| `/cresslet-relay.html` | `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: cross-origin`, `Content-Security-Policy: frame-ancestors <host origin>` |
| `/cresslet-relay.js` | none required (same-origin to the relay); `Cross-Origin-Resource-Policy: cross-origin` is fine |
| `/cresslet-sw.js` | `Service-Worker-Allowed: /` |

`frame-ancestors` is the real guard against other sites (and previews) framing the relay (the origin checks above are a second layer; Firefox has no `ancestorOrigins`). It is checked against every ancestor: if the host page is itself framed (e.g. by a dashboard), list all of its ancestors' origins too, or the relay won't load. Nothing else needs to be served there: every `/__cresslet__/…` URL is answered by the service worker. Serving the whole preview origin with COEP + CORP as `scripts/serve.mjs` does is fine too.

What it does and doesn't isolate:
- **One trust boundary per preview origin.** All previews served from one `previewOrigin` (every container, every port, every tab) share that origin: they can script each other's frames and the relay, read each other's storage, and answer each other's requests. Use distinct preview origins for containers that must not trust each other (e.g. different users' projects).
- **Only browser-rendered preview code moves.** `node` and other server code the container runs (dev server plugins, `node server.js`, npm bins) still runs in Web Workers on the **host origin**. Workers can't read `localStorage` or cookies via `document.cookie`, but they can open the host's IndexedDB and Cache Storage and make same-origin (credentialed) requests to the host. Don't rely on `previewOrigin` to contain untrusted `node` code.
- **Cross-site preview origins need third-party service workers and storage.** Browsers or settings that block them (some privacy modes, "block third-party cookies" in some browsers) make the relay fail: `boot` rejects with a `preview relay:` error that says so. Fall back to a same-site preview origin or no `previewOrigin`.

Choosing the origin:
- **Different site** (e.g. `preview.example-usercontent.com` for a studio on `example.com`): full isolation, incl. cookies and same-site requests to the host's API. Browsers partition third-party service workers and BroadcastChannels by top-level site, so a preview URL opened **top-level in a new tab** can't reach the container (it hits the preview origin's server instead).
- **Same site, other origin** (e.g. `preview.example.com`): storage (`localStorage`, IndexedDB, Cache Storage) is still isolated, and top-level tabs keep working while the host tab is open (Chromium, Firefox). Cookies scoped to the parent domain, and requests to the host as "same-site", are shared with previews. Different ports on one host share all cookies.
- Safari/WebKit keys service worker registrations by top-level *origin*, so top-level preview tabs don't work there with any `previewOrigin`.

## Commands

- **jsh**: quotes, `$VAR`/`${VAR:-x}`, `VAR=x cmd`, `|`, `&&`, `||`, `;`, `>`, `>>`, `<`, `2>`, `2>&1`, `&>`. Builtins: `cd pwd ls cat echo mkdir rm rmdir mv cp touch env export unset which clear exit head tail grep wc sleep true false help`.
- **npm**: `install|i|add [pkgs] [-D] [-E]`, `ci`, `uninstall`, `run`, `start`, `test`, `init -y`, `exec`, `ls`, `pkg get/set`. Registry installs: semver, abbreviated packuments, parallel tarball fetch, sha integrity check, gunzip + untar, hoisting with nesting on conflict, peers, optional deps, `npm:` aliases, `.bin` shims, `package-lock.json` (written, not read). Persistent package cache in IndexedDB (`cresslet-npm`, shared by all containers on the origin): tarballs keyed by integrity (URL when there is none) and re-verified on read (a bad entry is evicted and refetched); packuments reused for 5 min (stale copy used if the registry is unreachable). A reinstall after a page reload makes no tarball requests. Silently in-memory only when IndexedDB is unavailable (e.g. some private modes); opt out with `boot({ npmCache: false })`. `github:`/`git+`/`file:`/URL specs are skipped with a warning; install scripts are skipped with a warning.
- **npx**: local `.bin`, built-ins, or temp-installs the package.
- **node**: Web Worker with CommonJS loader over the VFS; ESM/TS/JSX transformed to CJS by esbuild (top-level await supported). Builtins: fs (sync + promises + streams), path, events, process, buffer, util, url, os, assert, stream, timers(/promises), crypto (randomUUID/randomBytes/createHash/createHmac for sha1/256/384/512), http/https (`createServer().listen()` → virtual port; `request`/`get`/`fetch` incl. `localhost:<port>`), querystring, string_decoder, readline, module, tty, net (isIP only), vm, async_hooks, perf_hooks, worker_threads (stub). `child_process`, `net` sockets, `tls`, `zlib`, `dns`, `http2`… throw `[cresslet] … is not supported`. Express works.
- **vite** / **vite dev** / **vite --port N**: built-in dev server. **vite build**: production build. **vite preview**, **serve [dir] [-p N]**: static server with SPA fallback.
- **tsc**: no-op stub (type-checking skipped; esbuild strips types) so `tsc -b && vite build` scripts work.

## Dev server

Serves `index.html` (+ live-reload client), `public/`, SPA fallback. Transforms `.ts/.tsx/.jsx/.js` with esbuild (automatic JSX; import source from tsconfig `jsxImportSource` or react/preact deps; tsconfig `paths` aliases). Bare imports → `/@modules/<spec>`: all deps pre-bundled together in one esbuild run with code splitting (one copy of react), CJS named exports via cjs-module-lexer; newly discovered deps re-optimize and reload. CSS imports inject `<style>`, CSS modules (`*.module.css`), `?url`/`?raw`, asset and JSON imports, `import.meta.env` (`MODE`, `DEV`, `PROD`, `BASE_URL`, `VITE_*` from `.env*`), `%VITE_X%` in HTML. Errors → overlay.

**HMR**: the server keeps a module graph of what the page loaded and walks importers from a changed file to the nearest module that can accept the update. CSS (imported or `<link rel=stylesheet>`, incl. `@import`ed files) is swapped in place. React projects (`react-dom` dep, React JSX) get **React Fast Refresh**: `.jsx`/`.tsx` modules whose exports are all components are refresh boundaries, so component edits keep state; a changed hook signature remounts the component. Everything else falls back to the full reload: entry scripts and other modules no boundary accepts, `index.html`, `public/`, config/`.env`/`package.json`, dependency changes, deleted files, and any change after an error outside an update (failed initial load, uncaught runtime error). `import.meta.hot` is not exposed to app code.

## Build

Parses `index.html`, bundles each `<script type="module" src>` and local stylesheet (minify, splitting, `process.env.NODE_ENV=production`), emits CSS, hashes everything into `dist/assets/`, rewrites HTML, copies `public/` and HTML-referenced assets.

## Limitations

- Not real Node: real `vite`, `next`, `tsc`, native addons, `child_process`, raw sockets don't run (built-ins cover the common workflow).
- HMR covers CSS and React Fast Refresh only (no `import.meta.hot` API, no Preact/Vue/Svelte HMR; those full-reload). Refresh signatures come from a light pass over esbuild output, not Babel: hook changes are detected per component, but unusual code shapes may remount or reload instead. No PostCSS/Tailwind v3/Sass/Less (Tailwind via CDN works).
- `node` needs a cross-origin isolated page; without it sync fs/`require` fail with a clear error.
- `npm`: no lockfile-driven installs, no workspaces, no git/file deps, no lifecycle scripts. The package cache has no size cap/eviction of its own (the browser may evict it; clear with `indexedDB.deleteDatabase('cresslet-npm')`).
- Without `previewOrigin`, previews share the host origin (and its storage); a preview at `/` and a host page at `/` can't be told apart on a *top-level* reload. Manual reload of a preview frame after `pushState` is best-effort in WebKit.
- With a cross-site `previewOrigin` (or in WebKit), previews work in frames of the host page only, not as top-level tabs (see [Separate preview origin](#separate-preview-origin)).
- In-memory only: the VFS is lost on reload (persist with `export()`/`mount()`).

## Architecture

```
host page ──────────────────────────────────────────────────────────────┐
  Container ── VFS (main thread, in-memory)                             │
     ├─ jsh (parser + builtins) ── commands: npm · npx · vite · serve · node · registered
     ├─ npm: resolver (semver, hoist) → registry fetch → gunzip/untar → VFS
     ├─ node → Web Worker (CJS loader, polyfills) ⇄ SAB/Atomics sync RPC (fs, resolve, esbuild transform)
     ├─ dev server (module graph, HMR, React Refresh) / build → esbuild-wasm (VFS plugin)
     └─ PortTable ⇄ cresslet-sw.js ⇄ preview iframes (/__cresslet__/<id>/<port>/…)
          └─ or, with previewOrigin: ⇄ cresslet-relay.html (hidden iframe) ⇄ cresslet-sw.js on the preview origin
```

## Development

```sh
pnpm install
pnpm build       # dist/: cresslet-container.js, node-worker.js, cresslet-sw.js, cresslet-relay.{html,js}, index.d.ts (+ types/)
pnpm test        # vitest: VFS, parser, resolver/hoisting, tar, html, module resolution, relay message validation
pnpm test:e2e    # Playwright (chromium); test:e2e:all adds firefox + webkit
pnpm demo        # http://localhost:4400 (+ preview origin http://127.0.0.1:4401)
```

## Roadmap

VFS persistence (IndexedDB/OPFS snapshots; the npm cache already persists), npm cache size cap/LRU, `import.meta.hot` API + non-React HMR, lockfile-driven installs + workspaces, PostCSS/Tailwind, more Node compat (zlib, child_process via jsh), real Node via WASM for big CLIs, per-preview origins.

## License

MIT
