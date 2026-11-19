// Shell builtins. State-changing ones (cd/export/exit) act on the ShellState when present.
import type { CommandContext } from '../process'
import { readAll } from '../process'
import { basename, join, resolve } from '../path'

export interface ShellState {
  cwd: string
  env: Record<string, string>
  exitRequested?: number
}

export type Builtin = (ctx: CommandContext, sh?: ShellState) => Promise<number> | number

const abs = (ctx: CommandContext, p: string) => resolve(ctx.cwd, p)

function flags(args: string[]): { flags: Set<string>; rest: string[] } {
  const f = new Set<string>()
  const rest: string[] = []
  let done = false
  for (const a of args) {
    if (!done && a === '--') done = true
    else if (!done && a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) for (const c of a.slice(1)) f.add(c)
    else rest.push(a)
  }
  return { flags: f, rest }
}

function err(ctx: CommandContext, cmd: string, e: unknown): number {
  ctx.stderr.write(`${cmd}: ${e instanceof Error ? e.message : String(e)}\n`)
  return 1
}

const BLUE = '\x1b[1;34m'
const CYAN = '\x1b[1;36m'
const RESET = '\x1b[0m'

async function lines(ctx: CommandContext, files: string[]): Promise<string> {
  if (!files.length) return readAll(ctx.stdin)
  const vfs = ctx.container.vfs
  return files.map((f) => vfs.readText(abs(ctx, f))).join('')
}

function headTail(ctx: CommandContext, tail: boolean): Promise<number> {
  return (async () => {
    let n = 10
    const files: string[] = []
    for (let i = 0; i < ctx.args.length; i++) {
      const a = ctx.args[i]
      if (a === '-n') n = parseInt(ctx.args[++i], 10)
      else if (/^-n\d+$/.test(a)) n = parseInt(a.slice(2), 10)
      else if (/^-\d+$/.test(a)) n = parseInt(a.slice(1), 10)
      else files.push(a)
    }
    try {
      const text = await lines(ctx, files)
      const ls = text.split('\n')
      if (ls[ls.length - 1] === '') ls.pop()
      const sel = tail ? ls.slice(Math.max(0, ls.length - n)) : ls.slice(0, n)
      if (sel.length) ctx.stdout.write(sel.join('\n') + '\n')
      return 0
    } catch (e) {
      return err(ctx, tail ? 'tail' : 'head', e)
    }
  })()
}

