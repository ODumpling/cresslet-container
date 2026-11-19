// Main-thread side of `node`: spawns the worker, services fs/resolve/load RPC, bridges http ports.
import type { Container } from '../container'
import type { CommandContext } from '../process'
import { errorMessage } from '../process'
import { extname, resolve as resolvePath } from '../path'
import { FsError, toBytes } from '../vfs'
import { NODE_OPTS, resolveModule } from '../resolve'
import { isEsmFile } from '../esm'
import { formatErrors, loadEsbuild } from '../esbuild'
import {
  DEFAULT_SAB,
  encodeResult,
  HEADER,
  STATE_DONE,
  STATE_GROW,
  type MainToWorker,
  type WorkerToMain,
} from './protocol'

const HASHES: Record<string, string> = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }

interface LoadCacheEntry {
  mtime: number
  value: { code: string; format: 'cjs' | 'json' }
}
const loadCache = new WeakMap<Container, Map<string, LoadCacheEntry>>()

async function loadModule(c: Container, path: string): Promise<{ code: string; format: 'cjs' | 'json' }> {
  const st = c.vfs.stat(path)
  let cache = loadCache.get(c)
  if (!cache) loadCache.set(c, (cache = new Map()))
  const hit = cache.get(path)
  if (hit && hit.mtime === st.mtimeMs) return hit.value
  const code = c.vfs.readText(path)
  const ext = extname(path)
  let value: { code: string; format: 'cjs' | 'json' }
  if (ext === '.json') value = { code, format: 'json' }
  else {
    const ts = /\.[mc]?tsx?$/.test(ext) || ext === '.jsx'
    const esm = isEsmFile(c.resolveFs, path, code)
    if (!ts && !esm) value = { code, format: 'cjs' }
    else {
      const es = await loadEsbuild(c.esbuildWasmUrl)
      try {
        const r = await es.transform(code, {
          loader: ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ts ? 'ts' : 'js',
          format: 'cjs',
          platform: 'node',
          target: 'es2022',
          sourcefile: path,
          sourcemap: 'inline',
          jsx: 'automatic',
          define: { 'import.meta.url': '__clover_meta_url', 'import.meta.dirname': '__dirname', 'import.meta.filename': '__filename' },
          supported: { 'dynamic-import': false },
          logLevel: 'silent',
        })
        value = { code: r.code, format: 'cjs' }
      } catch (e) {
        const msg = formatErrors(e)
        if (/Top-level await/.test(msg)) throw new Error(`${path}: top-level await is not supported by clover's node runtime yet; wrap it in an async function`)
        throw new SyntaxError(msg)
      }
    }
  }
  cache.set(path, { mtime: st.mtimeMs, value })
  return value
}

