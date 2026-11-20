import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as nodeZlib from 'node:zlib'
import { compress, decompress } from 'brotli-wasm-web'
import { loadBrotli, zlibOp } from '../src/node/brotli'
import { zlibError } from '../src/node/codec'
import { ChildHost, parseSpec } from '../src/node/child'
import type { ChildEvent, ChildSpec } from '../src/node/protocol'
import type { Command, CommandContext } from '../src/process'
import { VFS } from '../src/vfs'
import { join } from '../src/path'

const text = 'cresslet zlib '.repeat(100)

describe('zlib host side', () => {
  it('bundled brotli-wasm glue + its .wasm round-trip with Node', async () => {
    await loadBrotli(readFileSync(fileURLToPath(new URL('../node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm', import.meta.url))))
    const ours = compress(Buffer.from(text), { quality: 5 })
    expect(nodeZlib.brotliDecompressSync(ours).toString()).toBe(text)
    expect(Buffer.from(decompress(nodeZlib.brotliCompressSync(text))).toString()).toBe(text)
  })

  it('zlibOp (de)compresses every format and maps bad input to zlib errors', async () => {
    for (const [format, inflate] of [
      ['gzip', nodeZlib.gunzipSync],
      ['deflate', nodeZlib.inflateSync],
      ['deflate-raw', nodeZlib.inflateRawSync],
      ['brotli', nodeZlib.brotliDecompressSync],
    ] as const) {
      const z = await zlibOp(format, 'compress', Buffer.from(text), undefined)
      expect(inflate(z).toString(), format).toBe(text)
      expect(Buffer.from(await zlibOp(format, 'decompress', z, undefined)).toString(), format).toBe(text)
    }
    await expect(zlibOp('gzip', 'decompress', Buffer.from('nope'), undefined)).rejects.toMatchObject({ code: 'Z_DATA_ERROR', errno: -3, message: 'incorrect header check' })
    await expect(zlibOp('gzip', 'decompress', nodeZlib.gzipSync(text).subarray(0, 20), undefined)).rejects.toMatchObject({ code: 'Z_BUF_ERROR', errno: -5, message: 'unexpected end of file' })
    await expect(zlibOp('zstd' as never, 'compress', Buffer.from(text), undefined)).rejects.toThrow('bad arguments')
    await expect(zlibOp('gzip', 'compress', 'not bytes' as never, undefined)).rejects.toThrow('bad arguments')
  })

  it('zlibError: truncation vs bad data, across browsers', () => {
    for (const m of ['Compressed input was truncated.', 'The input is ended without reaching the stream end', 'Incomplete compressed input.']) expect(zlibError(new TypeError(m), 'gzip').code).toBe('Z_BUF_ERROR')
    for (const m of ['The compressed data was not valid: incorrect header check.', 'Failed to Decode Data.', 'Junk found after end of compressed data.']) expect(zlibError(new TypeError(m), 'deflate').code).toBe('Z_DATA_ERROR')
    expect(zlibError(new Error('x'), 'brotli')).toMatchObject({ message: 'Decompression failed', code: 'Z_DATA_ERROR' })
  })
})

const spec = (over: Partial<ChildSpec> = {}): ChildSpec => ({ file: 'echo', args: [], shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...over })