export const builtins: Record<string, Builtin> = {
  cd(ctx, sh) {
    const target = ctx.args[0] === undefined || ctx.args[0] === '~' ? ctx.env.HOME || '/' : ctx.args[0] === '-' ? ctx.env.OLDPWD || ctx.cwd : ctx.args[0]
    const p = abs(ctx, target)
    if (!ctx.container.vfs.isDir(p)) {
      ctx.stderr.write(`cd: no such file or directory: ${target}\n`)
      return 1
    }
    if (sh) {
      sh.env.OLDPWD = sh.cwd
      sh.cwd = p
      sh.env.PWD = p
    }
    return 0
  },
  pwd(ctx) {
    ctx.stdout.write(ctx.cwd + '\n')
    return 0
  },
  echo(ctx) {
    let args = ctx.args
    let nl = true
    if (args[0] === '-n') {
      nl = false
      args = args.slice(1)
    }
    ctx.stdout.write(args.join(' ') + (nl ? '\n' : ''))
    return 0
  },
  true: () => 0,
  false: () => 1,
  async sleep(ctx) {
    const ms = parseFloat(ctx.args[0] ?? '0') * 1000
    await new Promise<void>((r) => {
      const t = setTimeout(r, ms)
      ctx.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true })
    })
    return ctx.signal.aborted ? 130 : 0
  },
  ls(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    const vfs = ctx.container.vfs
    const targets = rest.length ? rest : ['.']
    let code = 0
    for (const t of targets) {
      const p = abs(ctx, t)
      try {
        const st = vfs.stat(p)
        if (!st.isDirectory()) {
          ctx.stdout.write(t + '\n')
          continue
        }
        if (targets.length > 1) ctx.stdout.write(`${t}:\n`)
        let ents = vfs.readdirEntries(p)
        if (!f.has('a')) ents = ents.filter((e) => !e.name.startsWith('.'))
        if (f.has('l')) {
          for (const e of ents) {
            const s = vfs.lstat(join(p, e.name))
            const kind = e.isDirectory() ? 'd' : e.isSymbolicLink() ? 'l' : '-'
            const date = new Date(s.mtimeMs).toISOString().slice(0, 16).replace('T', ' ')
            ctx.stdout.write(`${kind}rw-r--r--  ${String(s.size).padStart(8)}  ${date}  ${color(e, ctx)}\n`)
          }
        } else if (ents.length) {
          const names = ents.map((e) => color(e, ctx))
          ctx.stdout.write((ctx.isTTY ? names.join('  ') : names.join('\n')) + '\n')
        }
      } catch (e) {
        code = err(ctx, 'ls', e)
      }
    }
    return code
  },
  async cat(ctx) {
    try {
      ctx.stdout.write(await lines(ctx, ctx.args))
      return 0
    } catch (e) {
      return err(ctx, 'cat', e)
    }
  },
  async grep(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    const [pattern, ...files] = rest
    if (pattern === undefined) return err(ctx, 'grep', 'usage: grep [-ivnc] PATTERN [FILE...]')
    let re: RegExp
    try {
      re = new RegExp(pattern, f.has('i') ? 'i' : '')
    } catch (e) {
      return err(ctx, 'grep', e)
    }
    try {
      let count = 0
      const sources = files.length ? files.map((n) => [n, ctx.container.vfs.readText(abs(ctx, n))]) : [['', await readAll(ctx.stdin)]]
      for (const [name, text] of sources) {
        text.split('\n').forEach((line, i, all) => {
          if (i === all.length - 1 && line === '') return
          if (re.test(line) === f.has('v')) return
          count++
          if (!f.has('c')) ctx.stdout.write(`${files.length > 1 ? name + ':' : ''}${f.has('n') ? i + 1 + ':' : ''}${line}\n`)
        })
      }
      if (f.has('c')) ctx.stdout.write(count + '\n')
      return count ? 0 : 1
    } catch (e) {
      return err(ctx, 'grep', e)
    }
  },
  async wc(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    try {
      const text = await lines(ctx, rest)
      const n = { l: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), w: text.split(/\s+/).filter(Boolean).length, c: new TextEncoder().encode(text).length }
      const pick = f.size ? (['l', 'w', 'c'] as const).filter((k) => f.has(k)) : (['l', 'w', 'c'] as const)
      ctx.stdout.write(pick.map((k) => String(n[k]).padStart(7)).join(' ') + '\n')
      return 0
    } catch (e) {
      return err(ctx, 'wc', e)
    }
  },
  head: (ctx) => headTail(ctx, false),
  tail: (ctx) => headTail(ctx, true),
  mkdir(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    try {
      for (const d of rest) ctx.container.vfs.mkdir(abs(ctx, d), { recursive: f.has('p') })
      return 0
    } catch (e) {
      return err(ctx, 'mkdir', e)
    }
  },
  rm(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    try {
      for (const d of rest) {
        const p = abs(ctx, d)
        if (!f.has('r') && !f.has('R') && ctx.container.vfs.isDir(p)) throw new Error(`${d}: is a directory`)
        ctx.container.vfs.rm(p, { recursive: f.has('r') || f.has('R'), force: f.has('f') })
      }
      return 0
    } catch (e) {
      return err(ctx, 'rm', e)
    }
  },
  rmdir(ctx) {
    try {
      for (const d of ctx.args) ctx.container.vfs.rmdir(abs(ctx, d))
      return 0
    } catch (e) {
      return err(ctx, 'rmdir', e)
    }
  },
  mv(ctx) {
    const { rest } = flags(ctx.args)
    if (rest.length < 2) return err(ctx, 'mv', 'missing operand')
    const vfs = ctx.container.vfs
    try {
      const dest = abs(ctx, rest[rest.length - 1])
      const srcs = rest.slice(0, -1)
      for (const s of srcs) {
        const from = abs(ctx, s)
        vfs.rename(from, vfs.isDir(dest) ? join(dest, basename(from)) : dest)
      }
      return 0
    } catch (e) {
      return err(ctx, 'mv', e)
    }
  },
  cp(ctx) {
    const { flags: f, rest } = flags(ctx.args)
    if (rest.length < 2) return err(ctx, 'cp', 'missing operand')
    const vfs = ctx.container.vfs
    try {
      const dest = abs(ctx, rest[rest.length - 1])
      for (const s of rest.slice(0, -1)) {
        const from = abs(ctx, s)
        if (vfs.isDir(from) && !f.has('r') && !f.has('R')) throw new Error(`-r not specified; omitting directory '${s}'`)
        vfs.cp(from, vfs.isDir(dest) ? join(dest, basename(from)) : dest)
      }
      return 0
    } catch (e) {
      return err(ctx, 'cp', e)
    }
  },
  touch(ctx) {
    const vfs = ctx.container.vfs
    try {
      for (const f of ctx.args) {
        const p = abs(ctx, f)
        if (vfs.exists(p)) vfs.utimes(p, Date.now())
        else vfs.writeFile(p, '')
      }
      return 0
    } catch (e) {
      return err(ctx, 'touch', e)
    }
  },
  env(ctx) {
    ctx.stdout.write(
      Object.entries(ctx.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n',
    )
    return 0
  },
  export(ctx, sh) {
    for (const a of ctx.args) {
      const i = a.indexOf('=')
      if (i > 0 && sh) sh.env[a.slice(0, i)] = a.slice(i + 1)
    }
    if (!ctx.args.length) return builtins.env(ctx, sh)
    return 0
  },
  unset(ctx, sh) {
    for (const a of ctx.args) if (sh) delete sh.env[a]
    return 0
  },
  which(ctx) {
    let code = 0
    for (const name of ctx.args) {
      const where = ctx.container.which(name, ctx.cwd, ctx.env)
      if (where) ctx.stdout.write(where + '\n')
      else {
        ctx.stderr.write(`${name} not found\n`)
        code = 1
      }
    }
    return code
  },
  clear(ctx) {
    ctx.stdout.write('\x1b[2J\x1b[3J\x1b[H')
    return 0
  },
  exit(ctx, sh) {
    const code = parseInt(ctx.args[0] ?? '0', 10) || 0
    if (sh) sh.exitRequested = code
    return code
  },
  help(ctx) {
    ctx.stdout.write(
      `jsh builtins: ${Object.keys(builtins).sort().join(' ')}\ncommands: npm npx node vite serve tsc + node_modules/.bin + registered\n`,
    )
    return 0
  },
}

function color(e: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }, ctx: CommandContext): string {
  if (!ctx.isTTY) return e.name
  if (e.isDirectory()) return `${BLUE}${e.name}${RESET}`
  if (e.isSymbolicLink()) return `${CYAN}${e.name}${RESET}`
  return e.name
}