/** Execute one RPC op against the container. Shared by sync and async channels. */
export async function runOp(c: Container, op: string, args: unknown[]): Promise<unknown> {
  const vfs = c.vfs
  const p = args[0] as string
  switch (op) {
    case 'readFile':
      return vfs.readFile(p)
    case 'writeFile':
      vfs.writeFile(p, toBytes(args[1] as string | Uint8Array), { append: args[2] === 'a' })
      return undefined
    case 'stat':
    case 'lstat': {
      const s = op === 'stat' ? vfs.stat(p) : vfs.lstat(p)
      return { type: s.type, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, mode: s.mode }
    }
    case 'exists':
      return vfs.exists(p)
    case 'readdir':
      return vfs.readdirEntries(p).map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'symlink' : 'file' }))
    case 'mkdir': {
      const existed = vfs.exists(p)
      vfs.mkdir(p, { recursive: !!args[1] })
      return args[1] && !existed ? p : undefined
    }
    case 'rm':
      vfs.rm(p, { recursive: !!args[1], force: !!args[2] })
      return undefined
    case 'unlink':
      vfs.unlink(p)
      return undefined
    case 'rmdir':
      vfs.rmdir(p)
      return undefined
    case 'rename':
      vfs.rename(p, args[1] as string)
      return undefined
    case 'copyFile':
      vfs.copyFile(p, args[1] as string)
      return undefined
    case 'cp':
      vfs.cp(p, args[1] as string)
      return undefined
    case 'realpath':
      return vfs.realpath(p)
    case 'readlink':
      return vfs.readlink(p)
    case 'symlink':
      vfs.symlink(p, args[1] as string)
      return undefined
    case 'utimes':
      vfs.utimes(p, args[1] as number)
      return undefined
    case 'resolve':
      return resolveModule(c.resolveFs, p, args[1] as string, NODE_OPTS)
    case 'load':
      return loadModule(c, p)
    case 'hash': {
      const name = HASHES[(p || '').toLowerCase().replace('-', '')]
      if (!name) throw new Error(`Digest method not supported: ${p}`)
      return new Uint8Array(await crypto.subtle.digest(name, args[1] as BufferSource))
    }
    case 'hmac': {
      const name = HASHES[(p || '').toLowerCase().replace('-', '')]
      if (!name) throw new Error(`Digest method not supported: ${p}`)
      const key = await crypto.subtle.importKey('raw', args[1] as BufferSource, { name: 'HMAC', hash: name }, false, ['sign'])
      return new Uint8Array(await crypto.subtle.sign('HMAC', key, args[2] as BufferSource))
    }
    case 'fetch-local': {
      const [port, method, url, headers, body] = args as [number, string, string, [string, string][], ArrayBuffer | null]
      const res = await c.ports.dispatch(port, new Request(url, { method, headers, body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined }))
      return { status: res.status, statusText: res.statusText, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) }
    }
    default:
      throw new Error(`unknown op ${op}`)
  }
}

let pidCounter = 100

/** The `node` command. */
export async function nodeCommand(ctx: CommandContext): Promise<number> {
  const c = ctx.container
  const args = [...ctx.args]
  if (args[0] === '-v' || args[0] === '--version') {
    ctx.stdout.write(`${NODE_VERSION}\n`)
    return 0
  }
  let evalCode: string | null = null
  while (args[0]?.startsWith('-')) {
    const a = args.shift()!
    if (a === '-e' || a === '--eval' || a === '-p' || a === '--print') {
      const code = args.shift() ?? ''
      evalCode = a === '-p' || a === '--print' ? `console.log(eval(${JSON.stringify(code)}))` : code
    } else if (a === '--') break
    // other flags (--enable-source-maps, --experimental-*) ignored
  }
  let entry: string
  if (evalCode !== null) {
    entry = resolvePath(ctx.cwd, `[eval-${Date.now()}].js`)
    c.vfs.writeFile(entry, evalCode)
  } else {
    if (!args.length) {
      ctx.stderr.write('node: interactive REPL is not supported; pass a script\n')
      return 1
    }
    entry = resolvePath(ctx.cwd, args.shift()!)
  }
  try {
    return await runNode(ctx, entry, args)
  } finally {
    if (evalCode !== null) c.vfs.rm(entry, { force: true })
  }
}

export const NODE_VERSION = 'v22.12.0'

