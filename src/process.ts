// Process plumbing: commands, contexts, async string channels, spawned process handles.
import type { Container } from './container'

export interface Writer {
  write(s: string): void
}

export interface CommandContext {
  args: string[]
  cwd: string
  env: Record<string, string>
  stdout: Writer
  stderr: Writer
  stdin: AsyncIterable<string>
  signal: AbortSignal
  container: Container
  /** True when attached to an interactive terminal (jsh). */
  isTTY?: boolean
}

export type Command = (ctx: CommandContext) => Promise<number>

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  /** Write '\r\n' line endings (default: false, except for interactive `jsh`). */
  terminal?: boolean
}

export interface ContainerProcess {
  output: ReadableStream<string>
  input: WritableStream<string>
  exit: Promise<number>
  kill(): void
}

/** Unbounded async string queue. */
export class Channel implements AsyncIterable<string> {
  private buf: string[] = []
  private waiters: ((r: IteratorResult<string>) => void)[] = []
  closed = false

  push(s: string): void {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: s, done: false })
    else this.buf.push(s)
  }
  close(): void {
    this.closed = true
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true })
  }
  /** Drain without awaiting. */
  takeAll(): string[] {
    return this.buf.splice(0)
  }
  next(): Promise<IteratorResult<string>> {
    if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false })
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((r) => this.waiters.push(r))
  }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return { next: () => this.next(), return: async () => ({ value: undefined, done: true }) }
  }
}

export const EMPTY_STDIN: AsyncIterable<string> = {
  [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }),
}

/** Read all of stdin into a string. */
export async function readAll(it: AsyncIterable<string>): Promise<string> {
  let s = ''
  for await (const c of it) s += c
  return s
}

/** Write helper that converts '\n' to '\r\n' for terminals. */
export function crlf(w: Writer): Writer {
  return { write: (s) => w.write(s.replace(/\r?\n/g, '\r\n')) }
}

/** Build a ContainerProcess around a running command. */
export function createProcess(
  run: (io: { stdout: Writer; stderr: Writer; stdin: Channel; signal: AbortSignal }) => Promise<number>,
  opts: { terminal?: boolean } = {},
): ContainerProcess {
  const abort = new AbortController()
  const stdin = new Channel()
  let ctrl!: ReadableStreamDefaultController<string>
  let closed = false
  const output = new ReadableStream<string>({
    start: (c) => void (ctrl = c),
    cancel: () => void (closed = true),
  })
  const raw: Writer = {
    write: (s) => {
      if (!closed && s) {
        try {
          ctrl.enqueue(s)
        } catch {
          closed = true
        }
      }
    },
  }
  const out = opts.terminal ? crlf(raw) : raw
  const input = new WritableStream<string>({
    write: (s) => stdin.push(String(s)),
    close: () => stdin.close(),
  })
  const exit = (async () => {
    await Promise.resolve()
    try {
      return await run({ stdout: out, stderr: out, stdin, signal: abort.signal })
    } catch (e) {
      out.write(`${errorMessage(e)}\n`)
      return 1
    }
  })().then((code) => {
    stdin.close()
    if (!closed) {
      closed = true
      try {
        ctrl.close()
      } catch {
        /* already closed */
      }
    }
    return code
  })
  return { output, input, exit, kill: () => abort.abort() }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** Resolve when the signal aborts. */
export function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((r) => (signal.aborted ? r() : signal.addEventListener('abort', () => r(), { once: true })))
}
