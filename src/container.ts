// Container: public entry point. Owns the VFS, port table, command registry and the SW bridge.
import { VFS, type Dirent, type Stats } from './vfs'
import { exportTree, globToRegExp, mountTree, type FileSystemTree } from './tree'
import { isSwRequest, PortTable, rejectRequest, upgradeWebSocket, type PortHandler, type WebSocketUpgrade } from './ports'
import { createProcess, EMPTY_STDIN, type Command, type CommandContext, type ContainerProcess, type SpawnOptions } from './process'
import { builtins } from './shell/builtins'
import { COMMANDS } from './commands'
import { dropLegacyCache, HttpRegistry, type Registry } from './npm/registry'
import { sharedIdbCache } from './npm/cache'
import { clearPackageCache, isBare, type ResolveFs } from './resolve'
import { bundleVfs, DEFAULT_WASM_URL, type BuildOptions as EsbuildOptions, type OutputFile } from './esbuild'
import { createDevServer, type DevServerHandle, type DevServerOptions } from './dev/server'
import { build, type BuildOptions } from './build/build'
import { nodeCssBackend, type CssBackend } from './css/pipeline'
import { basename, dirname, join, normalize, resolve } from './path'
import { acceptHello, BROADCAST, BROADCAST_CLOSE, expandOriginTemplate, newestWorker, originTemplateError, PROC_SPAWN, WORKER_SPAWN, RELAY_DISPOSE, RELAY_DISPOSED, RELAY_ERROR, RELAY_INIT, RELAY_READY, relayErrorText, relayUrl, THIRD_PARTY_HINT, toOrigin, WORKER_SCRIPT } from './relay-protocol'
import { localChannel, relayChannel, relayWorker, type NodeChannel, type ProjectWorker } from './node/channel'
import { DEFAULT_BROTLI_WASM_URL } from './node/brotli'
import { clearPersisted, persistKey, VfsPersistence, type PersistOptions, type Persistence } from './persist'

const VIRTUAL_BIN_DIRS = new Set(['/usr/local/bin', '/usr/bin', '/bin'])

export interface BootOptions {
  /** Service worker URL served by the host at its origin root. Default '/cresslet-sw.js'. `false` disables previews. */
  serviceWorkerUrl?: string | false
  /** esbuild.wasm URL (must match esbuild-wasm version). Default: jsDelivr. */
  esbuildWasmUrl?: string
  /**
   * brotli WASM URL for `zlib` brotli in `node` where the browser's CompressionStream lacks it (Chromium); must match
   * brotli-wasm 3.0.1 (`pkg.web/brotli_wasm_bg.wasm`). Fetched on first use. Default: jsDelivr.
   */
  brotliWasmUrl?: string
  /** npm registry base. Default 'https://registry.npmjs.org'. */
  registry?: string
  /** Project directory. Default '/home/project'. */
  workdir?: string
  /**
   * Persist npm tarballs + packuments in IndexedDB across reloads. Default true; silently off if IndexedDB is unavailable.
   * `{ maxBytes }` caps its total size (default 256 MiB, `Infinity` for no cap): past it, least-recently-used entries
   * are evicted.
   */
  npmCache?: boolean | { maxBytes?: number }
  /**
   * Serve previews from this origin (e.g. 'https://preview.example.com') instead of the host page's, so preview code
   * can't read the host's storage. The container frames `${previewOrigin}/cresslet-relay.html`, which registers
   * `${previewOrigin}/cresslet-sw.js` and also runs `node` processes (server code, npm bins, the CSS worker) on that
   * origin; `serviceWorkerUrl` is then unused (`false` disables previews, and then `node` / `projectWorker` fail to start).
   * Unset (or equal to the page's origin): previews share the host origin.
   */
  previewOrigin?: string
  /**
   * One origin per preview instead of one for all: a template with `{id}` (the container's `instanceId`) and `{port}`
   * in the host name, apart (e.g. 'https://{id}-{port}.preview.example.com'), so previews can't script each other or
   * read each other's storage.
   * Each port's preview gets its own relay frame and service worker on its origin (framed when the port opens;
   * `server-ready` / `port` fire once it's connected), which answers only that port. `node` processes and project
   * workers run on the `{port}` = 0 origin, which no preview shares. Not with `previewOrigin`.
   */
  previewOrigins?: string
  /**
   * Load project plugins and configs when processing CSS: PostCSS configs (and their plugins), Tailwind `@plugin` /
   * `@config`, Less `@plugin`. Default true. `false`: PostCSS configs are ignored and those `@plugin`/`@config` fail;
   * Tailwind v4, Sass and Less themselves still compile (the installed packages' own code still runs).
   */
  cssPlugins?: boolean
  /**
   * Persist the workdir across reloads: snapshots (without `node_modules`, which `npm install` restores from the npm
   * cache) go to OPFS, else IndexedDB, and `boot` restores the latest one before it resolves (see `c.persistence`).
   * Default off. `true` uses key 'default'; give each project its own `key`.
   */
  persist?: boolean | PersistOptions
}