export function runNode(ctx: CommandContext, entry: string, args: string[]): Promise<number> {
  const c = ctx.container
  const worker = c.createWorker('node-worker.js')
  const isolated = typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated !== false
  let sab: SharedArrayBuffer | null = isolated ? new SharedArrayBuffer(HEADER + DEFAULT_SAB) : null
  const post = (m: MainToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
  const ports = new Set<number>()
  const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void; ctrl?: ReadableStreamDefaultController<Uint8Array> }>()
  let reqId = 0
  let stash: Uint8Array | null = null

  const writeSync = (payload: Uint8Array) => {
    const buf = sab!
    const i32 = new Int32Array(buf, 0, 2)
    if (payload.byteLength > buf.byteLength - HEADER) {
      stash = payload
      Atomics.store(i32, 1, payload.byteLength)
      Atomics.store(i32, 0, STATE_GROW)
    } else {
      new Uint8Array(buf, HEADER, payload.byteLength).set(payload)
      Atomics.store(i32, 1, payload.byteLength)
      Atomics.store(i32, 0, STATE_DONE)
    }
    Atomics.notify(i32, 0)
  }

  return new Promise<number>((resolveExit) => {
    let done = false
    const finish = (code: number) => {
      if (done) return
      done = true
      worker.terminate()
      for (const p of ports) c.ports.close(p)
      for (const [, p] of pending) p.reject(new Error('process exited'))
      ctx.signal.removeEventListener('abort', onAbort)
      resolveExit(code)
    }
    const onAbort = () => {
      post({ type: 'signal', name: 'SIGINT' })
      // give the process a moment to clean up, then hard-kill
      setTimeout(() => finish(130), 150)
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    worker.onerror = (e) => {
      ctx.stderr.write(`node: worker error: ${e.message ?? e}\n`)
      finish(1)
    }
    worker.onmessage = async (ev: MessageEvent<WorkerToMain>) => {
      const m = ev.data
      switch (m.type) {
        case 'stdout':
          ctx.stdout.write(m.data)
          break
        case 'stderr':
          ctx.stderr.write(m.data)
          break
        case 'exit':
          finish(m.code)
          break
        case 'sync': {
          let payload: Uint8Array
          try {
            payload = encodeResult(true, await runOp(c, m.op, m.args))
          } catch (e) {
            payload = encodeResult(false, e instanceof FsError ? e : { message: errorMessage(e), code: (e as { code?: string }).code })
          }
          writeSync(payload)
          break
        }
        case 'sync-grow': {
          sab = m.sab
          const payload = stash!
          stash = null
          writeSync(payload)
          break
        }
        case 'async': {
          try {
            const value = await runOp(c, m.op, m.args)
            post({ type: 'async-result', id: m.id, ok: true, value })
          } catch (e) {
            post({ type: 'async-result', id: m.id, ok: false, value: { message: errorMessage(e), code: (e as { code?: string }).code } })
          }
          break
        }
        case 'listen': {
          ports.add(m.port)
          c.ports.open(m.port, (req) => forward(m.port, req), 'node')
          break
        }
        case 'unlisten':
          ports.delete(m.port)
          c.ports.close(m.port)
          break
        case 'http-head': {
          const p = pending.get(m.id)
          if (!p) break
          const nullBody = m.status === 204 || m.status === 304 || m.status === 101
          const body = nullBody
            ? null
            : new ReadableStream<Uint8Array>({
                start: (ctrl) => void (p.ctrl = ctrl),
                cancel: () => post({ type: 'http-abort', id: m.id }),
              })
          p.resolve(new Response(body, { status: m.status, statusText: m.statusText, headers: m.headers.filter(([k]) => k.toLowerCase() !== 'content-length' || !nullBody) }))
          if (nullBody) pending.delete(m.id)
          break
        }
        case 'http-chunk':
          pending.get(m.id)?.ctrl?.enqueue(m.data)
          break
        case 'http-end': {
          const p = pending.get(m.id)
          pending.delete(m.id)
          try {
            if (m.error) p?.ctrl?.error(new Error(m.error))
            else p?.ctrl?.close()
          } catch {
            /* stream cancelled */
          }
          break
        }
      }
    }

    const forward = async (port: number, req: Request): Promise<Response> => {
      const id = ++reqId
      const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer()
      const u = new URL(req.url)
      return new Promise<Response>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        post({ type: 'http-request', id, port, method: req.method, url: u.pathname + u.search, headers: [...req.headers], body }, body ? [body] : [])
      })
    }

    ctx.stdin[Symbol.asyncIterator] &&
      (async () => {
        for await (const s of ctx.stdin) {
          if (done) return
          post({ type: 'stdin', data: s })
        }
        if (!done) post({ type: 'stdin-end' })
      })()

    post({
      type: 'start',
      argv: ['/usr/local/bin/node', entry, ...args],
      env: ctx.env,
      cwd: ctx.cwd,
      isTTY: !!ctx.isTTY,
      columns: 80,
      pid: ++pidCounter,
      sab,
      ports: c.ports.list(),
    })
  })
}
