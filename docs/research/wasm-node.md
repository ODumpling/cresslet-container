# Real Node via WASM for heavy CLIs (issue #12)

Research for [#12][issue]: can real `vite`, `next`, `tsc` (and tools like them) run in a browser through a WASM Node build, or something like one, as a fallback runtime behind cresslet's polyfilled `node`? This covers download size, startup time, and the fs/net bridges.

State as of 2026-11-21. Primary sources only: repos, docs, npm registry metadata, release assets, first-party posts. Sizes come from `npm view <pkg> dist.unpackedSize`, downloaded tarballs and assets (`gzip -9` sizes measured locally unless marked), or `Content-Length` headers. **unverified** marks anything I couldn't confirm in a primary source.

## TL;DR

- **Nobody ships upstream Node.js compiled to WASM.** I found no official effort in nodejs/node. V8 inside wasm would have to run jitless, and jitless V8 was about 80% slower on the Web Tooling Benchmark when V8 measured it in 2019 ([v8-jitless]).
- **There are two serious "real Node in the browser" runtimes today. The one with an open core is Wasmer's Edge.js on `@wasmer/sdk`.** Edge.js is Node's own `lib/` and `src/`, ported so its bindings go through N-API. Its libuv/syscall layer is a WASIX module, and in the browser the JS runs on the page's own engine through a host-provided N-API, so it keeps the JIT ([edge-readme], [edge-arch], [edge-sec]). Wasmer's browser shell runs real `next dev --webpack` on it (tested), and ships a Vite 8 example (vinext, untested) ([sdk-next], [sdk-vinext]). The costs: a 78 MB package served uncompressed (about 25 MB if gzipped, measured locally), alpha status, JSPI and COOP/COEP required, and a "Modified MIT" SDK license with an attribution clause ([sdk-license]).
- **Leaning Technologies' BrowserPod is the other one:** Node 22 compiled to Wasm, JS on the page's engine, about 15 MB to first `node` output (measured). It's proprietary: CDN-only, with a required "Powered by BrowserPod" credit, and its servers are reachable only through Leaning's metered network ([bp-node], [bp-license], [bp-net]).
- **StackBlitz WebContainers runs vite and next, but it is a hosted, proprietary runtime.** The client package is MIT, but the runtime loads from stackblitz.com, and production for-profit use needs a commercial license ([wc-enterprise]). It can't be embedded as an MIT library's built-in.
- **x86 emulators (CheerpX/WebVM, v86, container2wasm, JSLinux) run real Linux `node` binaries, but they don't fit.** CheerpX and v86 are 32-bit only (the last i386 Node build is v21.7.3). CheerpX is proprietary. Networking needs a VPN or a proxy. Their filesystems are block or 9p devices, not a JS VFS.
- **QuickJS-based runtimes (quickjs-emscripten, wasmedge-quickjs, LLRT) aren't Node** and are slower than the browser's own engine.
- **The cheaper path is pieces that already ship as wasm, run on cresslet's own `node`.** These are TypeScript 7's experimental `tsc.wasm` (wasip1, with a JS file-system callback API), `@next/swc-wasm-nodejs`, `@rolldown/binding-wasm32-wasi` and esbuild-wasm. Rolldown and Next already special-case WebContainers to load them ([rolldown-wc], [next-swc]). The JS `tsc` (TypeScript ≤ 6.0) needs only `fs`/`path`/`os`/`crypto` ([ts6-sys]); 5.9.3 was measured working on cresslet's `node` (below), 6.x is expected to from its `sys.ts`.

## Measured: real CLIs on cresslet's own `node`

Run in headless Chromium on 2026-11-21, against `main` at b41308a, after `npm install` from the public registry (vite 7.3.8, next 15.5.29, typescript 5.9.3 and 7.0.2):

| Command | Result before this change |
|---|---|
| `node node_modules/typescript/bin/tsc -p .` (5.9.3) | **Works**: reports TS2322 and exits 2, in about 350 ms warm. |
| `node node_modules/typescript/bin/tsc -v` (7.0.2) | Fails loudly with exit 1: `Unable to resolve @typescript/typescript-linux-x64` (its bin runs a native executable). |
| `node node_modules/vite/bin/vite.js --version` | Exit 1: `SyntaxError` (the ESM bin isn't loaded as ESM). This is what `./node_modules/.bin/vite` runs. |
| `node node_modules/vite/dist/node/cli.js build` (not a bin, so not detected by this change) | **Exit 0 with no output** after about 1 s. Kept alive with a `setInterval`, it shows the error: `Identifier '__dirname' has already been declared` in `chunks/build.js`. |
| `node node_modules/next/dist/bin/next build` / `dev` | **Exit 0 with no output** in about 50 ms. Kept alive, it shows `Failed to fetch dynamically imported module: …/cli/next-build.js` (a native `import()` that the CJS loader doesn't route to the VFS). |
| `vite build` (the built-in command) | Works. |

So the polyfilled `node` doesn't just fail on heavy CLIs: it can **exit 0 silently**, because the worker exits when nothing holds it open, before the rejected import surfaces. Getting past these loader gaps would still hit the native-addon wall: rollup's or rolldown's native binding for vite, SWC for next (see §10).

## What this change ships

Not a runtime, given the findings below: a detection path and a hook.

- When `node` is asked to run a heavy CLI's bin script (`next`, and vite's own bins), it fails at once with an error naming the CLI and `boot({ fallbackRuntime })`. For `next` that replaces the silent exit 0 above; for vite's bin, the `SyntaxError`. This applies however it starts: a package script, a `.bin` shim (also `node node_modules/.bin/next`), `npx`, `node <path>` or `child_process`. `next --version` / `--help` alone still run on `node`, as they work there (vite's don't, so they get the error too). The built-in `vite` and `tsc` commands are unchanged.
- `boot({ fallbackRuntime })` gets those runs instead, with the command's context (`args`, `cwd`, `env`, stdio, `signal`, `container`) plus `{ package, bin, entry }`, and returns the exit code. A host can plug in Edge.js, WebContainers or a remote machine there. The extras listed at the end of this doc (prepare step, TTY resize, two-way file sync) are left until an adapter needs them.

## Why JIT matters

V8's `--jitless` mode runs Ignition (the interpreter) only and interprets regexps too. V8 measured Speedometer 2.0 about 40% slower and the **Web Tooling Benchmark 80% slower**, and "WebAssembly is currently unsupported" in that mode ([v8-jitless]); these are 2019 numbers. V8 has since added an optional Wasm interpreter, DrumBrake, which a Node issue asked to enable for jitless builds ([node-drumbrake]), but it's a build option, not stock Node. Wasm code can't generate and run new machine code in place. A JS engine compiled to wasm is therefore an interpreter, unless it emits new wasm modules at runtime (as v86 and CheerpX do for x86 code ([v86-readme], [cx-overview])). Bundlers and type-checkers are exactly the code the Web Tooling Benchmark measures. A good fallback should run JS on the browser's own JIT and put only the OS layer in wasm. Edge.js's host-napi mode and BrowserPod document doing this (§2, §3); WebContainers' engine details aren't documented (**unverified**).

## Candidates

### 1. Node.js compiled to WASM/WASI directly

- **What:** No official nodejs/node build for wasm32. Searches of nodejs/node issues for wasm32/emscripten/browser builds found only unrelated issues ([node-issues-search]). Node's lite mode implies jitless, which disables WebAssembly ([node-pr-48248], [node-28800]).
- **Community:** Strapkit claims "Node.js runtime compiled to WebAssembly". It has 2 stars, no license and no releases ([strapkit]): **unverified**, not usable. The Edge.js post mentions a "Node-WASIX" effort that compiled V8 into wasm, but I couldn't find a repo (**unverified**).
- **Verdict:** Doesn't exist in usable form. Even if it did, V8 would be jitless, so heavy CLIs would run several times slower ([v8-jitless]).

### 2. Wasmer: Edge.js + `@wasmer/sdk` (and WinterJS)

- **What:** Edge.js is "a secure JavaScript runtime" that aims to be "fully compatible with Node.js", with a pluggable engine (V8, JavaScriptCore or QuickJS) ([edge-readme]). It isn't a reimplementation from scratch: "`edge` source and tests should be ported from Node as fully as possible". The one exception is direct V8 API use, which is rewritten to N-API ([edge-arch]). The repo carries Node's `lib/` (e.g. `lib/internal/bootstrap/node.js`) ([edge-tree]). Wasmer reports 3592/3626 Node test categories passing (vs Bun 1513, Deno 1607), measured natively on an M3 Max ([edge-post]). Node 24 only (v24.13.2) ([edge-node-post]). Edge.js is MIT ([edge-license]), version 0.2.5 ([edge-version]). It is under active development (last push 2026-11-17).
- **Browser mode:** The `wasmer/edge` package is described as "Edge.js with host-provided N-API and no embedded JavaScript engine" ([wasmer-registry]). The guest wasm imports N-API, and "a compatible host provides those imports using its own JavaScript engine". The README says: "The browser regression gate covers package installation, timers, promises, workers, networking, HTTP, and a rendered Next.js development preview" ([edge-readme]). The JS executes in the host realm, which is explicitly "not a security boundary" yet ([edge-sec]). It runs through `@wasmer/sdk/browser`, where Wasmer + WASIX are compiled to wasm with wasm-bindgen ([sdk-js-readme]).
- **Size:** `wasmer/edge@0.2.1` webc is 78,396,178 bytes. It's served uncompressed (no `Content-Encoding`), about 25.0 MB with `gzip -6` (measured). It bundles npm, pnpm and SSL certs, and depends on `wasmer/bash` ([wasmer-registry], [edge-webc]). `@wasmer/sdk@0.19.1` runtime wasm is 4.83 MB (1.79 MB gzip, measured) ([npm-wasmer-sdk]). Next.js additionally downloads `@next/swc-wasm-nodejs` on first start ([sdk-next]), which is 30.8 MB raw / 6.8 MB gzip (measured).
- **Startup:** Native only: V8 cold 102 ms / warm 60 ms, QuickJS cold 196 ms / warm 92 ms ([edge-node-post]). Wasmer's browser Next.js test records shell/install/dev-ready/preview timings but publishes no numbers ([sdk-next-test]). Browser startup: **none published**.
- **fs bridge:** The guest filesystem is the sandbox's in-memory FS. The host gets `files` at creation and an async `sandbox.fs` (`readFile`/`writeFile`/`readDir`/`stat`/`rename`/`remove`) ([sdk-dts]). The SDK also has an "experimental worker-only native directory mount" (`mountHost`), which uses a SharedArrayBuffer RPC message (`wasmer-filesystem-rpc`) and is described as "used by the iOS prototype" ([sdk-dts]). That is close in shape to cresslet's SAB RPC, but it's experimental. Wasmer's Next example sets `WATCHPACK_POLLING=true` ([sdk-next-pkg]), so assume no native fs events.
- **net bridge:** Outbound TCP/DNS goes over a WISP WebSocket relay that you host (`network: { mode: "wisp", url }`). Sandboxes share a virtual localhost. `ports.expose(port)` serves one HTTP listener per service worker origin, and "to serve guests concurrently, assign each one its own origin". By default it uses Wasmer's managed host `default.local.wasmer.site`, but it can be self-hosted (`@wasmer/sdk/service-worker`) ([sdk-js-readme]).
- **Threads/processes:** WASIX workers. The browser gate covers workers ([edge-readme]), and Wasmer Edge advertises multithreading and subprocesses ([edge-node-post]). wasmer.sh requires WebAssembly JSPI (Chrome/Edge 137+, Firefox 153+, Safari 27+) ([sdk-compat]). The SDK requires a cross-origin isolated page (COOP `same-origin` + COEP `require-corp`) ([sdk-js-readme]).
- **License:** Edge.js is MIT. `@wasmer/sdk` is a "Modified MIT License": products with more than 1M MAU or more than $1M monthly revenue "shall prominently display 'Wasmer'" in their UI ([sdk-license]). An MIT library can call it as an optional peer dependency, but the clause passes through to cresslet's users. The SDK is "currently alpha" ([sdk-readme]).
- **vite/next/tsc:** Next.js 16.3.3 via `next dev --webpack` (Turbopack needs native bindings) ([sdk-next-pkg], [next-swc]). The Vinext example uses `vite@8.2.0` ([sdk-vinext]). I found no browser test for plain vite: **unverified**. `tsc` (TS 7) spawns a native exe ([ts7-tsc]), so it would need `tsc.wasm` instead (**unverified**).
- **WinterJS:** Archived (2026-03), "deprecated in favor of the Edge.js JS runtime". It was a SpiderMonkey WinterCG server, not Node ([winterjs]).

### 3. BrowserPod (Leaning Technologies)

- **What:** "Node.js 22 compiled from its own C++ source to WebAssembly, with JavaScript running on the browser's engine" ([bp-node]). V8 API calls go to "our custom implementation, based on native browser capabilities" ([bp-beta]), so JS keeps the page's JIT ([bp-deep]). It runs on a Wasm Linux-like kernel split out of CheerpX's syscall layer, without CheerpX's x86 JIT ([bp-beta], [bp-deep]). npm, pnpm, bash and git are included ([bp-docs]). A run reported `process.version` v22.15.0 and `process.arch` `wasm32` (measured). Version 4.1.0 ([bp-npm]).
- **How it runs:** `@leaningtech/browserpod@4.1.0` is a 35 kB stub that `import()`s `https://rt.browserpod.io/4.1.0/browserpod.js`; disk images stream in blocks over `wss://disks.browserpod.io` ([bp-npm], [bp-lod]). Self-hosting needs an Enterprise licence ([bp-lic]). The page must be cross-origin isolated ([bp-coi]). Each process runs in its own Worker ([bp-deep]). Chrome, Edge, Firefox and Safari 27+; JSPI isn't required ([bp-docs], [bp-deep]).
- **Size / startup:** First-party claims are qualitative only ("start near-instantly") ([bp-docs], [bp-lod]). `bpnode.wasm` is 30.6 MB raw, 12.0 MB gzip, 7.95 MB brotli ([bp-rt]). One headless Chromium cold run against the 4.1.0 CDN (measured): `boot()` 1.0–1.5 s, the first `node -v` 0.9 s, about 15.5 MB transferred to first output, about 1 s per later `node -e`.
- **fs bridge:** Async file handles only: `createDirectory`, `createFile`/`openFile`, `read`, `write`, `getSize`, `close`. No readdir, stat, rename or watch, so files are copied in and out ([bp-ref], [bp-dts]). Optional persistence via `storageKey` (OPFS, else IndexedDB) ([bp-fs]).
- **net bridge:** Outbound HTTP(S)/WebSocket through a host-supplied `fetch` hook, subject to CORS (free) ([bp-net], [bp-fetchnet]). Inbound access to a pod's server only through metered Edge "Portals" at `<id>-<port>.browserportal.io` ([bp-portals], [bp-net]); there's no service-worker preview ([bp-docs]). So its servers wouldn't show in cresslet's previews without a tunnel (**unverified**).
- **Threads/processes:** A Worker per process or thread, with shared memory ([bp-deep]). `pod.run` is execve-like and returns an exit code ([bp-run]). Native npm binaries need wasm overrides (esbuild-wasm, `@rollup/wasm-node`, `@next/swc-wasm-nodejs`) ([bp-native]).
- **License:** Proprietary "BrowserPod Community Licence": free including commercial use, but it requires a visible "Powered by BrowserPod" credit, and the files may load only from the official CDN (no hosting, mirroring, proxying or bundling) ([bp-license]). Edge Pro ($20/month) drops the credit; Enterprise is quoted ([bp-lic]). An MIT library can't bundle it; a host could plug it in through `fallbackRuntime` and take on those terms.
- **vite/next/tsc:** Changelog: "Support Vite 8", "Initial support for Next.js 16" ([bp-changelog]). Measured on 4.1.0: `npm i typescript vite` 30 s, `tsc a.ts` works, `vite build` works with the esbuild/rollup wasm overrides (4.5 s). `vite dev`, `next dev` and `next build`: not tested.
- **Verdict:** Technically the most complete option (real Node 22, about 15 MB cold, no JSPI, out of beta), but closed, CDN-only, with a required credit, and its server previews go through Leaning's metered network. A host-supplied adapter at most.

### 4. StackBlitz WebContainers (`@webcontainer/api`)

- **What:** "A browser-based runtime for executing Node.js applications and operating system commands", "entirely client-side" ([wc-intro]). The 2021 launch post describes a WebAssembly-based OS and a "virtualized TCP network stack" mapped to Service Workers ([wc-blog]). Whether JS runs on the browser engine: **unverified** (not documented). Other projects' code shows it reports `process.versions.webcontainer`. Next.js loads SWC's wasm bindings first when it sees it ([next-swc]). Rolldown downloads `@rolldown/binding-wasm32-wasi` "on WebContainer" ([rolldown-wc]). So it runs neither native addons nor Turbopack.
- **How it runs:** `@webcontainer/api@1.6.4` is a 181 KB MIT client ([npm-wc]). The runtime itself loads from StackBlitz (`editorOrigin` default `https://stackblitz.com`) ([wc-dts]). The page must be cross-origin isolated (COEP `require-corp` or `credentialless`) ([wc-headers]). Projects run on StackBlitz subdomains with their own service worker, and third-party cookies for `*.stackblitz.io`/`*.webcontainer.io` may need allowing ([wc-browser]). Only one instance can boot at a time ([wc-dts]).
- **Size / startup:** Runtime size **unverified** (not published). StackBlitz claims "spinning up the entire dev environment in milliseconds" ([wc-intro]) and, in 2021, builds "up to 20% faster" and installs "≥ 5x faster than yarn/npm" ([wc-blog]). There are no published boot numbers.
- **fs:** In-memory. `mount(tree)`, `fs.*`, `fs.watch`, `export()` ([wc-dts]). No shared or external FS. Copy in and out.
- **net:** Virtual ports surface as `server-ready` URLs through StackBlitz's service worker ([wc-dts], [wc-blog]).
- **License:** Free for prototypes, POCs and open source. "Licensing is required for production usage of the API in a commercial, for-profit setting". Prices aren't published ([wc-enterprise], [wc-intro]).
- **vite/next/tsc:** Vite and webpack are named ([wc-intro]), Next.js since launch ([wc-blog]). TS 7 `tsc`: **unverified** (it spawns a native binary ([ts7-tsc])).
- **Verdict:** It works, but it's proprietary, hosted and licensed. A *user* could plug it in through `fallbackRuntime`, but cresslet can't bundle it.

### 5. CodeSandbox Nodebox (`@codesandbox/nodebox`) / Sandpack

- **What:** "Nodebox does not emulate Node.js but is, instead, a Node.js-compatible runtime": it "implement[s] as much of the Node.js API as possible", module by module ([nodebox-readme]). It's the same approach as cresslet. Limitations: no N-API modules, no sockets to external IPs, no sync exec/spawn ([nodebox-readme]).
- **How it runs:** The runtime runs in an iframe hosted by CodeSandbox by default; self-hosting is possible ([nodebox-readme]). The client is 102 KB ([npm-nodebox]). Runtime size: **unverified**.
- **License:** "Sustainable Use License": use "only for your own internal business purposes or for non-commercial or personal use" ([nodebox-license]). Not embeddable in an MIT library.
- **Maintenance:** The repo was last pushed 2023-11-29 ([nodebox-repo]). Effectively dormant.
- **vite/next/tsc:** Its tutorial runs a Next.js example ([nodebox-readme]). Current versions: **unverified**. It doesn't help cresslet: same class of runtime, weaker license.

### 6. CheerpX / WebVM (Leaning Technologies)

- **What:** An x86-to-WebAssembly JIT for "user-mode code on top of a Linux-compatible system call interface" ([cx-overview]). It runs real Linux binaries, so it would run a real `node`. "Currently, only 32-bit x86 binaries are supported" ([cx-meta]). WebVM's Debian image is `i386/debian:buster` with apt's `nodejs` ([webvm-docker]). Buster's nodejs is v10: **unverified**. Official 32-bit Linux x86 Node builds stopped at v9.11.2, and unofficial `linux-x86` builds at v21.7.3 ([node-dist], [node-unofficial]). Current vite needs `^20.19.0 || >=22.12.0`, next `>=20.9.0` ([npm-vite], [npm-next]). On top of that, rolldown and next have no `linux-ia32` native bindings, so they would need the wasm ones. Running them is **unverified**.
- **Size:** The core files I fetched from `cxrtnc.leaningtech.com/1.4.0/` (`cx_esm.js`, `cxcore.wasm`, `cxcore.js`, `cheerpOS.js`, `cxbridge.js`) are about 0.62 MB brotli on the wire (measured). Disk images stream on demand ("2GB complete Debian system" streamed) ([cx-overview]). WebVM's default disk is `wss://disks.webvm.io/debian_buster_large_…ext2` ([webvm-config]).
- **Startup:** **None published** ([cx-overview]).
- **fs:** Block and file devices: `HttpBytesDevice` (ext2 over HTTP), `IDBDevice`, `WebDevice` (read-only HTTP), `DataDevice` (in-memory, JS writes in), `OverlayDevice`. JS can `writeFile` into a DataDevice and `readFileAsBlob` from an IDBDevice ([cx-fs]). The docs don't mention a custom JS-backed FS, so cresslet's VFS would have to be copied in and out.
- **net:** "Networking with WebVM always happens via Tailscale" (WireGuard over WebSockets). Internet access needs an exit node ([cx-net]). The 1.4 module also exports `DirectSocketsNetwork` ([cx-esm]). Exposing VM servers to preview iframes: **unverified** (not documented).
- **License:** Proprietary. Free for individuals, FOSS and evaluation. Business use, redistribution, OEM and **self-hosting** require a commercial license ([cx-license], [cx-meta]). WebVM's own UI is Apache-2.0 ([webvm-repo]).
- **Verdict:** Not viable: proprietary, CDN-bound, 32-bit only, old Node.

### 7. v86, container2wasm, JSLinux/TinyEMU (full-system emulators)

- **v86:** An x86 PC emulator with an x86-to-wasm JIT. It has no multicore and no 64-bit extensions ("64-bit kernels are not supported") ([v86-readme]). BSD-2-Clause, active ([v86-readme], [npm-v86]). `v86.wasm` is 2.0 MB (0.38 MB gzip, measured) plus a kernel/disk image. The fs bridge is a virtio 9p filesystem (jor1k's), and network backends are `wsproxy`, `wisp` or `fetch` ([v86-readme], [v86-net]). It has the same 32-bit Node ceiling as CheerpX (v21.7.3 ([node-unofficial])). Startup: **none published**. v86 supports saving and restoring state ([v86-readme]).
- **container2wasm:** Converts a container image to wasm using Bochs (x86_64), TinyEMU (riscv64) or QEMU ([c2w-readme]). It runs in the browser via WASI + browser_wasi_shim, or as emscripten QEMU-wasm "with JIT compilation (TCG)". Its demo includes `node` ([c2w-readme]). Host directories reach the guest "via virtio-9p". Networking goes through a gvisor-tap-vsock stack, either in-browser over Fetch (CORS-limited) or delegated over WebSocket. The kernel is pre-booted with wizer "to minimize the startup latency (for WASI only)" ([c2w-readme]). Apache-2.0, active ([c2w-repo]). Real 64-bit `node` should work, but x86_64 runs through Bochs (an interpreter) or QEMU TCG. Performance numbers: **none published**, expected to be far below native (**unverified**).
- **JSLinux/TinyEMU:** JSLinux now lists x86_64 Alpine 3.23.2 "with AVX-512 and APX support", plus x86 and riscv64 systems ([jslinux]). TinyEMU is MIT, with its last release 2019-12-21. It supports VirtIO net and 9P ([tinyemu]). The license of the current JSLinux x86_64 emulator: **unverified**. It's a demo site, not an embeddable library.
- **Verdict:** These run a *real* `node`, but at emulator speed, with a block or 9p filesystem and proxy networking. Not a practical vite/next fallback.

### 8. QuickJS-based runtimes

- **quickjs-emscripten:** QuickJS in wasm (sync variant `emscripten-module.wasm` 503 KB / 232 KB gzip, measured), MIT ([npm-qjs]). It's for sandboxed eval, with no Node APIs ([qjs-readme]). It would interpret JS inside wasm, so it's slower than the browser's JIT.
- **wasmedge-quickjs:** Supports "only part of the Node.js API" (querystring, buffer, encoding, http, …), and compatibility is "a work in progress" ([wasmedge-node]). It targets WasmEdge, not browsers. Last push 2024-10 ([wasmedge-repo]).
- **LLRT (AWS):** Native Rust + QuickJS, not wasm. "**NOT** a drop in replacement for Node.js, nor will it ever be" ([llrt-readme]).
- **Edge.js + QuickJS:** Edge.js can also embed QuickJS in wasm (`quickjs-wasm/`) ([edge-readme]). Wasmer reports Next.js rendering at about 100 ms/page on QuickJS vs about 10 ms with V8 JIT ([edge-node-post]). In the browser, the host-napi mode (§2) is the one to use.

### 9. Other "Node in the browser" projects

- **almostnode** (MIT, macaly): "40+ shimmed modules" over a VFS, with "built-in Vite and Next.js development servers". It's the same class as cresslet and Nodebox, not real Node ([almostnode]). Last push 2026-02.

### 10. Browser-native pieces heavy CLIs need anyway

These ship as wasm today. Several CLIs fall back to them automatically.

| Piece | Size (raw / gzip, measured) | Notes |
|---|---|---|
| `esbuild-wasm@0.28.2` | 14.0 MB / 3.7 MB | MIT ([npm-esbuild]). Already used by cresslet. |
| `@rolldown/binding-wasm32-wasi@1.2.18` (Vite 8's bundler) | 12.1 MB / 3.9 MB | Vite 8.3.8 depends on `rolldown ~1.2.18` ([npm-vite]). The Node loader requires `node:wasi`, `node:worker_threads`, SharedArrayBuffer and `@napi-rs/wasm-runtime`/emnapi. A browser entry (`rolldown-binding.wasi-browser.js`) ships too ([rolldown-wasm-pkg]). Rolldown falls back to it when `NAPI_RS_FORCE_WASI` is set or on WebContainers ([rolldown-wc]). |
| `@rollup/wasm-node@4.68.7` | 0.59 MB wasm | MIT ([npm-rollup]). For Vite ≤ 7. |
| `@next/swc-wasm-nodejs@16.4.6` | 30.8 MB / 6.8 MB | Next loads wasm first on WebContainers or when `NEXT_TEST_WASM` is set. With wasm bindings "Turbopack requires native bindings. Use the --webpack flag instead", and some `css.lightning.*` and `rspack.*` APIs are unsupported ([next-swc]). `@next/swc-wasm-web` is 30.8 MB unpacked ([npm-next-swc-web]). |
| `lightningcss-wasm@1.33.0` | 16.2 MB unpacked | Vite 8 depends on `lightningcss`, whose native package has no wasm optional dep ([npm-lightningcss]). It would need aliasing (**unverified**). |
| `@typescript/typescript-wasip1-wasm` (TS 7.1 nightly) | `tsc.wasm` 53.1 MB / 13.3 MB gzip / 9.6 MB brotli | Added in [ts-pr-64174] (merged 2026-10-29) and experimental, "no warranty". The same `tsc.wasm` runs "as a command" under any WASI host (CLI, `--lsp`) or "as a reactor" behind `typescript/wasm`. That host includes "a minimal WASI shim" and takes sync `FileSystemCallbacks` (`readFile`, `getAccessibleEntries`, `realpath`, `directoryExists`, …) ([ts-pr-64174], [ts7-wasm-dts]). Apache-2.0. Startup: **none published**. Whether the reactor API emits files: **unverified**. |
| `typescript@6.0.3` (last JS `tsc`) | 24.3 MB unpacked | Pure JS. `sys.ts` uses only `fs` (`readFileSync`, `writeFileSync`, `statSync`, `readdirSync`, `realpathSync(.native)`, `mkdirSync`, `watch`/`watchFile`, `utimesSync`, `unlinkSync`, `openSync`/`writeSync`/`closeSync`), `path`, `os` (`platform`, `EOL`), optional `crypto.createHash('sha256')`, `inspector` (CPU profiling only), `Buffer` and `process` ([ts6-sys]). These all fit cresslet's polyfills. |

Important for cresslet's stub: `typescript@latest` is **7.0.2**. Its `bin/tsc` resolves `@typescript/typescript-<platform>-<arch>` and `execFileSync`s a native executable ([ts7-tsc], [npm-ts]). Real `tsc` on cresslet therefore works only with `typescript@≤6`, or with `tsc.wasm` behind a WASI host.

## Comparison

| Runtime | Real Node? | Size (download) | Startup | fs bridge | net bridge | License | vite / next / tsc |
|---|---|---|---|---|---|---|---|
| Node → wasm (upstream) | — (doesn't exist) | — | — | — | — | MIT (Node) | — |
| Edge.js + `@wasmer/sdk` (host N-API) | Yes: Node's lib/src ported to N-API; JS on the browser's JIT | edge webc 78.4 MB served uncompressed (≈25 MB if gzipped) + SDK 4.8 MB (1.8 MB gz) + bash; next adds 30.8 MB SWC wasm (6.8 MB gz) | browser: none published (native 60–102 ms V8) | in-memory guest FS; async `sandbox.fs` copy; experimental SAB `mountHost` | WISP WebSocket relay out; `ports.expose` via SW, 1 server per origin | Edge.js MIT; SDK Modified MIT (attribution > 1M MAU / $1M/mo) | vite 8 (example, untested), next `--webpack` (tested); tsc 7 no (native) |
| BrowserPod | Yes: Node 22.15.0 C++ → wasm; JS on the browser's JIT | stub 35 kB; `bpnode.wasm` 30.6 MB raw / 12.0 MB gz; ≈15.5 MB cold to first `node` (measured) | boot 1–1.5 s, first `node` 0.9 s (measured) | async file handles (no readdir/watch); copy in/out | outbound via host `fetch` hook (CORS); inbound only via metered Edge Portals | proprietary Community Licence: free incl. commercial, credit required, CDN-only | vite build ✓, tsc ✓ (measured); next 16 "initial support" (vendor) |
| WebContainers | Node-compatible (internals undocumented) | unverified (hosted) | "milliseconds" (no numbers) | in-memory; mount/export/watch API | virtual TCP → StackBlitz SW | client MIT; runtime proprietary, commercial licence for prod | vite, next (wasm SWC, webpack); tsc 7 unverified |
| Nodebox | No (reimplemented APIs) | unverified (hosted) | none | in-memory | no external sockets | Sustainable Use (non-commercial) | next example; dormant |
| CheerpX / WebVM | Yes (i386 Linux binary) | ≈0.62 MB br core + streamed ext2 disk | none | ext2/IDB/Web/Data devices | Tailscale (WebSocket VPN) | proprietary; self-host = commercial | Node ≤ 21 (i386) → current vite no; next unverified |
| v86 | Yes (i386, single core) | 2.0 MB wasm (0.38 MB gz) + image | none (state snapshots) | virtio 9p | wsproxy / WISP / fetch | BSD-2 | same i386 ceiling; unverified |
| container2wasm | Yes (x86_64 via Bochs/QEMU) | image-sized | none (wizer pre-boot, WASI only) | WASI dirs → virtio-9p | Fetch (CORS) or WS delegate | Apache-2.0 | real node; speed unverified |
| JSLinux / TinyEMU | Yes (x86_64 Alpine) | unverified | none | 9p / VFsync | VirtIO user-mode | TinyEMU MIT; JSLinux x86_64 unverified | demo only |
| quickjs-emscripten | No (bare engine) | 0.5 MB (0.23 MB gz) | — | none | none | MIT | no |
| wasmedge-quickjs / LLRT | No (partial Node APIs) | — | — | WASI / native | WASI sockets / native | Apache-2.0 | no |
| almostnode | No (shims, built-in vite/next servers) | 16 MB unpacked | — | own VFS | SW | MIT | built-ins only |
| `tsc.wasm` (TS 7, experimental) | n/a (Go → wasip1) | 13.3 MB gz / 9.6 MB br | none | WASI preopens, or sync JS `FileSystemCallbacks` | none needed | Apache-2.0 | tsc only |

## Viability for cresslet now

**As a built-in fallback inside an MIT library, nothing is viable today.** Upstream Node-in-wasm doesn't exist. BrowserPod, WebContainers, Nodebox and CheerpX are proprietary, hosted or non-commercial. The emulators are too slow and too far from a JS VFS.

**Two real-Node options could back a pluggable fallback.** BrowserPod is the more complete one today (§3), but its licence (CDN-only, required credit) and its previews on Leaning's network make it a host's choice, not something cresslet can ship or document as the default. The one with an open core is Edge.js on `@wasmer/sdk/browser`. It should be an optional, user-installed adapter, not bundled. It runs Node's real JS on the page's JIT and already runs `next dev --webpack` in the browser. It fits cresslet's constraints (cross-origin isolated page, SAB, service-worker previews). Its costs:

1. A download before the first command: the 78.4 MB Edge webc as served today (about 25 MB if a host serves it gzipped) plus the 4.8 MB SDK, and for Next.js another 30.8 MB of SWC wasm (6.8 MB gzipped).
2. The SDK's attribution clause for large users.
3. Alpha status, and a host realm that isn't a security boundary ([edge-sec]).
4. JSPI-capable browsers only ([sdk-compat]).
5. Previews needing their own origin per server, which cresslet's `previewOrigins` already supports.
6. File sync: a copy into the sandbox and back, unless the experimental SAB `mountHost` can be pointed at cresslet's VFS RPC (**unverified**).

A prototype adapter is worth one spike. It should not be a dependency.

**Cheaper wins on cresslet's own `node`, without a second runtime:**

- Run the real JS `tsc` when the project pins `typescript@≤6`, since only `fs`/`path`/`os`/`crypto` are needed ([ts6-sys]).
- For TS 7, run `tsc.wasm` under a small WASI shim, or the `typescript/wasm` reactor with `FileSystemCallbacks` mapped onto the sync VFS ([ts-pr-64174]).
- Treat `@next/swc-wasm-nodejs` and `@rolldown/binding-wasm32-wasi` as the "native addon" story. This needs `node:wasi`, real `worker_threads` and emnapi in the worker ([rolldown-wasm-pkg]), which is the actual gap behind "real vite/next don't run".

**What a fallback runtime hook needs.** The `FallbackContext` in `src/node/fallback.ts` covers the inputs marked (shipped); the rest is for when an adapter needs it. Inputs:

- (shipped) `args`, `cwd` and `env`, plus `{ package, bin, entry }`.
- (shipped) `stdin`/`stdout`/`stderr` streams and a TTY flag. Not yet: resize for interactive dev servers.
- (shipped) An `AbortSignal`, which the adapter maps to SIGINT and then a kill.
- (shipped: `container.fs`, `export`, `mount`, `fs.watch`) VFS access as both a bulk snapshot (`export`/`mount` a tree, excluding or including `node_modules`) and an incremental path: change events from `fs.watch` in both directions, or a sync SAB RPC the runtime can mount (Wasmer's `mountHost` shape).

Outputs:

- (shipped) The exit code.
- Server ports. Shipped: the adapter calls `container.servePort(port, req => Response)` for each server it starts, which opens a preview and fires `server-ready`/`port` as any port does. Not shipped: publishing a URL the runtime serves itself (e.g. BrowserPod's Portals) through those events; the host handles that.
- Optionally, outbound network policy: a WISP or WebSocket relay URL that the host supplies.
- Lifecycle: `prepare()` (download and cache the runtime, with progress events) separate from `run()`, so the first command doesn't silently download tens of MB. Plus `teardown()`.

## Sources

[issue]: https://github.com/ODumpling/cresslet-container/issues/12
[v8-jitless]: https://v8.dev/blog/jitless
[node-drumbrake]: https://github.com/nodejs/node/issues/61166
[node-issues-search]: https://github.com/nodejs/node/issues?q=wasm32
[node-pr-48248]: https://github.com/nodejs/node/pull/48248
[node-28800]: https://github.com/nodejs/node/issues/28800
[strapkit]: https://github.com/Strapkit/strapkit
[node-dist]: https://nodejs.org/dist/index.json
[node-unofficial]: https://unofficial-builds.nodejs.org/download/release/index.json
[edge-readme]: https://github.com/wasmerio/edgejs/blob/main/README.md
[edge-arch]: https://github.com/wasmerio/edgejs/blob/main/ARCHITECTURE.md
[edge-sec]: https://github.com/wasmerio/edgejs/blob/main/SECURITY-HOST-JS-NAPI.md
[edge-tree]: https://github.com/wasmerio/edgejs/tree/main/lib/internal/bootstrap
[edge-license]: https://github.com/wasmerio/edgejs/blob/main/LICENSE
[edge-version]: https://github.com/wasmerio/edgejs/blob/main/VERSION.txt
[edge-post]: https://wasmer.io/posts/edgejs-safe-nodejs-using-wasm-sandbox
[edge-node-post]: https://wasmer.io/posts/nodejs-support-in-wasmer-edge-beta
[wasmer-registry]: https://wasmer.io/wasmer/edge
[edge-webc]: https://cdn.wasmer.io/webcimages/294cb0fb3d061662279bacadfbdcaa8611e2ed68f4e1fd9252bc36de26a724a2.webc
[sdk-readme]: https://github.com/wasmerio/wasmer-sdk/blob/main/README.md
[sdk-js-readme]: https://github.com/wasmerio/wasmer-sdk/blob/main/js/README.md
[sdk-license]: https://github.com/wasmerio/wasmer-sdk/blob/main/LICENSE
[sdk-dts]: https://www.npmjs.com/package/@wasmer/sdk?activeTab=code
[npm-wasmer-sdk]: https://www.npmjs.com/package/@wasmer/sdk
[sdk-next]: https://github.com/wasmerio/wasmer-sdk/blob/main/wasmer-sh/workspace/next/README.md
[sdk-next-pkg]: https://github.com/wasmerio/wasmer-sdk/blob/main/wasmer-sh/workspace/next/package.json
[sdk-vinext]: https://github.com/wasmerio/wasmer-sdk/blob/main/wasmer-sh/workspace/vinext/package.json
[sdk-next-test]: https://github.com/wasmerio/wasmer-sdk/blob/main/wasmer-sh/tests/next-browser.mjs
[sdk-compat]: https://github.com/wasmerio/wasmer-sdk/blob/main/wasmer-sh/src/browser-compatibility.ts
[winterjs]: https://github.com/wasmerio/winterjs
[bp-node]: https://browserpod.io/runtimes/node/
[bp-lic]: https://browserpod.io/docs/more/licensing
[bp-license]: https://browserpod.io/license
[bp-docs]: https://browserpod.io/docs/overview
[bp-npm]: https://www.npmjs.com/package/@leaningtech/browserpod
[bp-dts]: https://registry.npmjs.org/@leaningtech/browserpod/-/browserpod-4.1.0.tgz
[bp-rt]: https://rt.browserpod.io/4.1.0/browserpod.js
[bp-ref]: https://browserpod.io/docs/reference/BrowserPod/createFile
[bp-run]: https://browserpod.io/docs/reference/BrowserPod/run
[bp-fs]: https://browserpod.io/docs/understanding-browserpod/filesystem
[bp-coi]: https://browserpod.io/docs/understanding-browserpod/cross-origin-isolation
[bp-net]: https://browserpod.io/docs/understanding-browserpod/networking
[bp-fetchnet]: https://browserpod.io/docs/reference/BrowserPod/createFetchNetwork
[bp-portals]: https://browserpod.io/features/portals/
[bp-lod]: https://browserpod.io/features/loads-on-demand/
[bp-native]: https://browserpod.io/docs/guides/working-around-native-npm-dependencies
[bp-changelog]: https://browserpod.io/docs/more/changelog
[bp-deep]: https://labs.leaningtech.com/blog/browserpod-deep-dive
[bp-beta]: https://labs.leaningtech.com/blog/browserpod-beta-announcement
[wc-intro]: https://webcontainers.io/guides/introduction
[wc-enterprise]: https://webcontainers.io/enterprise
[wc-headers]: https://webcontainers.io/guides/configuring-headers
[wc-browser]: https://webcontainers.io/guides/browser-config
[wc-blog]: https://blog.stackblitz.com/posts/introducing-webcontainers/
[wc-dts]: https://www.npmjs.com/package/@webcontainer/api?activeTab=code
[npm-wc]: https://www.npmjs.com/package/@webcontainer/api
[nodebox-readme]: https://github.com/Sandpack/nodebox-runtime/blob/main/README.md
[nodebox-license]: https://github.com/Sandpack/nodebox-runtime/blob/main/LICENSE
[nodebox-repo]: https://github.com/Sandpack/nodebox-runtime
[npm-nodebox]: https://www.npmjs.com/package/@codesandbox/nodebox
[cx-overview]: https://cheerpx.io/docs/overview
[cx-fs]: https://cheerpx.io/docs/guides/File-System-support
[cx-net]: https://cheerpx.io/docs/guides/Networking
[cx-license]: https://cheerpx.io/docs/licensing
[cx-meta]: https://github.com/leaningtech/cheerpx-meta/blob/main/README.md
[cx-esm]: https://cxrtnc.leaningtech.com/1.4.0/cx.esm.js
[webvm-repo]: https://github.com/leaningtech/webvm
[webvm-config]: https://github.com/leaningtech/webvm/blob/main/config_public_terminal.js
[webvm-docker]: https://github.com/leaningtech/webvm/blob/main/dockerfiles/debian_large
[v86-readme]: https://github.com/copy/v86/blob/master/Readme.md
[v86-net]: https://github.com/copy/v86/blob/master/docs/networking.md
[npm-v86]: https://www.npmjs.com/package/v86
[c2w-readme]: https://github.com/container2wasm/container2wasm/blob/main/README.md
[c2w-repo]: https://github.com/container2wasm/container2wasm
[jslinux]: https://bellard.org/jslinux/
[tinyemu]: https://bellard.org/tinyemu/
[npm-qjs]: https://www.npmjs.com/package/@jitl/quickjs-wasmfile-release-sync
[qjs-readme]: https://github.com/justjake/quickjs-emscripten/blob/main/README.md
[wasmedge-node]: https://wasmedge.org/docs/develop/javascript/nodejs
[wasmedge-repo]: https://github.com/second-state/wasmedge-quickjs
[llrt-readme]: https://github.com/awslabs/llrt/blob/main/README.md
[almostnode]: https://github.com/macaly/almostnode/blob/main/README.md
[npm-esbuild]: https://www.npmjs.com/package/esbuild-wasm
[npm-vite]: https://www.npmjs.com/package/vite
[npm-next]: https://www.npmjs.com/package/next
[rolldown-wc]: https://github.com/rolldown/rolldown/blob/main/packages/rolldown/src/webcontainer-fallback.cjs
[rolldown-wasm-pkg]: https://www.npmjs.com/package/@rolldown/binding-wasm32-wasi?activeTab=code
[npm-rollup]: https://www.npmjs.com/package/@rollup/wasm-node
[next-swc]: https://github.com/vercel/next.js/blob/canary/packages/next/src/build/swc/index.ts
[npm-next-swc-web]: https://www.npmjs.com/package/@next/swc-wasm-web
[npm-lightningcss]: https://www.npmjs.com/package/lightningcss
[ts-pr-64174]: https://github.com/microsoft/TypeScript/pull/64174
[ts7-wasm-dts]: https://www.npmjs.com/package/typescript/v/next?activeTab=code
[ts7-tsc]: https://www.npmjs.com/package/typescript?activeTab=code
[npm-ts]: https://www.npmjs.com/package/typescript
[ts6-sys]: https://github.com/microsoft/TypeScript/blob/release-6.0/src/compiler/sys.ts

Other primary sources behind specific numbers: npm registry metadata (`npm view <pkg> version license dist.unpackedSize`), the Wasmer registry GraphQL API (`https://registry.wasmer.io/graphql`, `getPackage("wasmer/edge")` for the manifest, description and `webcV3.fileSize`), the TS wasm issue [microsoft/TypeScript#63813](https://github.com/microsoft/TypeScript/issues/63813), and GitHub repo metadata (license, `pushed_at`, archived) through the GitHub API.