export interface ContainerEvents {
  'server-ready': (port: number, url: string) => void
  port: (port: number, type: 'open' | 'close', url: string) => void
  error: (error: { message: string }) => void
}

export interface FsApi {
  readFile(path: string): Promise<Uint8Array>
  readFile(path: string, encoding: 'utf8' | 'utf-8'): Promise<string>
  readFile(path: string, encoding?: 'utf8' | 'utf-8'): Promise<Uint8Array | string>
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  readdir(path: string): Promise<string[]>
  readdir(path: string, opts: { withFileTypes: true }): Promise<Dirent[]>
  readdir(path: string, opts?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<Stats>
  exists(path: string): Promise<boolean>
  watch(path: string, opts: { recursive?: boolean }, cb: (event: 'change' | 'rename', filename: string) => void): { close(): void }
}

export interface CommandRegistrationContext extends CommandContext {}

export interface BundleOptions extends EsbuildOptions {}
export interface BundleResult {
  outputFiles: { path: string; text: string; contents: Uint8Array }[]
  errors: unknown[]
  warnings: unknown[]
  metafile?: unknown
}

type Handler = (...a: unknown[]) => void

const randomId = () => Math.random().toString(36).slice(2, 10)
const RELAY_TIMEOUT = 20_000
/** How long a per-preview relay may take to unregister its service worker at teardown before its frame goes anyway. */
const DISPOSE_TIMEOUT = 3_000

/** Where the dev server sends live-reload / HMR / overlay notifications for its previews. */
export interface PreviewChannel {
  postMessage(message: unknown): void
  close(): void
}

export class Container {
  readonly instanceId = randomId()
  readonly workdir: string
  /** Synchronous in-memory file system (advanced use). */
  readonly vfs = new VFS()
  readonly ports: PortTable
  readonly registry: Registry
  readonly esbuildWasmUrl: string
  readonly brotliWasmUrl: string
  readonly resolveFs: ResolveFs
  readonly fs: FsApi
  /** Origin previews are served from when it differs from the page's (`boot({ previewOrigin })`), else null. */
  readonly previewOrigin: string | null
  /** The per-preview origin template (`boot({ previewOrigins })`), else null. See `ports.url(port)` for a preview's URL. */
  readonly previewOrigins: string | null
  /** Whether CSS processing runs project code (`boot({ cssPlugins })`). */
  readonly cssPlugins: boolean
  /** Workdir snapshots (`boot({ persist })`), else null. */
  readonly persistence: Persistence | null
  private persist: VfsPersistence | null = null
  /** Origin `node` processes and project workers run on (by its relay), when not this page's. */
  private workersOrigin: string | null = null
  /** The relay on `workersOrigin` (with `previewOrigin`, it also serves every preview). */
  private relay: RelayLink | null = null
  /** Whether the workers relay connected at boot (previews, and `node`, run on the preview origin). */
  private relayBooted = false
  /** `previewOrigins`: each preview port's relay (on its own origin), by port. */
  private previewRelays = new Map<number, RelayLink>()
  /** `previewOrigins`: open ports whose `port` / `server-ready` were emitted (after their relay connected). */
  private announced = new Set<number>()
  /** `previewOrigins`: the latest opening of each port, until its relay connected (or failed). */
  private opening = new Map<number, Promise<void>>()
  /** No service worker or relays (`serviceWorkerUrl: false`). */
  private previewsOff = false
  /** The relay port the node worker script was last sent on. */
  private relayScriptPort: MessagePort | null = null
  /** Kill switches of `node` processes and project workers running in the relay (they die with its document). */
  private relayProcs = new Set<(reason: string) => void>()
  private listeners = new Map<string, Set<Handler>>()
  private commands = new Map<string, Command>()
  private procs = new Set<ContainerProcess>()
  private cleanups: (() => void)[] = []
  private torndown = false