describe('child_process host side', () => {
  it('parseSpec validates what a (possibly relay-hosted) worker asks to run', () => {
    expect(parseSpec({ type: 'child-spawn', id: 1, ...spec({ cwd: 'x', env: { A: 'b' } }) })).toEqual(spec({ cwd: 'x', env: { A: 'b' } }))
    for (const bad of [null, 1, {}, { ...spec(), file: '' }, { ...spec(), file: 3 }, { ...spec(), args: [1] }, { ...spec(), shell: 'yes' }, { ...spec(), cwd: 1 }, { ...spec(), env: { A: 1 } }, { ...spec(), env: null }, { ...spec(), stdio: ['pipe', 'pipe'] }, { ...spec(), stdio: ['pipe', 'pipe', 'tty'] }])
      expect(parseSpec(bad)).toBeNull()
  })

  /** A container with just what ChildHost uses: a VFS, commands by name, and the parent's context. */
  function setup(commands: Record<string, Command>) {
    const vfs = new VFS()
    vfs.mkdir('/home/project/sub', { recursive: true })
    const container = {
      vfs,
      which: (name: string, cwd: string) => (name in commands ? `/usr/local/bin/${name}` : vfs.isFile(join(cwd, name)) ? join(cwd, name) : null),
      exec: (name: string, ctx: CommandContext) => commands[name](ctx),
    }
    let parentOut = ''
    const ctx = { args: [], cwd: '/home/project', env: { HOME: '/home' }, stdout: { write: (s: string) => void (parentOut += s) }, stderr: { write: (s: string) => void (parentOut += s) }, stdin: { [Symbol.asyncIterator]: async function* () {} }, signal: new AbortController().signal, container } as unknown as CommandContext
    const events: ChildEvent[] = []
    const host = new ChildHost(ctx, (e) => events.push(e))
    return { host, events, parentOut: () => parentOut }
  }

  const echo: Command = async (ctx) => (ctx.stdout.write(`${ctx.args.join(' ')} @${ctx.cwd} ${ctx.env.HOME ?? '-'}\n`), ctx.stderr.write('e\n'), 0)
  const cat: Command = async (ctx) => {
    for await (const s of ctx.stdin) ctx.stdout.write(s.toUpperCase())
    return 3
  }
  const forever: Command = (ctx) => new Promise((r) => ctx.signal.addEventListener('abort', () => r(130)))
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('spawn: spawn, piped output, exit; cwd and env as given', async () => {
    const { host, events } = setup({ echo })
    host.spawn(1, spec({ args: ['a', 'b'], cwd: 'sub', env: { HOME: '/x' } }))
    host.spawn(2, spec({ args: ['-v'] }))
    await tick()
    expect(events.filter((e) => e.id === 1)).toEqual([
      { type: 'child', id: 1, ev: 'spawn' },
      { type: 'child', id: 1, ev: 'out', fd: 1, data: 'a b @/home/project/sub /x\n' },
      { type: 'child', id: 1, ev: 'out', fd: 2, data: 'e\n' },
      { type: 'child', id: 1, ev: 'exit', code: 0, signal: null },
    ])
    expect(events.find((e) => e.id === 2 && e.ev === 'out')).toMatchObject({ data: '-v @/home/project /home\n' })
  })

  it('spawn: ENOENT for unknown commands and missing cwd; stdin chunks then EOF', async () => {
    const { host, events } = setup({ echo, cat })
    host.spawn(1, spec({ file: 'nope' }))
    host.spawn(2, spec({ cwd: 'missing' }))
    host.spawn(3, spec({ file: 'cat' }))
    host.stdin(3, 'ab')
    host.stdin(3, 'c')
    host.stdin(3, null)
    await tick()
    expect(events.filter((e) => e.id !== 3)).toEqual([
      { type: 'child', id: 1, ev: 'error', message: 'spawn nope ENOENT', code: 'ENOENT' },
      { type: 'child', id: 2, ev: 'error', message: 'spawn echo ENOENT', code: 'ENOENT' },
    ])
    expect(events.filter((e) => e.id === 3).map((e) => (e.ev === 'out' ? e.data : e.ev === 'exit' ? `exit ${e.code}` : e.ev))).toEqual(['spawn', 'AB', 'C', 'exit 3'])
  })

  it('stdio inherit / ignore', async () => {
    const { host, events, parentOut } = setup({ echo })
    host.spawn(1, spec({ args: ['hi'], stdio: ['pipe', 'inherit', 'ignore'] }))
    await tick()
    expect(events.map((e) => e.ev)).toEqual(['spawn', 'exit'])
    expect(parentOut()).toBe('hi @/home/project /home\n')
  })

  it('kill reports the signal, aborts with it and ends stdin; killAll ends every child and refuses new ones', async () => {
    const { host, events } = setup({ forever, cat })
    host.spawn(9, spec({ file: 'cat' }))
    await tick()
    host.kill(9, 'SIGHUP') // cat ignores the signal; it ends because its stdin does
    await tick()
    expect(events.at(-1)).toEqual({ type: 'child', id: 9, ev: 'exit', code: null, signal: 'SIGHUP' })
    let reason: unknown
    const h2 = setup({ forever: (ctx) => new Promise((r) => ctx.signal.addEventListener('abort', () => ((reason = ctx.signal.reason), r(1)))) })
    h2.host.spawn(1, spec({ file: 'forever' }))
    await tick()
    h2.host.kill(1, 'SIGTERM')
    await tick()
    expect(reason).toBe('SIGTERM')
    host.spawn(1, spec({ file: 'forever' }))
    host.spawn(2, spec({ file: 'forever' }))
    await tick()
    host.kill(1, 'SIGTERM')
    await tick()
    expect(events.at(-1)).toEqual({ type: 'child', id: 1, ev: 'exit', code: null, signal: 'SIGTERM' })
    host.killAll()
    await tick()
    expect(events.at(-1)).toEqual({ type: 'child', id: 2, ev: 'exit', code: null, signal: 'SIGKILL' })
    host.spawn(3, spec({ file: 'forever' }))
    expect(events.at(-1)).toMatchObject({ id: 3, ev: 'error' })
  })

  it('spawnSync: collects output with input as stdin; ENOENT and timeouts as errors', async () => {
    const { host } = setup({ echo, cat, forever })
    expect(await host.spawnSync(spec({ file: 'cat' }), 'in', 0)).toEqual({ status: 3, signal: null, stdout: 'IN', stderr: '' })
    expect(await host.spawnSync(spec({ args: ['x'], stdio: ['pipe', 'pipe', 'ignore'] }), null, 0)).toEqual({ status: 0, signal: null, stdout: 'x @/home/project /home\n', stderr: '' })
    expect(await host.spawnSync(spec({ file: 'nope' }), null, 0)).toMatchObject({ status: null, error: { code: 'ENOENT' } })
    expect(await host.spawnSync(spec({ file: 'forever' }), null, 20)).toMatchObject({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } })
  })
})
