// Built-in commands: npm, npx, vite (dev/build/preview), serve, tsc (no-op), jsh.
import type { Container } from './container'
import type { Command, CommandContext } from './process'
import { aborted, crlf, errorMessage } from './process'
import { join, resolve } from './path'
import { install, readPkg, splitPkgSpec, writePkg, binEntries } from './npm/install'
import { mimeType } from './dev/project'
import { interactive, Shell } from './shell/jsh'
import { quote } from './shell/parser'
import { builtins } from './shell/builtins'
import { nodeCommand, NODE_VERSION } from './node/host'
import { Channel } from './process'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
export const NPM_VERSION = '10.9.0'

/** Flags that take a value (`--port 3000` as well as `--port=3000`). */
const VALUE_FLAGS = new Set(['port', 'host', 'outDir', 'mode', 'config', 'base', 'listen', 'l', 'p', 'package'])

function parseFlags(args: string[]) {
  const flags = new Map<string, string | true>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      rest.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1))
      else if (VALUE_FLAGS.has(a.slice(2)) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) flags.set(a.slice(2), args[++i])
      else flags.set(a.slice(2), true)
    } else if (/^-[lp]$/.test(a) && args[i + 1] !== undefined) flags.set(a.slice(1), args[++i])
    else if (a.startsWith('-') && a.length > 1) for (const ch of a.slice(1)) flags.set(ch, true)
    else rest.push(a)
  }
  return { flags, rest }
}

/** Run a package.json script through jsh with node_modules/.bin on PATH. */
async function runScript(ctx: CommandContext, cwd: string, name: string, extra: string[], quiet = false): Promise<number> {
  const c = ctx.container
  const pkg = readPkg(c.vfs, cwd)
  const script = pkg?.scripts?.[name]
  if (script === undefined) return -1
  const env = { ...ctx.env, PATH: `${join(cwd, 'node_modules/.bin')}:${ctx.env.PATH ?? ''}`, npm_lifecycle_event: name, npm_package_name: pkg?.name ?? '', npm_package_version: pkg?.version ?? '', INIT_CWD: cwd }
  const sh = new Shell(c, cwd, env)
  const io = { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal, isTTY: ctx.isTTY }
  for (const phase of [`pre${name}`, name, `post${name}`]) {
    const s = pkg!.scripts![phase]
    if (s === undefined) continue
    const line = phase === name && extra.length ? `${s} ${extra.map(quote).join(' ')}` : s
    if (!quiet) ctx.stdout.write(`\n${DIM}> ${pkg?.name ?? ''}${pkg?.version ? '@' + pkg.version : ''} ${phase}\n> ${line}${RESET}\n\n`)
    const code = await sh.run(line, io)
    if (code !== 0) return code
  }
  return 0
}

