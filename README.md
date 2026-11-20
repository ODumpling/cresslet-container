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
5. Optional, recommended when the host keeps secrets in storage: a **separate preview origin** (`boot({ previewOrigin })`, see [below](#separate-preview-origin)). Previews and project code in workers (`node`, the CSS worker, `c.projectWorker`) then run there.

`pnpm demo` serves `demo/` with these headers (http://localhost:4400), plus a preview origin on http://127.0.0.1:4401 (try http://localhost:4400/?previewOrigin=http://127.0.0.1:4401).

## API

```ts
const c = await Container.boot({ serviceWorkerUrl?, esbuildWasmUrl?, registry?, workdir? /* '/home/project' */, npmCache? /* true, or { maxBytes } */, previewOrigin? /* e.g. 'https://preview.example.com' */ })
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

Extras (not in the original contract): `c.vfs` (sync FS), `c.ports`, `c.exec`, `c.which`, `c.path`, `boot({ serviceWorkerUrl: false })`, `boot({ npmCache: false })` (no persistent npm cache), `boot({ npmCache: { maxBytes } })` (npm cache size cap), `spawn(..., { terminal: true })` (CRLF output), `c.previewOrigin` (separate preview origin or `null`), `c.previewChannel(name)` (what the dev server notifies previews through), `c.cssWorker()` (the [CSS worker](#css-postcss--tailwind) dev servers and builds share), `boot({ cssPlugins: false })` (CSS processing runs no project code, see [CSS](#css-postcss--tailwind)), `await c.projectWorker(url, { name? })` (a module Web Worker for project code, e.g. an app's server handler: on the [preview origin](#separate-preview-origin) when there is one, else `new Worker(url, { type: 'module' })`).

Notes:
- Relative paths resolve against `workdir`.
- `spawn('jsh')` with no args is an interactive shell for xterm.js (raw keystrokes in, `\r\n` out, Ctrl+C kills the foreground job). Other commands emit `\n`.
- `servePort` handlers receive `Request` with URL `http://localhost:<port>/<path>`.
- `bundle` with `platform: 'node' | 'neutral'` keeps `node:*`/`npm:`/`jsr:` imports external; `external` globs and `packages: 'external'` are honoured.

## Previews

Preview URL: `${origin}/__cresslet__/<instanceId>/<port>/`. The SW forwards requests to the owning page (MessageChannel, streamed bodies) and adds `COEP: require-corp` + `CORP: same-origin`.

Root-relative paths keep working: the SW injects a one-line script into preview HTML that `history.replaceState`s the prefix away (apps and routers see `/`), and attributes later requests to the preview by the document's client id (persisted in Cache Storage across SW restarts). Full navigations inside a preview (links, reloads) are matched by the frame's current URL; live reload navigates through the prefixed URL so it works in every browser.

### Separate preview origin

By default previews share the host page's origin, so preview code (the user's app and its npm deps) can read the host's `localStorage`, IndexedDB and cookies, and so can project code in workers (`node`), IndexedDB and Cache Storage included. `boot({ previewOrigin: 'https://preview.example.com' })` runs both on another origin instead:

- The container adds a hidden iframe `${previewOrigin}/cresslet-relay.html?host=<host origin>`. The relay registers `${previewOrigin}/cresslet-sw.js?xorigin=1` (scope `/`) and bridges it to the container over one `MessageChannel`: the SW's requests for the owning page (`cresslet-who`, `cresslet-request`, reply ports and bodies transferred) go relay → container, (un)registration goes container → relay → SW. The relay accepts the handshake only from its `host` param's origin, from its parent window, and (where `location.ancestorOrigins` exists) only when the parent really is that origin; the container accepts the relay's hello only from `previewOrigin` and the relay iframe's window.
- Dev server notifications (live reload, HMR updates, overlay errors) go container → relay, which re-posts them on the same-named `BroadcastChannel` on the preview origin.
- `server-ready` / `port` URLs and `c.ports.url()` are `${previewOrigin}/__cresslet__/<id>/<port>/`. With `?xorigin=1` the SW sends `Cross-Origin-Resource-Policy: cross-origin` on preview responses, so the cross-origin-isolated host can frame them.
- Previews are same-origin with the relay (and so can script it); the container treats relay messages as untrusted and only answers what the SW could ask anyway: requests to this container's own ports. The SW takes ownership (register/unregister, owner probes, recovery after an SW restart) only from relay frames (`/cresslet-relay.html`, nested), never from preview windows; this is hygiene, not a security boundary (previews can script the relay frame and speak through it, see "One trust boundary per preview origin" below). It never routes `/cresslet-relay.html`, `/cresslet-relay.js` or `/cresslet-sw.js` to a preview, so the relay always comes from your server with its `frame-ancestors`. Relay errors are shown only during its setup, prefixed `preview relay:`.
- A forwarded request whose head doesn't arrive within 30 s (e.g. the relay reloaded mid-request) gets a `504` with `Retry-After: 1`; it isn't replayed.
- **Workers run in the relay too.** `node` processes (scripts, servers, npm bins, the [CSS worker](#css-postcss--tailwind)) and `c.projectWorker(url)` workers are started by the relay frame, on the preview origin: the container fetches the script (`node-worker.js` once per page, a project worker's `url` per call) and sends its source over the relay port, and the relay runs it from a `blob:` URL (so nothing more needs serving there, and a project worker's imports must be absolute URLs). Each one talks to the container over its own `MessagePort`, proxied by the relay (messages are cloned again there: MessagePorts pass through, transfer-only values such as streams don't). `node`'s sync calls block on a `SharedArrayBuffer`, which can't cross origins, so the relay owns it: the worker posts a call, the container answers, and the relay writes the result into the buffer. The relay frame gets `allow="cross-origin-isolated"` for that (it must be cross-origin isolated itself: COEP below). If the relay reloads, its workers die with it: their processes exit with `node: worker error: preview relay restarted` (project workers get an `onerror`); workers started while it reconnects wait for it.
- `serviceWorkerUrl` is unused with `previewOrigin` (`false` still disables previews; then there is no relay, and `node` / `c.projectWorker` fail to start rather than run on the host origin). If the relay reports an error or doesn't connect within 20 s, `boot` rejects (and removes the relay frame).

The host page keeps COOP/COEP as above. At the **preview origin's root**, serve these files from `dist/`, with these headers:

| Path | Headers |
| --- | --- |
| `/cresslet-relay.html` | `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: cross-origin`, `Content-Security-Policy: frame-ancestors <host origin>` (a stricter CSP must allow `worker-src blob:`) |
| `/cresslet-relay.js` | none required (same-origin to the relay); `Cross-Origin-Resource-Policy: cross-origin` is fine |
| `/cresslet-sw.js` | `Service-Worker-Allowed: /` |

`frame-ancestors` is the real guard against other sites (and previews) framing the relay (the origin checks above are a second layer; Firefox has no `ancestorOrigins`). It is checked against every ancestor: if the host page is itself framed (e.g. by a dashboard), list all of its ancestors' origins too, or the relay won't load. Nothing else needs to be served there: every `/__cresslet__/…` URL is answered by the service worker. Serving the whole preview origin with COEP + CORP as `scripts/serve.mjs` does is fine too.

What it does and doesn't isolate:
- **One trust boundary per preview origin.** All previews served from one `previewOrigin` (every container, every port, every tab) share that origin: they can script each other's frames and the relay, read each other's storage, and answer each other's requests. Use distinct preview origins for containers that must not trust each other (e.g. different users' projects).
- **What moves, what doesn't.** Previews, `node` processes and project workers run on the preview origin: they can't open the host's IndexedDB or Cache Storage, and requests to the host are cross-origin. The container itself (VFS, shell, npm, esbuild, the dev server and builds) stays on the host page; it runs no project code there except `servePort` / dev server `middleware` handlers the host registers, and the host's own registered commands. Workers still get the container's VFS (their project's files) over their port, as before.
- **Workers are in the preview origin's trust boundary.** Previews can script the relay frame, so they can reach the workers it runs, and through a `node` process, its container's VFS: on one preview origin, a project's client code can do what its server code can (and, as above, other containers' previews there can too).
- **Cross-site preview origins need third-party service workers and storage.** Browsers or settings that block them (some privacy modes, "block third-party cookies" in some browsers) make the relay fail: `boot` rejects with a `preview relay:` error that says so. Fall back to a same-site preview origin or no `previewOrigin`.

Choosing the origin:
- **Different site** (e.g. `preview.example-usercontent.com` for a studio on `example.com`): full isolation, incl. cookies and same-site requests to the host's API. Browsers partition third-party service workers and BroadcastChannels by top-level site, so a preview URL opened **top-level in a new tab** can't reach the container (it hits the preview origin's server instead).
- **Same site, other origin** (e.g. `preview.example.com`): storage (`localStorage`, IndexedDB, Cache Storage) is still isolated, and top-level tabs keep working while the host tab is open (Chromium, Firefox). Cookies scoped to the parent domain, and requests to the host as "same-site", are shared with previews. Different ports on one host share all cookies.
- Safari/WebKit keys service worker registrations by top-level *origin*, so top-level preview tabs don't work there with any `previewOrigin`.

## Commands

- **jsh**: quotes, `$VAR`/`${VAR:-x}`, `VAR=x cmd`, `|`, `&&`, `||`, `;`, `>`, `>>`, `<`, `2>`, `2>&1`, `&>`. Builtins: `cd pwd ls cat echo mkdir rm rmdir mv cp touch env export unset which clear exit head tail grep wc sleep true false help`.
- **npm**: `install|i|add [pkgs] [-D] [-E]`, `ci`, `uninstall`, `run`, `start`, `test`, `init -y`, `exec`, `ls`, `pkg get/set`. Registry installs: semver, abbreviated packuments, parallel tarball fetch, sha integrity check, gunzip + untar, hoisting with nesting on conflict, peers, optional deps, `npm:` aliases, `.bin` shims, `package-lock.json` (written, not read). Persistent package cache in IndexedDB (`cresslet-npm`, shared by all containers on the origin): tarballs keyed by integrity (URL when there is none) and re-verified on read (a bad entry is evicted and refetched); packuments reused for 5 min (stale copy used if the registry is unreachable). A reinstall after a page reload makes no tarball requests. Size-capped at 256 MiB by default (`boot({ npmCache: { maxBytes } })`, `Infinity` for no cap; sizes are approximate: tarball bytes, packument JSON length): a write (or a batch of read hits) past the cap evicts least-recently-used entries (last write or read hit, across both stores, shared by every container on the origin); an entry bigger than the cap isn't stored. Upgrading from a cache written before the cap existed starts it empty once. Silently in-memory only when IndexedDB is unavailable (e.g. some private modes); opt out with `boot({ npmCache: false })`. `github:`/`git+`/`file:`/URL specs are skipped with a warning; install scripts are skipped with a warning.
- **npx**: local `.bin`, built-ins, or temp-installs the package.
- **node**: Web Worker with CommonJS loader over the VFS; ESM/TS/JSX transformed to CJS by esbuild (top-level await supported). Builtins: fs (sync + promises + streams), path, events, process, buffer, util, url, os, assert, stream, timers(/promises), crypto (randomUUID/randomBytes/createHash/createHmac for sha1/256/384/512), http/https (`createServer().listen()` → virtual port; `request`/`get`/`fetch` incl. `localhost:<port>`), querystring, string_decoder, readline, module, tty, net (isIP only), vm, async_hooks, perf_hooks, worker_threads (stub). `child_process`, `net` sockets, `tls`, `zlib`, `dns`, `http2`… throw `[cresslet] … is not supported`. Express works.
- **vite** / **vite dev** / **vite --port N**: built-in dev server. **vite build**: production build. **vite preview**, **serve [dir] [-p N]**: static server with SPA fallback.
- **tsc**: no-op stub (type-checking skipped; esbuild strips types) so `tsc -b && vite build` scripts work.

## Dev server

Serves `index.html` (+ live-reload client), `public/`, SPA fallback. Transforms `.ts/.tsx/.jsx/.js` with esbuild (automatic JSX; import source from tsconfig `jsxImportSource` or react/preact deps; tsconfig `paths` aliases). Bare imports → `/@modules/<spec>`: all deps pre-bundled together in one esbuild run with code splitting (one copy of react), CJS named exports via cjs-module-lexer; newly discovered deps re-optimize and reload. CSS imports inject `<style>`, CSS modules (`*.module.css`), `?url`/`?raw`, asset and JSON imports, `import.meta.env` (`MODE`, `DEV`, `PROD`, `BASE_URL`, `VITE_*` from `.env*`), `%VITE_X%` in HTML, [PostCSS and Tailwind CSS](#css-postcss--tailwind). Errors → overlay.

**HMR**: the server keeps a module graph of what the page loaded and walks importers from a changed file to the nearest module that can accept the update. CSS (imported or `<link rel=stylesheet>`, incl. `@import`ed files) is swapped in place. React projects (`react-dom` dep, React JSX) get **React Fast Refresh**: `.jsx`/`.tsx` modules whose exports are all components are refresh boundaries, so component edits keep state; a changed hook signature remounts the component. Everything else falls back to the full reload: entry scripts and other modules no boundary accepts, `index.html`, `public/`, config/`.env`/`package.json`, dependency changes, deleted files, and any change after an error outside an update (failed initial load, uncaught runtime error). `import.meta.hot` is not exposed to app code.

## CSS: PostCSS & Tailwind

Stylesheets (imported, `<link>`ed, `@import`ed, CSS modules) go through the project's own packages, in the dev server and `build` alike:

- **Tailwind CSS v4** when the project depends on `tailwindcss` / `@tailwindcss/postcss` / `@tailwindcss/vite` and a stylesheet uses Tailwind syntax (`@import "tailwindcss"`, `@theme`, `@apply`, `@utility`, `@plugin`, `@config`, `@source`, …). It runs the installed `tailwindcss`'s own compiler (`compile()`, pure JS); `@import`s of packages resolve through their `style` export (`tailwindcss/theme.css`, `tw-animate-css`), `@plugin`/`@config` load through the `node` loader. Tailwind's native scanner (oxide) can't run here, so content detection is done by the container: every file under the project root except `node_modules/` and dot-dirs (at any depth), `dist/`, `build/`, `out/`, `coverage/` (at the root of the scanned dir), stylesheets, lockfiles, binaries and files over 2 MB, plus `@source` paths/globs, split into class candidates (a superset; non-utilities are ignored). Directory symlinks are followed, except into an ancestor or a loop. Each stylesheet's own source rules (`@source`, `@source not`, `source(none)`, `source("dir")`) are read before its first build and apply to it alone (stylesheets with different rules don't share candidates).
- **PostCSS** when there's a `postcss.config.{js,mjs,cjs,ts}` / `.postcssrc.{js,cjs,mjs,json}`: its plugins (object or array form, function configs get `{ env }`) run on every stylesheet, from the project's `postcss` (an error says so if it isn't installed). `@tailwindcss/postcss` (which needs native oxide/lightningcss) is swapped for the built-in v4 compiler, whether named in an object config or `import`ed; a config without a Tailwind plugin in a Tailwind v4 project (as with `@tailwindcss/vite`) gets v4 compiled first, then its plugins. Tailwind v3 (`tailwindcss: {}` + `tailwind.config.*`) runs as the real v3 PostCSS plugin; its content globs (`dir-dependency`) drive HMR.

These run in the **CSS worker**: one long-lived `node` process per container (started on the first stylesheet that needs it, restarted when `package.json`, the PostCSS config or `node_modules` change), so plugins get the same Node built-ins as `node` and stay off the main thread. Plain CSS in projects with neither never starts it. A request that takes over 30 s fails (and recycles the worker); requests a restart cuts off are retried on the new worker. `build` starts Tailwind from scratch (only its own sources' classes) with `NODE_ENV=production` for configs/plugins. Errors (syntax errors, a plugin that can't load or throws) go to the overlay: imported CSS throws from its module, `<link>`ed CSS is reported to the page.

**HMR**: editing a stylesheet or anything it `@import`s swaps it in place; so does editing a Tailwind config/plugin or (v3) a file in its content globs. A source file that brings **new** Tailwind class candidates re-serves the Tailwind stylesheets in the same update as the component's Fast Refresh, so new utilities apply without a reload (like Tailwind itself, the candidate set only grows during a session).

**Security**: serving or building a stylesheet runs project code (the PostCSS config and its plugins, Tailwind `@plugin`/`@config` modules) in the CSS worker, a `node` process: on the host page's origin, or on the [preview origin](#separate-preview-origin) with `previewOrigin`. For untrusted projects without a preview origin, `boot({ cssPlugins: false })` ignores PostCSS configs and refuses `@plugin`/`@config`; Tailwind v4 core still compiles (so the installed `tailwindcss` package's own code still runs there).

## Build

Parses `index.html`, bundles each `<script type="module" src>` and local stylesheet (minify, splitting, `process.env.NODE_ENV=production`), runs [PostCSS/Tailwind](#css-postcss--tailwind) on stylesheets (same pipeline as the dev server; PostCSS function configs get `env: 'production'`), emits CSS, hashes everything into `dist/assets/`, rewrites HTML, copies `public/` and HTML-referenced assets.

## Limitations

- Not real Node: real `vite`, `next`, `tsc`, native addons, `child_process`, raw sockets don't run (built-ins cover the common workflow).
- HMR covers CSS and React Fast Refresh only (no `import.meta.hot` API, no Preact/Vue/Svelte HMR; those full-reload). Refresh signatures come from a light pass over esbuild output, not Babel: hook changes are detected per component, but unusual code shapes may remount or reload instead. No Sass/Less/Stylus.
- CSS: PostCSS plugins must be pure JS (native addons, `child_process`, workers don't run); `postcss-load-config`'s YAML/`.postcssrc` (no extension) and `package.json#postcss` aren't read. Tailwind v4 output isn't run through lightningcss (no `optimize`, nesting/`@property` left for the browser; minified by esbuild in `build`). Content detection ignores `.gitignore` (fixed skip list instead) and tokenizes generically (a superset of Tailwind's own candidates; classes assembled from string fragments are missed, as in Tailwind). Tailwind v3 works through PostCSS but is best-effort (tested: build + HMR of a React app).
- `node` needs a cross-origin isolated page; without it sync fs/`require` fail with a clear error.
- `npm`: no lockfile-driven installs, no workspaces, no git/file deps, no lifecycle scripts. The package cache is cleared with `indexedDB.deleteDatabase('cresslet-npm')`; the browser may also evict it.
- Without `previewOrigin`, previews and `node` share the host origin (and its storage); a preview at `/` and a host page at `/` can't be told apart on a *top-level* reload. Manual reload of a preview frame after `pushState` is best-effort in WebKit.
- With a cross-site `previewOrigin` (or in WebKit), previews work in frames of the host page only, not as top-level tabs (see [Separate preview origin](#separate-preview-origin)).
- In-memory only: the VFS is lost on reload (persist with `export()`/`mount()`).

## Architecture

```
host page ──────────────────────────────────────────────────────────────┐
  Container ── VFS (main thread, in-memory)                             │
     ├─ jsh (parser + builtins) ── commands: npm · npx · vite · serve · node · registered
     ├─ npm: resolver (semver, hoist) → registry fetch → gunzip/untar → VFS
     ├─ node → Web Worker (CJS loader, polyfills) ⇄ SAB/Atomics sync RPC (fs, resolve, esbuild transform)
     │    └─ with previewOrigin: started by the relay on the preview origin (it owns the SAB), proxied over a MessagePort
     ├─ dev server (module graph, HMR, React Refresh) / build → esbuild-wasm (VFS plugin)
     │    └─ stylesheets → CSS worker (`node` process: project's postcss + plugins, tailwindcss compile(); candidates scanned on the main thread)
     └─ PortTable ⇄ cresslet-sw.js ⇄ preview iframes (/__cresslet__/<id>/<port>/…)
          └─ or, with previewOrigin: ⇄ cresslet-relay.html (hidden iframe) ⇄ cresslet-sw.js on the preview origin
```

## Development

```sh
pnpm install
pnpm build       # dist/: cresslet-container.js, node-worker.js, cresslet-sw.js, cresslet-relay.{html,js}, index.d.ts (+ types/)
pnpm test        # vitest: VFS, parser, resolver/hoisting, tar, html, module resolution, relay message validation, CSS scanning + worker (real tailwindcss/postcss/autoprefixer)
pnpm test:e2e    # Playwright (chromium); test:e2e:all adds firefox + webkit
pnpm demo        # http://localhost:4400 (+ preview origin http://127.0.0.1:4401)
```

## Roadmap

VFS persistence (IndexedDB/OPFS snapshots; the npm cache already persists), `import.meta.hot` API + non-React HMR, lockfile-driven installs + workspaces, Sass/Less, more Node compat (zlib, child_process via jsh), real Node via WASM for big CLIs, per-preview origins.

## License

MIT