  private constructor(opts: BootOptions) {
    this.workdir = normalize(opts.workdir ?? '/home/project')
    const npmCache = opts.npmCache ?? true
    const cache = npmCache === false ? null : sharedIdbCache(npmCache === true ? undefined : npmCache.maxBytes)
    this.registry = new HttpRegistry(opts.registry ?? 'https://registry.npmjs.org', { cache })
    dropLegacyCache()
    this.esbuildWasmUrl = opts.esbuildWasmUrl ?? DEFAULT_WASM_URL
    this.brotliWasmUrl = opts.brotliWasmUrl ?? DEFAULT_BROTLI_WASM_URL
    this.cssPlugins = opts.cssPlugins !== false
    let previewOrigin: string | null = null
    if (opts.previewOrigin !== undefined) {
      if (opts.previewOrigins !== undefined) throw new TypeError('boot: pass previewOrigin or previewOrigins, not both')
      previewOrigin = toOrigin(opts.previewOrigin)
      if (!previewOrigin) throw new TypeError(`previewOrigin must be an http(s) origin, got ${JSON.stringify(opts.previewOrigin)}`)
      if (typeof location !== 'undefined' && previewOrigin === location.origin) previewOrigin = null
    }
    this.previewOrigin = previewOrigin
    const template = opts.previewOrigins ?? null
    if (template !== null) {
      const err = originTemplateError(template)
      if (err) throw new TypeError(`previewOrigins ${err}, got ${JSON.stringify(template)}`)
    }
    this.previewOrigins = template
    const originOf = template === null ? undefined : (port: number) => toOrigin(expandOriginTemplate(template, this.instanceId, port))!
    this.workersOrigin = previewOrigin ?? originOf?.(0) ?? null
    this.previewsOff = opts.serviceWorkerUrl === false
    const announce = (port: number, url: string) => {
      this.emit('port', port, 'open', url)
      this.emit('server-ready', port, url)
    }
    this.ports = new PortTable(this.instanceId, {
      open: (port, url) => {
        if (!originOf || this.previewsOff) return announce(port, url)
        if (this.torndown) return // no relay frames after teardown (nothing would remove them)
        // {port} 0 is the workers' origin, never a preview's (and the SW only forwards ports 1-65535 anyway)
        if (!Number.isInteger(port) || port < 1 || port > 65535) return this.emit('error', { message: `port ${port}: previews need a port from 1 to 65535` })
        // the preview's URL works once its origin's relay (and so its service worker) is connected
        const settle = (fn: () => void) => () => {
          if (this.opening.get(port) !== opening) return // closed (and maybe reopened) since
          this.opening.delete(port)
          if (!this.torndown) fn()
        }
        const opening: Promise<void> = connected(this.previewRelay(port, originOf(port))).then(
          settle(() => (this.announced.add(port), announce(port, url))),
          (e: Error) => settle(() => this.emit('error', { message: `port ${port}: ${e.message}` }))(),
        )
        this.opening.set(port, opening)
      },
      close: (port, url) => {
        if (originOf && !this.previewsOff) {
          this.opening.delete(port)
          if (!this.announced.delete(port)) return
        }
        this.emit('port', port, 'close', url)
      },
    }, originOf ?? previewOrigin ?? undefined)
    const vfs = this.vfs
    this.resolveFs = { isFile: (p) => vfs.isFile(p), isDir: (p) => vfs.isDir(p), readText: (p) => vfs.tryReadText(p), realpath: (p) => vfs.realpath(p) }
    for (const d of ['/tmp', '/home', '/usr/local/bin', this.workdir]) vfs.mkdir(d, { recursive: true })
    const w = vfs.watch('/', { recursive: true }, (_e, f) => {
      if (f.endsWith('package.json')) clearPackageCache(this.resolveFs)
    })
    this.cleanups.push(() => w.close())
    this.fs = this.makeFs()
    if (opts.persist) {
      const p = (this.persist = new VfsPersistence(vfs, this.workdir, opts.persist === true ? {} : opts.persist, (message) => this.emit('error', { message })))
      this.cleanups.push(() => p.close())
    }
    this.persistence = this.persist
  }

  /** Boot a container. Registers the preview service worker (unless disabled). */
  static async boot(opts: BootOptions = {}): Promise<Container> {
    const c = new Container(opts)
    await c.persist?.start()
    if (opts.serviceWorkerUrl === false) return c
    if (!c.workersOrigin) await c.connectServiceWorker(opts.serviceWorkerUrl ?? '/cresslet-sw.js')
    else {
      // with previewOrigins, the workers relay runs no service worker (each preview's relay has its own)
      const relay = (c.relay = c.connectRelay(c.workersOrigin, { workers: true, sw: !c.previewOrigins }))
      await relay.ready.then(
        () => void (c.relayBooted = true),
        (e) => {
          c.teardown()
          throw e
        },
      )
    }
    return c
  }

  /** Delete a persisted workdir snapshot (`boot({ persist: { key } })`) without booting a container. */
  static clearPersisted(key?: string): Promise<void> {
    return clearPersisted(persistKey(key))
  }