export const npm: Command = async (ctx) => {
  const c = ctx.container
  const [sub = 'help', ...args] = ctx.args
  const { flags, rest } = parseFlags(args)
  const cwd = ctx.cwd
  try {
    switch (sub) {
      case '-v':
      case '--version':
      case 'version':
        ctx.stdout.write(NPM_VERSION + '\n')
        return 0
      case 'i':
      case 'install':
      case 'add':
      case 'ci':
        await install(c.vfs, c.registry, { cwd, add: rest, dev: flags.has('D') || flags.has('save-dev'), exact: flags.has('E') || flags.has('save-exact'), out: ctx.stdout, signal: ctx.signal })
        return 0
      case 'un':
      case 'uninstall':
      case 'remove':
      case 'rm':
        if (!rest.length) throw new Error('npm uninstall: missing package name')
        await install(c.vfs, c.registry, { cwd, remove: rest.map((r) => splitPkgSpec(r).name), out: ctx.stdout, signal: ctx.signal })
        return 0
      case 'run':
      case 'run-script': {
        if (!rest.length) {
          const pkg = readPkg(c.vfs, cwd)
          const scripts = Object.entries(pkg?.scripts ?? {})
          ctx.stdout.write(scripts.length ? `Scripts available via \`npm run\`:\n${scripts.map(([k, v]) => `  ${k}\n    ${DIM}${v}${RESET}`).join('\n')}\n` : 'no scripts\n')
          return 0
        }
        const code = await runScript(ctx, cwd, rest[0], rest.slice(1), flags.has('silent') || flags.has('s'))
        if (code === -1) {
          ctx.stderr.write(`${RED}npm error${RESET} Missing script: "${rest[0]}"\n`)
          return 1
        }
        return code
      }
      case 'start':
      case 'test':
      case 't': {
        const name = sub === 't' ? 'test' : sub
        const code = await runScript(ctx, cwd, name, rest)
        if (code === -1) {
          if (name === 'start' && c.vfs.isFile(join(cwd, 'server.js'))) return c.exec('node', { ...ctx, args: ['server.js'] })
          ctx.stderr.write(`${RED}npm error${RESET} Missing script: "${name}"\n`)
          return 1
        }
        return code
      }
      case 'init': {
        if (c.vfs.isFile(join(cwd, 'package.json')) && !flags.has('y') && !flags.has('yes')) {
          ctx.stdout.write('package.json already exists\n')
          return 0
        }
        const name = cwd.split('/').pop()!.toLowerCase().replace(/[^a-z0-9._-]/g, '-') || 'project'
        const pkg = readPkg(c.vfs, cwd) ?? { name, version: '1.0.0', description: '', main: 'index.js', scripts: { test: 'echo "Error: no test specified" && exit 1' }, keywords: [], author: '', license: 'ISC' }
        writePkg(c.vfs, cwd, pkg)
        ctx.stdout.write(`Wrote to ${join(cwd, 'package.json')}:\n\n${JSON.stringify(pkg, null, 2)}\n`)
        return 0
      }
      case 'exec':
      case 'x':
        return npx({ ...ctx, args: rest })
      case 'ls':
      case 'list': {
        const pkg = readPkg(c.vfs, cwd)
        ctx.stdout.write(`${pkg?.name ?? ''}@${pkg?.version ?? ''} ${cwd}\n`)
        for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })) {
          const v = readPkg(c.vfs, join(cwd, 'node_modules', name))?.version
          ctx.stdout.write(`├── ${name}@${v ?? `${RED}UNMET DEPENDENCY${RESET}`}\n`)
        }
        return 0
      }
      case 'pkg': {
        if (rest[0] === 'get') {
          const pkg = readPkg(c.vfs, cwd) as Record<string, unknown>
          ctx.stdout.write(JSON.stringify(rest[1] ? pkg?.[rest[1]] : pkg, null, 2) + '\n')
          return 0
        }
        if (rest[0] === 'set') {
          const pkg = (readPkg(c.vfs, cwd) ?? {}) as Record<string, unknown>
          for (const kv of rest.slice(1)) {
            const [k, ...v] = kv.split('=')
            const keys = k.split('.')
            let o = pkg
            for (const key of keys.slice(0, -1)) o = (o[key] ??= {}) as Record<string, unknown>
            o[keys[keys.length - 1]] = v.join('=')
          }
          writePkg(c.vfs, cwd, pkg)
          return 0
        }
        break
      }
      case 'config':
      case 'audit':
      case 'fund':
      case 'outdated':
      case 'prune':
      case 'dedupe':
        ctx.stdout.write(`npm ${sub}: not supported in clover (no-op)\n`)
        return 0
      case 'help':
      case '-h':
      case '--help':
        ctx.stdout.write(`npm (clover ${NPM_VERSION})\n  install|i [pkg...] [-D]   uninstall <pkg...>   run <script>   start   test   init -y   exec|npx <bin>   ls\n`)
        return 0
    }
    // `npm <script>` shorthand is not npm behaviour; report unknown command
    ctx.stderr.write(`${RED}npm error${RESET} Unknown command: "${sub}"\n`)
    return 1
  } catch (e) {
    ctx.stderr.write(`${RED}npm error${RESET} ${errorMessage(e)}\n`)
    return 1
  }
}

