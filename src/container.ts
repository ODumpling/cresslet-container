// Container: public entry point. Owns the VFS, port table, command registry and the SW bridge.
import { VFS, type Dirent, type Stats } from './vfs'
import { exportTree, globToRegExp, mountTree, type FileSystemTree } from './tree'
import { PortTable, type PortHandler, type SwRequest } from './ports'
import { createProcess, EMPTY_STDIN, type Command, type CommandContext, type ContainerProcess, type SpawnOptions } from './process'
import { builtins } from './shell/builtins'
import { COMMANDS } from './commands'
import { dropLegacyCache, HttpRegistry, type Registry } from './npm/registry'
import { sharedIdbCache } from './npm/cache'
import { clearPackageCache, isBare, type ResolveFs } from './resolve'
import { bundleVfs, DEFAULT_WASM_URL, type BuildOptions as EsbuildOptions, type OutputFile } from './esbuild'
import { createDevServer, type DevServerHandle, type DevServerOptions } from './dev/server'
import { build, type BuildOptions } from './build/build'
import { dirname, join, normalize, resolve } from './path'
import { acceptHello, BROADCAST, BROADCAST_CLOSE, RELAY_ERROR, RELAY_INIT, RELAY_READY, relayUrl, toOrigin } from './relay-protocol'

export interface BootOptions {
  /** Service worker URL served by the host at its origin root. Default '/cresslet-sw.js'. `false` disables previews. */
  serviceWorkerUrl?: string | false
  /** esbuild.wasm URL (must match esbuild-wasm version). Default: jsDelivr. */
  esbuildWasmUrl?: string
  /** npm registry base. Default 'https://registry.npmjs.org'. */
  registry?: string
  /** Project directory. Default '/home/project'. */
  workdir?: string
  /** Persist npm tarballs + packuments in IndexedDB across reloads. Default true; silently off if IndexedDB is unavailable. */
  npmCache?: boolean
  /**
   * Serve previews from this origin (e.g. 'https://preview.example.com') instead of the host page's, so preview code
   * can't read the host's storage. The container frames `${previewOrigin}/cresslet-relay.html`, which registers
   * `${previewOrigin}/cresslet-sw.js`; `serviceWorkerUrl` is then unused (`false` still disables previews).
   * Unset (or equal to the page's origin): previews share the host origin.
   */
  previewOrigin?: string
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
  readonly resolveFs: ResolveFs
  readonly fs: FsApi
  /** Origin previews are served from when it differs from the page's (`boot({ previewOrigin })`), else null. */
  readonly previewOrigin: string | null
  private relayPort: MessagePort | null = null
  private listeners = new Map<string, Set<Handler>>()
  private commands = new Map<string, Command>()
  private procs = new Set<ContainerProcess>()
  private cleanups: (() => void)[] = []
  private torndown = false

  private constructor(opts: BootOptions) {
    this.workdir = normalize(opts.workdir ?? '/home/project')
    this.registry = new HttpRegistry(opts.registry ?? 'https://registry.npmjs.org', { cache: opts.npmCache === false ? null : sharedIdbCache() })
    dropLegacyCache()
    this.esbuildWasmUrl = opts.esbuildWasmUrl ?? DEFAULT_WASM_URL
    let previewOrigin: string | null = null
    if (opts.previewOrigin !== undefined) {
      previewOrigin = toOrigin(opts.previewOrigin)
      if (!previewOrigin) throw new TypeError(`previewOrigin must be an http(s) origin, got ${JSON.stringify(opts.previewOrigin)}`)
      if (typeof location !== 'undefined' && previewOrigin === location.origin) previewOrigin = null
    }
    this.previewOrigin = previewOrigin
    this.ports = new PortTable(this.instanceId, {
      open: (port, url) => {
        this.emit('port', port, 'open', url)
        this.emit('server-ready', port, url)
      },
      close: (port, url) => this.emit('port', port, 'close', url),
    }, previewOrigin ?? undefined)
    const vfs = this.vfs
    this.resolveFs = { isFile: (p) => vfs.isFile(p), isDir: (p) => vfs.isDir(p), readText: (p) => vfs.tryReadText(p) }
    for (const d of ['/tmp', '/home', '/usr/local/bin', this.workdir]) vfs.mkdir(d, { recursive: true })
    const w = vfs.watch('/', { recursive: true }, (_e, f) => {
      if (f.endsWith('package.json')) clearPackageCache(this.resolveFs)
    })
    this.cleanups.push(() => w.close())
    this.fs = this.makeFs()
  }

  /** Boot a container. Registers the preview service worker (unless disabled). */
  static async boot(opts: BootOptions = {}): Promise<Container> {
    const c = new Container(opts)
    if (opts.serviceWorkerUrl === false) return c
    if (c.previewOrigin) await c.connectRelay(c.previewOrigin)
    else await c.connectServiceWorker(opts.serviceWorkerUrl ?? '/cresslet-sw.js')
    return c
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
      return this.vfs.isFile(p) ? p : null
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
    const file = this.which(name, ctx.cwd, ctx.env)
    if (!file || !this.vfs.isFile(file)) {
      ctx.stderr.write(`jsh: command not found: ${name}\n`)
      return 127
    }
    return this.runFile(file, ctx)
  }