  // ---------------- events ----------------
  on<E extends keyof ContainerEvents>(event: E, fn: ContainerEvents[E]): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(fn as Handler)
    return () => void set!.delete(fn as Handler)
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(...args)
      } catch (e) {
        console.error(e)
      }
    }
  }

  // ---------------- fs ----------------
  /** Resolve a path against the workdir. */
  path(p: string): string {
    return resolve(this.workdir, p)
  }

  private makeFs(): FsApi {
    const v = this.vfs
    const P = (p: string) => this.path(p)
    return {
      readFile: (async (p: string, enc?: string) => {
        const d = v.readFile(P(p))
        return enc ? new TextDecoder().decode(d) : d.slice()
      }) as FsApi['readFile'],
      writeFile: async (p, data) => v.writeFile(P(p), typeof data === 'string' ? data : data.slice(), { mkdirp: true }),
      readdir: (async (p: string, o?: { withFileTypes?: boolean }) => (o?.withFileTypes ? v.readdirEntries(P(p)) : v.readdir(P(p)))) as FsApi['readdir'],
      mkdir: async (p, o) => v.mkdir(P(p), o),
      rm: async (p, o) => v.rm(P(p), o),
      rename: async (a, b) => v.rename(P(a), P(b)),
      stat: async (p) => v.stat(P(p)),
      exists: async (p) => v.exists(P(p)),
      watch: (p, o, cb) => v.watch(P(p), o, cb),
    }
  }

  async mount(tree: FileSystemTree, opts: { mountPoint?: string } = {}): Promise<void> {
    mountTree(this.vfs, tree, this.path(opts.mountPoint ?? '.'))
  }

  async export(path: string, opts: { excludes?: string[] } = {}): Promise<FileSystemTree> {
    return exportTree(this.vfs, this.path(path), (opts.excludes ?? []).map(globToRegExp))
  }

  // ---------------- processes ----------------
  registerCommand(name: string, fn: Command): () => void {
    this.commands.set(name, fn)
    return () => void this.commands.delete(name)
  }

  defaultEnv(): Record<string, string> {
    return {
      HOME: '/home',
      USER: 'cresslet',
      SHELL: '/bin/jsh',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: 'en_US.UTF-8',
      PWD: this.workdir,
    }
  }

  async spawn(cmd: string, args: string[] = [], opts: SpawnOptions = {}): Promise<ContainerProcess> {
    const cwd = this.path(opts.cwd ?? '.')
    const env: Record<string, string> = { ...this.defaultEnv(), PWD: cwd }
    for (const [k, v] of Object.entries(opts.env ?? {})) if (v === undefined) delete env[k]
    else env[k] = String(v)
    const interactiveShell = (cmd === 'jsh' || cmd === 'sh' || cmd === 'bash') && !args.includes('-c') && !args.some((a) => !a.startsWith('-'))
    const p = createProcess(
      ({ stdout, stderr, stdin, signal }) =>
        this.exec(cmd, { args, cwd, env, stdout, stderr, stdin, signal, container: this, isTTY: interactiveShell || !!opts.terminal }),
      { terminal: opts.terminal && !interactiveShell },
    )
    this.procs.add(p)
    p.exit.finally(() => this.procs.delete(p))
    return p
  }

  /** Locate a command: registered, builtin, bundled or on PATH. */
  which(name: string, cwd: string, env: Record<string, string | undefined>): string | null {
    if (name.includes('/')) {
      const p = resolve(cwd, name)
      return this.vfs.isFile(p) ? p : this.virtualBin(name) ? name : null
    }
    if (this.commands.has(name)) return `/usr/local/bin/${name}`
    if (name in builtins) return `${name}: shell builtin`
    if (name in COMMANDS) return `/usr/local/bin/${name}`
    for (const dir of (env.PATH ?? '').split(':')) {
      if (!dir) continue
      const p = join(resolve(cwd, dir), name)
      if (this.vfs.isFile(p)) return p
    }
    return null
  }

  /** Run a command by name in an existing context (used by jsh, npm run, …). */
  async exec(name: string, ctx: CommandContext): Promise<number> {
    if (!name.includes('/')) {
      const reg = this.commands.get(name)
      if (reg) return reg({ ...ctx, stdin: ctx.stdin ?? EMPTY_STDIN })
      const b = builtins[name]
      if (b) return b(ctx)
      const cmd = COMMANDS[name]
      if (cmd) return cmd(ctx)
    }
    const bin = this.virtualBin(name)
    if (bin && !this.vfs.isFile(name)) return this.exec(bin, ctx)
    const file = this.which(name, ctx.cwd, ctx.env)
    if (!file || !this.vfs.isFile(file)) {
      ctx.stderr.write(`jsh: command not found: ${name}\n`)
      return 127
    }
    return this.runFile(file, ctx)
  }

  /** `/usr/local/bin/node` and the like (`process.execPath`, what `which` reports): the built-in command's name, else null. */
  private virtualBin(name: string): string | null {
    const base = basename(name)
    return VIRTUAL_BIN_DIRS.has(dirname(name)) && (this.commands.has(base) || base in builtins || base in COMMANDS) ? base : null
  }

  private runFile(file: string, ctx: CommandContext): Promise<number> {
    const head = this.vfs.readText(file).slice(0, 512)
    const shim = /^#!\/usr\/bin\/env node\n\/\/ cresslet-bin -> (.+)\n/.exec(head) // only an npm .bin shim's own header line
    if (shim) return COMMANDS.node({ ...ctx, args: [resolve(dirname(file), shim[1]), ...ctx.args] })
    const shebang = head.startsWith('#!') ? head.slice(2, head.indexOf('\n')) : ''
    if (/\b(sh|bash|jsh|zsh)\b/.test(shebang)) return COMMANDS.jsh({ ...ctx, args: [file, ...ctx.args] })
    return COMMANDS.node({ ...ctx, args: [file, ...ctx.args] })
  }

  // ---------------- servers ----------------
  servePort(port: number, handler: PortHandler): { url: string; close(): void } {
    const url = this.ports.open(port, handler)
    return { url, close: () => this.ports.close(port) }
  }

  /**
   * Accept a WebSocket a preview opened to its own host (`new WebSocket(...)` there is routed to this container's port
   * handlers, dev server `middleware` included, as a GET with `Upgrade: websocket`). Call it on the request the handler
   * got and return `response` from the handler; any other response refuses the socket. `protocol` must be one the
   * preview offered (`Sec-WebSocket-Protocol`). Throws for any other request. See `WebSocketUpgrade.socket` for the port.
   */
  upgradeWebSocket(req: Request, opts: { protocol?: string } = {}): WebSocketUpgrade {
    return upgradeWebSocket(req, opts)
  }

  createDevServer(opts: DevServerOptions = {}): Promise<DevServerHandle> {
    return createDevServer(this, opts)
  }

  build(opts: BuildOptions = {}): Promise<{ files: string[] }> {
    return build(this, opts)
  }

  /** esbuild over the VFS. Relative entry points resolve against workdir. */
  async bundle(options: BundleOptions): Promise<BundleResult> {
    const serverish = options.platform === 'node' || options.platform === 'neutral'
    const externals = (options.external ?? []).map((e) => globToRegExp(e))
    const r = await bundleVfs(this.vfs, {
      ...options,
      cwd: options.absWorkingDir ?? this.workdir,
      wasmURL: this.esbuildWasmUrl,
      vfsPlugin: {
        builtins: serverish ? 'external' : 'empty',
        external: (spec) => {
          if (/^(npm|jsr|node|bun):/.test(spec)) return spec
          if (externals.some((re) => re.test(spec))) return spec
          if (options.packages === 'external' && isBare(spec)) return spec
          return undefined
        },
        resolve: serverish
          ? { conditions: ['deno', 'worker', 'node', 'import', 'module', 'default'], extensions: ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.cjs', '.json'], mainFields: ['module', 'main'] }
          : undefined,
      },
    })
    return {
      outputFiles: r.outputFiles.map((f: OutputFile) => ({ path: f.path, text: f.text, contents: f.contents })),
      errors: r.errors,
      warnings: r.warnings,
      metafile: r.metafile,
    }
  }

  // ---------------- workers ----------------
  private css: ReturnType<typeof nodeCssBackend> | null = null
  /** The CSS worker (PostCSS / Tailwind) shared by dev servers and builds; a `node` process started on first use. */
  cssWorker(): CssBackend {
    if (!this.css) {
      const css = (this.css = nodeCssBackend(this))
      this.cleanups.push(() => css.close())
    }
    return this.css
  }

  /** Create a runtime worker shipped next to this module (dist/node-worker.js). */
  createWorker(_name: 'node-worker.js'): Worker {
    const url = workerScriptUrl()
    if (typeof location === 'undefined' || url.origin === location.origin) return new Worker(url, { type: 'module', name: 'cresslet-node' })
    const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })
    return new Worker(URL.createObjectURL(blob), { type: 'module', name: 'cresslet-node' })
  }

  /**
   * Start a `node` worker: on the preview origin (run by the relay) when previews are served from a separate
   * `previewOrigin`, so project code there can't open this page's IndexedDB / Cache Storage; on this page otherwise.
   * @internal
   */
  async nodeChannel(): Promise<NodeChannel> {
    if (!this.workersOrigin) return localChannel(this.createWorker('node-worker.js'))
    this.checkRelayEnabled()
    nodeSource ??= fetchSource(workerScriptUrl().href).catch((e) => {
      nodeSource = null
      throw e
    })
    const source = await nodeSource
    const relay = await this.workerRelay() // after the fetch: a relay that reconnected meanwhile has a new port
    if (this.relayScriptPort !== relay) {
      relay.postMessage({ type: WORKER_SCRIPT, source })
      this.relayScriptPort = relay
    }
    const { port1, port2 } = new MessageChannel()
    const kill = (reason: string) => (ch.terminate(), notify(() => ch.onerror?.(reason)))
    const ch = relayChannel(port1, () => this.relayProcs.delete(kill))
    this.relayProcs.add(kill)
    relay.postMessage({ type: PROC_SPAWN }, [port2])
    return ch
  }

  /**
   * Start a module Web Worker for project code (e.g. an app's server handler) where `node` runs: on the preview origin
   * when previews are served from a separate `previewOrigin` (the page fetches `url` and the relay runs it from a
   * `blob:` URL there, so its imports must be absolute URLs), else `new Worker(url, { type: 'module' })` on this page.
   * Messages are structured-cloned and MessagePorts passed on; values that can only be transferred (streams, ...) fail;
   * `onerror` gets `{ message }`. With a `previewOrigin` it never falls back to this page's origin: it rejects when
   * there's no relay (`serviceWorkerUrl: false`).
   */
  async projectWorker(url: string | URL, opts: { name?: string } = {}): Promise<ProjectWorker> {
    const href = new URL(url, typeof location === 'undefined' ? undefined : location.href).href
    if (!this.workersOrigin) return new Worker(href, { type: 'module', name: opts.name }) as ProjectWorker
    this.checkRelayEnabled()
    const source = await fetchSource(href)
    const relay = await this.workerRelay()
    const { port1, port2 } = new MessageChannel()
    const kill = (reason: string) => (w.terminate(), notify(() => w.onerror?.({ message: reason })))
    const w = relayWorker(port1, () => this.relayProcs.delete(kill))
    this.relayProcs.add(kill)
    relay.postMessage({ type: WORKER_SPAWN, source, name: opts.name }, [port2])
    return w
  }

  /** The relay port to start workers on. Never falls back to this page's origin when there is a `previewOrigin`. */
  private async workerRelay(): Promise<MessagePort> {
    const conn = this.relay?.conn
    if (!conn) throw new Error('preview relay is not connected')
    return conn
  }

  private checkRelayEnabled(): void {
    if (!this.relayBooted) throw new Error('project code runs on the preview origin, but previews are disabled (serviceWorkerUrl: false): no relay to run it')
  }

  // ---------------- service worker bridge ----------------
  /**
   * A message the SW posts to the page that owns an instance (directly, or forwarded by the relay). `exclusive`: the
   * channel is this container's own (the relay port), so every request on it is ours to answer, if only with a 400;
   * on the page's shared SW channel, requests for other instance ids belong to other containers in this page.
   * `onlyPort`: a per-preview relay (`previewOrigins`) speaks for that one preview, so it may only reach that port.
   */
  private onSwMessage(m: unknown, ports: readonly MessagePort[], exclusive = false, onlyPort?: number): void {
    if (!m || typeof m !== 'object') return
    const d = m as { type?: unknown; instanceId?: unknown }
    if (d.type === 'cresslet-who' && ports[0]) {
      ports[0].postMessage({ owns: d.instanceId === this.instanceId })
      ports[0].close()
    } else if (d.type === 'cresslet-request' && ports[0] && (exclusive || d.instanceId === this.instanceId)) {
      if (!isSwRequest(m) || m.instanceId !== this.instanceId || (m.websocket && !ports[1])) rejectRequest(ports[0])
      else if (onlyPort !== undefined && m.port !== onlyPort) rejectRequest(ports[0], 403, `Cresslet: this preview's origin serves port ${onlyPort} only`)
      else void this.ports.answer(m, ports[0], ports[1])
    }
  }

  /**
   * Channel for notifying this container's previews (used by the dev server). A BroadcastChannel on the page's origin,
   * or, with a separate preview origin, re-posted by the relay on the preview origin's BroadcastChannel of that name.
   * With `previewOrigins` only the relay of the port in the name (`cresslet:<instanceId>:<port>`) gets it; other names
   * go nowhere.
   */
  previewChannel(name: string): PreviewChannel {
    if (!this.workersOrigin) return new BroadcastChannel(name)
    const m = /^cresslet:([^:]+):(\d+)$/.exec(name)
    const target = () => (!this.previewOrigins ? this.relay : m && m[1] === this.instanceId ? this.previewRelays.get(Number(m[2])) : undefined)?.port
    return {
      postMessage: (message) => target()?.postMessage({ type: BROADCAST, channel: name, message }),
      close: () => target()?.postMessage({ type: BROADCAST_CLOSE, channel: name }),
    }
  }

  /**
   * Settles once `port`'s preview URL works (with `previewOrigins`: its relay connected or failed, see `server-ready`);
   * at once otherwise. Never rejects.
   * @internal
   */
  previewReady(port: number): Promise<void> {
    return this.opening.get(port) ?? Promise.resolve()
  }

  /** `previewOrigins`: the relay on `port`'s preview origin, framed on first use and kept until teardown. */
  private previewRelay(port: number, origin: string): RelayLink {
    let r = this.previewRelays.get(port)
    if (!r) {
      const link = (r = this.connectRelay(origin, { workers: false, sw: true, onlyPort: port }))
      this.previewRelays.set(port, link)
      // a failed relay is gone (frame removed): the next open of this port tries again
      link.ready.catch(() => this.previewRelays.get(port) === link && this.previewRelays.delete(port))
    }
    return r
  }

  /**
   * Frame a preview origin's relay and bridge it over a MessagePort (see relay-protocol.ts). `workers`: it runs this
   * container's `node` processes and project workers. `sw`: it registers that origin's service worker, whose requests
   * it forwards (`onlyPort`: for that preview port only). `ready` rejects (leaving no frame or listener behind) if the
   * first handshake fails or times out.
   */
  private connectRelay(origin: string, opts: { workers: boolean; sw: boolean; onlyPort?: number }): RelayLink {
    const link: RelayLink = { port: null, conn: null, ready: null!, booted: false }
    if (typeof document === 'undefined' || typeof location === 'undefined') {
      link.ready = Promise.reject(new Error('previewOrigin needs a browser page'))
      return link
    }
    const frame = document.createElement('iframe')
    frame.src = relayUrl(origin, location.origin, { sw: opts.sw })
    frame.title = 'cresslet preview relay'
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    // node workers run in the relay and block on SharedArrayBuffers: the frame must be cross-origin isolated too
    if (opts.workers) frame.allow = 'cross-origin-isolated'
    frame.style.display = 'none'
    const killWorkers = (reason: string) => {
      if (opts.workers) for (const kill of [...this.relayProcs]) kill(reason)
    }
    link.ready = new Promise<void>((resolve, reject) => {
      let booted = false
      const timer = setTimeout(
        () => fail(`Preview relay ${frame.src} did not connect within ${RELAY_TIMEOUT / 1000}s: serve it with the headers in the README (COEP, CORP, CSP frame-ancestors); ${THIRD_PARTY_HINT}`),
        RELAY_TIMEOUT,
      )
      let failed = false
      const fail = (message: string) => {
        if (failed) return
        failed = true
        stop()
        frame.remove()
        reject(new Error(message))
      }
      const stop = () => {
        clearTimeout(timer)
        removeEventListener('message', onWindowMessage)
        link.port?.close()
        link.port = null
        link.conn = null
      }
      const onWindowMessage = (ev: MessageEvent) => {
        if (!acceptHello(ev, { previewOrigin: origin, relay: frame.contentWindow })) return
        // (re)connect: a reloaded relay says hello again; its node workers died with the old document
        killWorkers('preview relay restarted')
        const ch = new MessageChannel()
        link.port?.close()
        const port = (link.port = ch.port1)
        let ready = false
        // workers started meanwhile wait for this connection (or fail with its setup error)
        let settle!: (e?: Error) => void
        const conn = (link.conn = new Promise<MessagePort>((res, rej) => {
          const t = setTimeout(() => settle(new Error(`preview relay did not reconnect within ${RELAY_TIMEOUT / 1000}s`)), RELAY_TIMEOUT)
          settle = (e) => (clearTimeout(t), e ? rej(e) : res(port))
        }))
        conn.catch(() => {})
        port.onmessage = (e) => {
          const m = e.data
          if (m?.type === RELAY_READY && !ready) {
            ready = true
            settle()
            // ready after the deadline (launches that waited got the timeout): later launches use it
            if (link.port === port) link.conn = Promise.resolve(port)
            if (opts.sw) port.postMessage({ type: 'cresslet-register', instanceId: this.instanceId })
            if (!booted) {
              booted = link.booted = true
              clearTimeout(timer)
              resolve()
            }
          } else if (m?.type === RELAY_ERROR) {
            // previews can script the relay: only believe errors from its setup, and never show them unmarked
            if (ready) return
            settle(new Error(relayErrorText(m.message)))
            if (!booted) fail(relayErrorText(m.message))
            else {
              killWorkers(relayErrorText(m.message))
              this.emit('error', { message: relayErrorText(m.message) })
            }
          } else if (opts.sw) this.onSwMessage(m, e.ports, true, opts.onlyPort)
        }
        frame.contentWindow!.postMessage({ type: RELAY_INIT }, origin, [ch.port2])
      }
      addEventListener('message', onWindowMessage)
      ;(document.body ?? document.documentElement).appendChild(frame)
      this.cleanups.push(() => {
        if (failed) return
        const port = link.port
        if (booted && opts.sw) port?.postMessage({ type: 'cresslet-unregister', instanceId: this.instanceId })
        link.port = null
        stop()
        if (!booted) {
          failed = true
          reject(new Error('container torn down'))
        }
        // a per-preview origin is this container's alone: drop its service worker registration too (also when torn down
        // mid-setup: the relay may be registering it; the message waits on the port until it's done)
        const dispose = opts.onlyPort !== undefined && port
        if (dispose) port.postMessage({ type: RELAY_DISPOSE })
        // let the relay forward the unregister / unregister its SW before its frame goes
        const done = () => (clearTimeout(t), port?.close(), frame.remove())
        const t = setTimeout(done, dispose ? DISPOSE_TIMEOUT : 250)
        if (dispose) port.onmessage = (e) => void (e.data?.type === RELAY_DISPOSED && done())
      })
    })
    return link
  }

  private async connectServiceWorker(url: string): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      this.emit('error', { message: 'Service workers unavailable: previews disabled' })
      return
    }
    const sw = navigator.serviceWorker
    const onMessage = (ev: MessageEvent) => this.onSwMessage(ev.data, ev.ports)
    sw.addEventListener('message', onMessage)
    sw.startMessages()
    this.cleanups.push(() => sw.removeEventListener('message', onMessage))
    try {
      const reg = await sw.register(url, { scope: '/' })
      // the active worker as before: a newer one stuck in waiting (e.g. a custom SW without skipWaiting) must not hang boot
      const active = reg.active ?? (await newestWorker(reg, () => sw.ready))
      active.postMessage({ type: 'cresslet-register', instanceId: this.instanceId })
      // to whichever worker is active by then (a newer one may have taken over since boot)
      this.cleanups.push(() => (reg.active ?? active).postMessage({ type: 'cresslet-unregister', instanceId: this.instanceId }))
    } catch (e) {
      this.emit('error', { message: `Service worker registration failed (${url}): ${e instanceof Error ? e.message : e}` })
    }
  }

  // ---------------- teardown ----------------
  teardown(): void {
    if (this.torndown) return
    this.torndown = true
    for (const p of this.procs) p.kill()
    for (const port of this.ports.list()) this.ports.close(port)
    for (const fn of this.cleanups.splice(0)) fn()
    this.listeners.clear()
  }
}