export const npx: Command = async (ctx) => {
  const c = ctx.container
  const args = ctx.args.filter((a) => a !== '-y' && a !== '--yes')
  const p = args.findIndex((a) => a === '-p' || a === '--package')
  let pkgSpec: string | undefined
  if (p >= 0) {
    pkgSpec = args[p + 1]
    args.splice(p, 2)
  }
  const [spec, ...rest] = args
  if (!spec) {
    ctx.stderr.write('npx: missing command\n')
    return 1
  }
  const { name } = splitPkgSpec(spec)
  const bin = name.startsWith('@') ? name.split('/')[1] : name
  const local = c.which(bin, ctx.cwd, { ...ctx.env, PATH: `${join(ctx.cwd, 'node_modules/.bin')}:${ctx.env.PATH ?? ''}` })
  if (local && !pkgSpec) return c.exec(bin, { ...ctx, args: rest, env: { ...ctx.env, PATH: `${join(ctx.cwd, 'node_modules/.bin')}:${ctx.env.PATH ?? ''}` } })
  // install into a temp prefix and run its bin
  const prefix = `/tmp/npx/${(pkgSpec ?? spec).replace(/[^\w.-]/g, '_')}`
  if (!c.vfs.isDir(join(prefix, 'node_modules'))) {
    c.vfs.mkdir(prefix, { recursive: true })
    writePkg(c.vfs, prefix, { name: 'npx-tmp', version: '0.0.0', private: true })
    ctx.stdout.write(`${DIM}npx: installing ${pkgSpec ?? spec}…${RESET}\n`)
    await install(c.vfs, c.registry, { cwd: prefix, add: [pkgSpec ?? spec], out: { write: () => {} }, signal: ctx.signal })
  }
  const pkgName = splitPkgSpec(pkgSpec ?? spec).name
  const meta = readPkg(c.vfs, join(prefix, 'node_modules', pkgName))
  const bins = binEntries(pkgName, meta?.bin as never)
  const chosen = bins.find(([b]) => b === bin) ?? bins[0]
  if (!chosen) {
    ctx.stderr.write(`npx: ${pkgName} has no executable\n`)
    return 1
  }
  return c.exec('node', { ...ctx, args: [join(prefix, 'node_modules', pkgName, chosen[1]), ...rest] })
}

/** `vite` / `vite dev` / `vite build` / `vite preview` mapped to built-ins. */
export const vite: Command = async (ctx) => {
  const c = ctx.container
  let args = [...ctx.args]
  let mode = 'dev'
  if (['dev', 'serve', 'build', 'preview', 'optimize'].includes(args[0])) mode = args.shift()!
  const { flags, rest } = parseFlags(args)
  const root = rest[0] ? resolve(ctx.cwd, rest[0]) : ctx.cwd
  const portArg = flags.get('port')
  const port = typeof portArg === 'string' && /^\d+$/.test(portArg) ? Number(portArg) : undefined
  try {
    if (mode === 'build') {
      const t0 = Date.now()
      const outDir = typeof flags.get('outDir') === 'string' ? (flags.get('outDir') as string) : 'dist'
      ctx.stdout.write(`${CYAN}vite (clover)${RESET} ${GREEN}building for production...${RESET}\n`)
      const { files } = await c.build({ root, outDir })
      for (const f of files) {
        const size = c.vfs.stat(f).size
        ctx.stdout.write(`${DIM}${f.slice(root.length + 1).padEnd(48)}${RESET} ${(size / 1024).toFixed(2).padStart(8)} kB\n`)
      }
      ctx.stdout.write(`${GREEN}✓ built in ${Date.now() - t0}ms${RESET}\n`)
      return 0
    }
    if (mode === 'preview') {
      const outDir = typeof flags.get('outDir') === 'string' ? (flags.get('outDir') as string) : 'dist'
      return serveStatic(ctx, join(root, outDir), port ?? 4173, true)
    }
    if (mode === 'optimize') return 0
    const server = await c.createDevServer({ root, port })
    ctx.stdout.write(`\n  ${CYAN}${BOLD}VITE${RESET} ${CYAN}(clover)${RESET}  ready\n\n  ${GREEN}➜${RESET}  ${BOLD}Local${RESET}:   ${CYAN}${server.url}${RESET}\n\n`)
    await aborted(ctx.signal)
    server.close()
    return 0
  } catch (e) {
    ctx.stderr.write(`${RED}error${RESET} ${errorMessage(e)}\n`)
    return 1
  }
}