  private runFile(file: string, ctx: CommandContext): Promise<number> {
    const head = this.vfs.readText(file).slice(0, 512)
    const shim = /\/\/ cresslet-bin -> (.+)\n/.exec(head)
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
  /** Create a runtime worker shipped next to this module (dist/node-worker.js). */
  createWorker(_name: 'node-worker.js'): Worker {
    const url = new URL('./node-worker.js', import.meta.url)
    if (typeof location === 'undefined' || url.origin === location.origin) return new Worker(url, { type: 'module', name: 'cresslet-node' })
    const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })
    return new Worker(URL.createObjectURL(blob), { type: 'module', name: 'cresslet-node' })
  }

  // ---------------- service worker bridge ----------------
  /** A message the SW posts to the page that owns an instance (directly, or forwarded by the relay). */
  private onSwMessage(m: unknown, ports: readonly MessagePort[]): void {
    if (!m || typeof m !== 'object') return
    const d = m as Partial<Record<keyof SwRequest, unknown>>
    if (d.type === 'cresslet-who') ports[0]?.postMessage({ owns: d.instanceId === this.instanceId })
    else if (d.type === 'cresslet-request' && d.instanceId === this.instanceId && ports[0] && typeof d.port === 'number' && typeof d.path === 'string' && typeof d.method === 'string' && Array.isArray(d.headers))
      void this.ports.answer(m as SwRequest, ports[0])
  }

  /**
   * Channel for notifying this container's previews (used by the dev server). A BroadcastChannel on the page's origin,
   * or, with a separate preview origin, re-posted by the relay on the preview origin's BroadcastChannel of that name.
   */
  previewChannel(name: string): PreviewChannel {
    if (!this.previewOrigin) return new BroadcastChannel(name)
    return {
      postMessage: (message) => this.relayPort?.postMessage({ type: BROADCAST, channel: name, message }),
      close: () => this.relayPort?.postMessage({ type: BROADCAST_CLOSE, channel: name }),
    }
  }

  /** Frame the preview origin's relay and bridge its service worker over a MessagePort (see relay-protocol.ts). */
  private connectRelay(origin: string): Promise<void> {
    if (typeof document === 'undefined' || typeof location === 'undefined') {
      this.emit('error', { message: 'previewOrigin needs a browser page: previews disabled' })
      return Promise.resolve()
    }
    const frame = document.createElement('iframe')
    frame.src = relayUrl(origin, location.origin)
    frame.title = 'cresslet preview relay'
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    frame.style.display = 'none'
    return new Promise<void>((settle) => {
      const timer = setTimeout(() => {
        this.emit('error', { message: `Preview relay ${frame.src} did not connect: serve it with the headers in the README (COEP, CORP, CSP frame-ancestors)` })
        settle()
      }, RELAY_TIMEOUT)
      const done = () => (clearTimeout(timer), settle())
      const onWindowMessage = (ev: MessageEvent) => {
        if (!acceptHello(ev, { previewOrigin: origin, relay: frame.contentWindow })) return
        // (re)connect: a reloaded relay says hello again
        const ch = new MessageChannel()
        this.relayPort?.close()
        const port = (this.relayPort = ch.port1)
        port.onmessage = (e) => {
          const m = e.data
          if (m?.type === RELAY_READY) {
            port.postMessage({ type: 'cresslet-register', instanceId: this.instanceId })
            done()
          } else if (m?.type === RELAY_ERROR) {
            this.emit('error', { message: String(m.message) })
            done()
          } else this.onSwMessage(m, e.ports)
        }
        frame.contentWindow!.postMessage({ type: RELAY_INIT }, origin, [ch.port2])
      }
      addEventListener('message', onWindowMessage)
      ;(document.body ?? document.documentElement).appendChild(frame)
      this.cleanups.push(() => {
        clearTimeout(timer)
        removeEventListener('message', onWindowMessage)
        const port = this.relayPort
        this.relayPort = null
        port?.postMessage({ type: 'cresslet-unregister', instanceId: this.instanceId })
        // let the relay forward the unregister before its frame goes
        setTimeout(() => (port?.close(), frame.remove()), 250)
        settle()
      })
    })
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
      const active = reg.active ?? (await waitActive(reg))
      active.postMessage({ type: 'cresslet-register', instanceId: this.instanceId })
      this.cleanups.push(() => active.postMessage({ type: 'cresslet-unregister', instanceId: this.instanceId }))
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

function waitActive(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  return new Promise((resolve, reject) => {
    const w = reg.installing ?? reg.waiting
    if (!w) return navigator.serviceWorker.ready.then((r) => resolve(r.active!), reject)
    const check = () => {
      if (w.state === 'activated') resolve(w)
      else if (w.state === 'redundant') reject(new Error('service worker became redundant'))
    }
    w.addEventListener('statechange', check)
    check()
  })
}

export type { FileSystemTree, ContainerProcess, SpawnOptions, Command, CommandContext, DevServerOptions, DevServerHandle, BuildOptions, Dirent, Stats }
