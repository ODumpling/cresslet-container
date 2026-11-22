# TypeScript

Everything this repo owns is TypeScript, type-checked under `strict`, except a short allowlist of JS that runs as-is.
`pnpm typecheck` enforces it; CI (`.github/workflows/test.yml`) runs it on every push to main and every PR.

## How each kind of file runs

| Files | Runs as | Notes |
| --- | --- | --- |
| `src/**/*.ts` (library, node worker, service worker, relay) | bundled by esbuild (`scripts/build.ts`) into `dist/` | `.d.ts` for the public API from `tsconfig.build.json` |
| `src/preview-ws.ts` | compiled to JS (esbuild `ts` loader), minified, embedded as a string via `?raw`, injected into preview HTML by the service worker | a script, not a module: no imports/exports, and only syntax that compiles away (types, `declare` fields), so the injected JS is the file minus its types. Vitest compiles `*.ts?raw` the same way (`vitest.config.ts`) |
| `src/css/worker.cjs` | embedded raw (`?raw`), written into the container and run by its `node` | stays JS, see below |
| `src/node/shims/*.cjs` | aliased by the build's esbuild plugin for bundled polyfills | stays JS (CommonJS `module.exports`) |
| `scripts/*.ts` | run by Node directly (type stripping, Node ≥ 22.18) | erasable syntax only, `import type` for types |
| `test/*.test.ts`, `e2e/*.spec.ts`, `*.config.ts` | vitest / Playwright (their own TS loaders) | |
| `e2e/fixtures/**` | project content run inside the container | not ours: stays JS |

## tsconfigs

| Config | Covers | Environment |
| --- | --- | --- |
| `tsconfig.json` | `src/` | browser libs, no `@types/*` (`types: []`); node polyfill typings in `src/node/env.d.ts` and `globals.d.ts`, `?raw` / `?bundle` imports in `src/types.d.ts` |
| `tsconfig.build.json` | the public API | extends the above; emits declarations to `dist/types` |
| `tsconfig.test.json` | `test/`, `e2e/*.spec.ts`, vitest + Playwright configs, and the `src` they import | adds `@types/node`; maps the e2e pages' `import('/dist/cresslet-container.js')` to `src/index.ts`, so page code is checked against the API |
| `tsconfig.node.json` | `scripts/` | NodeNext, `@types/node`, `erasableSyntaxOnly`, `verbatimModuleSyntax` |
| `tsconfig.js.json` | `src/css/worker.cjs`, `src/node/shims/*.cjs` | `checkJs`, not strict (strict would need JSDoc on every parameter) |

## JS allowlist

In `scripts/check-ts.ts` (`JS_ALLOWLIST`), each entry with its reason:

- `dist/`: build output, committed (consumed via git / jsDelivr, vendored by the studio).
- `e2e/fixtures/`: apps run inside the container.
- `src/css/worker.cjs`: run as-is by the container's `node` over the project's own sass/less/postcss/tailwind, and
  vendored verbatim into cresslet-cli as `lib/compilers.cjs`. Converting it would mean a build step in both places.
  Checked in place; keep edits there behavior-neutral and re-copy it into the CLI.
- `src/node/shims/process.cjs`, `abort-controller.cjs`: tiny CommonJS shims the bundler aliases. Checked in place.

## Rules

- `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- No `any` in owned code. Use `unknown` and narrow, or a real type. The exception is a genuinely untyped boundary, with a
  comment. Today that's only the loose typings of the events / readable-stream polyfills in `src/node/env.d.ts`.
- No `@ts-ignore` / `@ts-nocheck`. `@ts-expect-error` only with a reason after it.
- No new `.js` / `.mjs` / `.cjs` / `.jsx` outside the allowlist.

`scripts/check-ts.ts` enforces the last two. It runs first in `pnpm typecheck`.

## Commands

```sh
pnpm typecheck   # check-ts guard, then tsc over src, scripts, tests/e2e/configs and the allowlisted JS
pnpm test        # vitest
pnpm build       # dist/ (commit it: CI fails when dist/ differs from a fresh build)
pnpm test:e2e    # Playwright, chromium
```

## Follow-ups

- `noUncheckedIndexedAccess`: not on yet (a lot of churn).
- Strict checking of `src/css/worker.cjs`, which would need JSDoc throughout. Or move it to TS with a build step,
  shared with cresslet-cli.
- `JSON.parse` and `MessageEvent.data` still come in as `any` from the DOM/ES libs. Give them types where they cross
  a boundary.