/** One relay frame on a preview origin (see `Container.connectRelay`). */
interface RelayLink {
  /** The current connection's port (null while (re)connecting). */
  port: MessagePort | null
  /** The current connection once it's ready, else rejected. */
  conn: Promise<MessagePort> | null
  /** Settles with the first handshake. */
  ready: Promise<void>
  /** Whether the first handshake succeeded. */
  booted: boolean
}

/** Resolves once `link`'s current connection is up (the first one, or a reconnect in progress), else rejects. */
function connected(link: RelayLink): Promise<void> {
  if (!link.booted) return link.ready
  return link.conn ? link.conn.then(() => {}) : Promise.reject(new Error('preview relay is not connected'))
}

/** Run a caller's callback without letting it break ours. */
function notify(fn: () => void): void {
  try {
    fn()
  } catch (e) {
    console.error(e)
  }
}

const workerScriptUrl = () => new URL('./node-worker.js', import.meta.url)
/** node-worker.js's source (fetched once per page). */
let nodeSource: Promise<string> | null = null
/** A worker script's source, for the relay to run as a blob: worker on the preview origin (no extra files to serve there). */
async function fetchSource(href: string): Promise<string> {
  const r = await fetch(href)
  if (!r.ok) throw new Error(`fetching ${href}: HTTP ${r.status}`)
  return r.text()
}

export type { PersistOptions, Persistence }
export type { FileSystemTree, ContainerProcess, SpawnOptions, Command, CommandContext, DevServerOptions, DevServerHandle, BuildOptions, Dirent, Stats }