async function serveStatic(ctx: CommandContext, dir: string, port: number, spa: boolean): Promise<number> {
  const c = ctx.container
  if (!c.vfs.isDir(dir)) {
    ctx.stderr.write(`serve: ${dir} does not exist${dir.endsWith('dist') ? ' (run the build first)' : ''}\n`)
    return 1
  }
  const handle = c.servePort(port, (req) => staticHandler(c, dir, spa)(req))
  ctx.stdout.write(`\n  ${GREEN}Serving${RESET} ${dir}\n  ${GREEN}➜${RESET}  ${BOLD}Local${RESET}:   ${CYAN}${handle.url}${RESET}\n\n`)
  await aborted(ctx.signal)
  handle.close()
  return 0
}

export function staticHandler(c: Container, dir: string, spa = true) {
  return (req: Request): Response => {
    const u = new URL(req.url)
    let p = join(dir, decodeURIComponent(u.pathname))
    if (c.vfs.isDir(p)) p = join(p, 'index.html')
    if (!c.vfs.isFile(p) && c.vfs.isFile(p + '.html')) p += '.html'
    if (!c.vfs.isFile(p)) {
      if (spa && c.vfs.isFile(join(dir, 'index.html')) && !/\.\w+$/.test(u.pathname)) p = join(dir, 'index.html')
      else return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    const immutable = /\/assets\/.+-[\w-]{8,}\.\w+$/.test(p)
    return new Response(c.vfs.readFile(p) as BodyInit, { headers: { 'content-type': mimeType(p), 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' } })
  }
}

export const serve: Command = async (ctx) => {
  const { flags, rest } = parseFlags(ctx.args)
  const pf = flags.get('p') ?? flags.get('l') ?? flags.get('port') ?? flags.get('listen')
  const port = typeof pf === 'string' && /^\d+$/.test(pf) ? Number(pf) : 3000
  return serveStatic(ctx, resolve(ctx.cwd, rest[0] ?? '.'), port, true)
}

export const tsc: Command = async (ctx) => {
  if (ctx.args.includes('-v') || ctx.args.includes('--version')) {
    ctx.stdout.write('Version 5.9.3 (clover stub)\n')
    return 0
  }
  ctx.stdout.write(`${DIM}tsc: type-checking is skipped in clover (esbuild strips types at build time)${RESET}\n`)
  return 0
}

export const jsh: Command = async (ctx) => {
  const c = ctx.container
  const sh = new Shell(c, ctx.cwd, ctx.env)
  const ci = ctx.args.indexOf('-c')
  if (ci >= 0) return sh.run(ctx.args[ci + 1] ?? '', { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal, isTTY: ctx.isTTY })
  if (ctx.args[0] && !ctx.args[0].startsWith('-')) {
    const script = c.vfs.readText(resolve(ctx.cwd, ctx.args[0]))
    let code = 0
    for (const line of script.split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue
      code = await sh.run(line, { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal })
      if (sh.state.exitRequested !== undefined) return sh.state.exitRequested
    }
    return code
  }
  const stdin = ctx.stdin instanceof Channel ? ctx.stdin : toChannel(ctx.stdin)
  const out = ctx.isTTY === false ? ctx.stdout : crlf(ctx.stdout)
  return interactive(c, sh, { stdout: out, stdin, signal: ctx.signal })
}

function toChannel(it: AsyncIterable<string>): Channel {
  const ch = new Channel()
  ;(async () => {
    for await (const s of it) ch.push(s)
    ch.close()
  })()
  return ch
}

export const COMMANDS: Record<string, Command> = {
  npm,
  npx,
  node: nodeCommand,
  vite,
  serve,
  'http-server': serve,
  tsc,
  jsh,
  sh: jsh,
  bash: jsh,
}

export { builtins, NODE_VERSION }
