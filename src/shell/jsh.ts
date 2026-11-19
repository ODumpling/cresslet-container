// jsh: executes parsed command lists; interactive mode adds a prompt + line editor for xterm-like terminals.
import type { Container } from '../container'
import type { CommandContext, Writer } from '../process'
import { Channel, EMPTY_STDIN, errorMessage } from '../process'
import { basename, resolve } from '../path'
import { builtins, type ShellState } from './builtins'
import { expandWord, parse, ParseError, type SimpleCommand } from './parser'

export interface ShellIO {
  stdout: Writer
  stderr: Writer
  stdin: AsyncIterable<string>
  signal: AbortSignal
  isTTY?: boolean
}

const STATE_BUILTINS = new Set(['cd', 'export', 'unset', 'exit'])

export class Shell {
  state: ShellState
  status = 0
  constructor(
    private c: Container,
    cwd: string,
    env: Record<string, string>,
  ) {
    this.state = { cwd, env: { ...env, PWD: cwd } }
  }

  /** Run a command line; returns exit status of the last pipeline. */
  async run(line: string, io: ShellIO): Promise<number> {
    let list
    try {
      list = parse(line)
    } catch (e) {
      if (e instanceof ParseError) {
        io.stderr.write(`jsh: ${e.message}\n`)
        return (this.status = 2)
      }
      throw e
    }
    let status = this.status
    let skip = false
    for (const item of list) {
      if (!skip) status = this.status = await this.runPipeline(item.pipeline, io)
      if (io.signal.aborted) return (this.status = 130)
      if (this.state.exitRequested !== undefined) return status
      skip = (item.op === '&&' && status !== 0) || (item.op === '||' && status === 0)
    }
    return status
  }

  private envFor(): Record<string, string | undefined> {
    return { ...this.state.env, '?': String(this.status), $: '1' }
  }

  private async runPipeline(cmds: SimpleCommand[], io: ShellIO): Promise<number> {
    if (cmds.length === 1) return this.runSimple(cmds[0], io.stdin, io.stdout, io)
    const chans = cmds.slice(1).map(() => new Channel())
    const runs = cmds.map((cmd, i) => {
      const stdin = i === 0 ? io.stdin : chans[i - 1]
      const out = i === cmds.length - 1 ? io.stdout : { write: (s: string) => chans[i].push(s) }
      return this.runSimple(cmd, stdin, out, io).finally(() => chans[i]?.close())
    })
    const codes = await Promise.all(runs)
    return codes[codes.length - 1]
  }

  private async runSimple(cmd: SimpleCommand, stdin: AsyncIterable<string>, stdout: Writer, io: ShellIO): Promise<number> {
    const venv = this.envFor()
    const assigns = cmd.assigns.map(([k, w]) => [k, expandWord(w, venv)] as const)
    const argv = cmd.argv.map((w) => expandWord(w, venv))
    if (!argv.length) {
      for (const [k, v] of assigns) this.state.env[k] = v
      return 0
    }
    const vfs = this.c.vfs
    let out = stdout
    let err = io.stderr
    const finals: (() => void)[] = []
    for (const r of cmd.redirects) {
      const target = r.op === '2>&1' ? '' : resolve(this.state.cwd, expandWord(r.target, venv))
      const sink = (append: boolean): Writer => {
        if (target === '/dev/null') return { write() {} }
        try {
          if (!append || !vfs.exists(target)) vfs.writeFile(target, '')
        } catch (e) {
          throw new Error(`jsh: ${errorMessage(e)}`)
        }
        return { write: (s) => vfs.writeFile(target, s, { append: true }) }
      }
      try {
        if (r.op === '>' || r.op === '>>') out = sink(r.op === '>>')
        else if (r.op === '2>' || r.op === '2>>') err = sink(r.op === '2>>')
        else if (r.op === '&>') out = err = sink(false)
        else if (r.op === '2>&1') err = out
        else if (r.op === '<') {
          const text = target === '/dev/null' ? '' : vfs.readText(target)
          const ch = new Channel()
          ch.push(text)
          ch.close()
          stdin = ch
        }
      } catch (e) {
        io.stderr.write(`jsh: ${errorMessage(e).replace(/^jsh: /, '')}\n`)
        return 1
      }
    }
    const env: Record<string, string> = { ...this.state.env }
    for (const [k, v] of assigns) env[k] = v
    const ctx: CommandContext = {
      args: argv.slice(1),
      cwd: this.state.cwd,
      env,
      stdout: out,
      stderr: err,
      stdin: stdin ?? EMPTY_STDIN,
      signal: io.signal,
      container: this.c,
      isTTY: io.isTTY && out === stdout,
    }
    try {
      const name = argv[0]
      if (STATE_BUILTINS.has(name)) return await builtins[name](ctx, this.state)
      return await this.c.exec(name, ctx)
    } finally {
      finals.forEach((f) => f())
    }
  }
}

// ---------------- interactive terminal ----------------

const PROMPT_COLOR = '\x1b[1;32m'
const DIR_COLOR = '\x1b[1;34m'
const RESET = '\x1b[0m'

/** Interactive jsh session for a terminal. Input is raw keystrokes; output uses \r\n. */
export async function interactive(c: Container, sh: Shell, io: { stdout: Writer; stdin: Channel; signal: AbortSignal }): Promise<number> {
  const out = io.stdout
  const history: string[] = []
  let hIdx = 0
  let line = ''
  let cursor = 0
  let job: { abort: AbortController; stdin: Channel; buf: string } | null = null
  const lines = new Channel()

  const prompt = () => {
    const cwd = sh.state.cwd
    const home = sh.state.env.HOME
    const shown = home && (cwd === home || cwd.startsWith(home + '/')) ? '~' + cwd.slice(home.length) : cwd
    return `${PROMPT_COLOR}❯${RESET} ${DIR_COLOR}${basename(shown) || shown}${RESET} `
  }
  const redraw = () => {
    out.write(`\r\x1b[K${prompt()}${line}`)
    const back = line.length - cursor
    if (back > 0) out.write(`\x1b[${back}D`)
  }

  const onKey = (seq: string) => {
    if (job) {
      // cooked mode for foreground job
      if (seq === '\x03') {
        out.write('^C\n')
        job.abort.abort()
      } else if (seq === '\x04') job.stdin.close()
      else if (seq === '\r' || seq === '\n') {
        out.write('\n')
        job.stdin.push(job.buf + '\n')
        job.buf = ''
      } else if (seq === '\x7f' || seq === '\b') {
        if (job.buf) {
          job.buf = job.buf.slice(0, -1)
          out.write('\b \b')
        }
      } else if (!seq.startsWith('\x1b') && seq >= ' ') {
        job.buf += seq
        out.write(seq)
      }
      return
    }
    switch (seq) {
      case '\r':
      case '\n':
        out.write('\n')
        lines.push(line)
        if (line.trim() && history[history.length - 1] !== line) history.push(line)
        hIdx = history.length
        line = ''
        cursor = 0
        return
      case '\x03':
        out.write('^C\n')
        line = ''
        cursor = 0
        sh.status = 130
        out.write(prompt())
        return
      case '\x04':
        if (!line) lines.close()
        return
      case '\x7f':
      case '\b':
        if (cursor > 0) {
          line = line.slice(0, cursor - 1) + line.slice(cursor)
          cursor--
          redraw()
        }
        return
      case '\x1b[3~':
        if (cursor < line.length) {
          line = line.slice(0, cursor) + line.slice(cursor + 1)
          redraw()
        }
        return
      case '\x1b[D':
        if (cursor > 0) (cursor--, out.write(seq))
        return
      case '\x1b[C':
        if (cursor < line.length) (cursor++, out.write(seq))
        return
      case '\x1b[H':
      case '\x01':
        cursor = 0
        redraw()
        return
      case '\x1b[F':
      case '\x05':
        cursor = line.length
        redraw()
        return
      case '\x15':
        line = line.slice(cursor)
        cursor = 0
        redraw()
        return
      case '\x0b':
        line = line.slice(0, cursor)
        redraw()
        return
      case '\x0c':
        out.write('\x1b[2J\x1b[H')
        redraw()
        return
      case '\x1b[A':
      case '\x1b[B': {
        if (!history.length) return
        hIdx = Math.max(0, Math.min(history.length, hIdx + (seq === '\x1b[A' ? -1 : 1)))
        line = history[hIdx] ?? ''
        cursor = line.length
        redraw()
        return
      }
      case '\t':
        return complete()
    }
    if (seq.startsWith('\x1b')) return
    const printable = seq.replace(/[\x00-\x1f]/g, '')
    if (!printable) return
    line = line.slice(0, cursor) + printable + line.slice(cursor)
    cursor += printable.length
    if (cursor === line.length) out.write(printable)
    else redraw()
  }

  const complete = () => {
    const before = line.slice(0, cursor)
    const m = /(\S*)$/.exec(before)!
    const word = m[1]
    const dirPart = word.includes('/') ? word.slice(0, word.lastIndexOf('/') + 1) : ''
    const base = word.slice(dirPart.length)
    const dir = resolve(sh.state.cwd, dirPart || '.')
    let names: string[] = []
    try {
      names = c.vfs.readdir(dir).filter((n) => n.startsWith(base))
    } catch {
      return
    }
    if (names.length !== 1) return
    const isDir = c.vfs.isDir(resolve(dir, names[0]))
    const add = names[0].slice(base.length) + (isDir ? '/' : ' ')
    line = before + add + line.slice(cursor)
    cursor += add.length
    redraw()
  }

  // Split raw input into keys / escape sequences.
  const pump = (async () => {
    for await (const chunk of io.stdin) {
      // Pasted text with newlines: treat each char as a key.
      const re = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b.|[\s\S]/g
      let m
      while ((m = re.exec(chunk))) onKey(m[0].replace(/^\x1bO/, '\x1b['))
    }
    lines.close()
  })()

  out.write(prompt())
  for await (const l of lines) {
    if (io.signal.aborted) break
    if (l.trim()) {
      const abort = new AbortController()
      const stdin = new Channel()
      job = { abort, stdin, buf: '' }
      const onKill = () => abort.abort()
      io.signal.addEventListener('abort', onKill)
      try {
        await sh.run(l, { stdout: out, stderr: out, stdin, signal: abort.signal, isTTY: true })
      } catch (e) {
        out.write(`jsh: ${errorMessage(e)}\n`)
      } finally {
        io.signal.removeEventListener('abort', onKill)
        stdin.close()
        job = null
      }
      if (sh.state.exitRequested !== undefined) break
    }
    out.write(prompt())
  }
  void pump
  return sh.state.exitRequested ?? sh.status
}
