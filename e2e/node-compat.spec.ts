import { expect, test, type Page } from '@playwright/test'
import * as zlib from 'node:zlib'

// `zlib` and `child_process` in `node`. Chromium has no brotli in CompressionStream, so there brotli goes through
// the host's WASM fallback; Firefox/WebKit use it natively (`pnpm test:e2e:all`).

type Win = Window & { container: import('../src/container').Container }

/** scripts/serve.mjs serves a preview origin on the next port (same site as the host). */
const previewOf = (baseURL: string) => {
  const u = new URL(baseURL)
  u.port = String(Number(u.port) + 1)
  return u.origin
}

async function boot(page: Page, previewOrigin?: string) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto('/demo/blank.html')
  await page.evaluate(async (previewOrigin) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot(previewOrigin ? { previewOrigin } : {})
    ;(window as unknown as Win).container = c
    // a host command, for child_process to reach; `greet - …` reads stdin
    c.registerCommand('greet', async (ctx) => {
      let input = ''
      const args = ctx.args[0] === '-' ? ctx.args.slice(1) : ctx.args
      if (args !== ctx.args) for await (const s of ctx.stdin) input += s
      ctx.stdout.write(`hello ${args.join(' ')} from ${ctx.cwd}${input ? ` (stdin: ${input.trim()})` : ''}\n`)
      ctx.stderr.write('greet: done\n')
      return ctx.env.GREET_CODE ? Number(ctx.env.GREET_CODE) : 0
    })
  }, previewOrigin)
}

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

const sh = (page: Page, line: string) =>
  page.evaluate(async (line) => {
    const p = await (window as unknown as Win).container.spawn('jsh', ['-c', line])
    let out = ''
    const piped = p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    await piped.catch(() => {})
    return { code, out }
  }, line)

/** Run a node script; returns its last stdout line as JSON. */
async function run(page: Page, name: string, script: string) {
  await write(page, name, script)
  const r = await sh(page, `node ${name}`)
  expect(r.code, r.out).toBe(0)
  try {
    return JSON.parse(r.out.trim().split('\n').pop()!)
  } catch {
    throw new Error(`no JSON in: ${r.out}`)
  }
}

const TEXT = 'fixture from real node '.repeat(20)
// made by Node's zlib
const FIXTURES = {
  gzip: 'H4sIAAAAAAAAE0vLrCgpLUpVSCvKz1UoSk3MUcjLT0lVSBsVHnrCAKFo4TnMAQAA',
  deflate: 'eJxLy6woKS1KVUgrys9VKEpNzFHIy09JVUgbFR56wgDf5apl',
  deflateRaw: 'S8usKCktSlVIK8rPVShKTcxRyMtPSVVIGxUeesIA',
  brotli: 'G8sB+MV2Oa03r9FFVHF6PigME/oW+e+JCG1DtMKsEw==',
}

const ZLIB_SCRIPT = `const zlib = require('zlib')
const { promisify } = require('util')
const { pipeline, Readable, Writable } = require('stream')
const text = ${JSON.stringify(TEXT)}
const fixtures = ${JSON.stringify(FIXTURES)}
const pairs = { gzip: 'gunzip', deflate: 'inflate', deflateRaw: 'inflateRaw', brotliCompress: 'brotliDecompress' }
const fix = { gzip: 'gzip', deflate: 'deflate', deflateRaw: 'deflateRaw', brotliCompress: 'brotli' }
const cap = (s) => s[0].toUpperCase() + s.slice(1)
const streamThrough = (streams, chunks) => new Promise((resolve, reject) => {
  const out = []
  pipeline(Readable.from(chunks), ...streams, new Writable({ write(c, _e, cb) { out.push(c); cb() } }), (e) => (e ? reject(e) : resolve(Buffer.concat(out))))
})
const codeOf = (fn) => { try { fn(); return 'no error' } catch (e) { return e.code } }
;(async () => {
  const r = {}
  for (const [c, d] of Object.entries(pairs)) {
    const sync = zlib[c + 'Sync'](text)
    const viaCb = await new Promise((res, rej) => zlib[c](Buffer.from(text), (e, b) => (e ? rej(e) : res(b))))
    const viaPromise = await promisify(zlib[d])(viaCb)
    const chunks = [text.slice(0, 7), text.slice(7, 200), text.slice(200)].map((s) => Buffer.from(s))
    const streamed = await streamThrough([zlib['create' + cap(c)](), zlib['create' + cap(d)]()], chunks)
    r[c] = {
      sync: zlib[d + 'Sync'](sync).toString() === text,
      cb: viaPromise.toString() === text,
      stream: streamed.toString() === text,
      fixture: zlib[d + 'Sync'](Buffer.from(fixtures[fix[c]], 'base64')).toString() === text,
      fixtureAsync: (await promisify(zlib[d])(Buffer.from(fixtures[fix[c]], 'base64'))).toString() === text,
      isBuffer: Buffer.isBuffer(sync) && Buffer.isBuffer(viaCb),
      ours: sync.toString('base64'),
      oursStreamed: (await streamThrough([zlib['create' + cap(c)]()], chunks)).toString('base64'),
    }
  }
  r.unzip = [zlib.unzipSync(Buffer.from(fixtures.gzip, 'base64')).toString() === text, zlib.unzipSync(Buffer.from(fixtures.deflate, 'base64')).toString() === text]
  r.errors = {
    gunzipGarbage: codeOf(() => zlib.gunzipSync(Buffer.from('not gzip at all'))),
    gunzipTruncated: codeOf(() => zlib.gunzipSync(Buffer.from(fixtures.gzip, 'base64').subarray(0, 12))),
    brotliGarbage: codeOf(() => zlib.brotliDecompressSync(Buffer.from('nope!!'))),
    asyncGarbage: await new Promise((res) => zlib.inflate(Buffer.from('xx'), (e) => res(e && e.code))),
    streamGarbage: await streamThrough([zlib.createGunzip()], [Buffer.from('not gzip at all')]).then(() => 'no error', (e) => e.code),
  }
  r.misc = {
    constants: zlib.constants.Z_BEST_COMPRESSION === 9 && zlib.constants.BROTLI_PARAM_QUALITY === 1 && zlib.Z_SYNC_FLUSH === 2,
    classes: new zlib.Gzip() instanceof zlib.Gzip && zlib.createGzip() instanceof zlib.Zlib,
    quality: zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }).length > 0,
    big: zlib.gunzipSync(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024, 'a'))).length,
  }
  console.log(JSON.stringify(r))
})()
`

/** What the in-container zlib produced must be what real Node's zlib reads back. */
function checkZlib(r: Record<string, unknown>) {
  const real: Record<string, (b: Buffer) => Buffer> = { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, deflateRaw: zlib.inflateRawSync, brotliCompress: zlib.brotliDecompressSync }
  for (const [k, inflate] of Object.entries(real)) {
    const e = r[k] as Record<string, unknown>
    expect(e, k).toMatchObject({ sync: true, cb: true, stream: true, fixture: true, fixtureAsync: true, isBuffer: true })
    expect(inflate(Buffer.from(e.ours as string, 'base64')).toString(), k).toBe(TEXT)
    expect(inflate(Buffer.from(e.oursStreamed as string, 'base64')).toString(), k).toBe(TEXT)
  }
  expect(r.unzip).toEqual([true, true])
  expect(r.errors).toEqual({ gunzipGarbage: 'Z_DATA_ERROR', gunzipTruncated: 'Z_BUF_ERROR', brotliGarbage: 'Z_DATA_ERROR', asyncGarbage: 'Z_DATA_ERROR', streamGarbage: 'Z_DATA_ERROR' })
  expect(r.misc).toEqual({ constants: true, classes: true, quality: true, big: 5 * 1024 * 1024 })
}

const CHILD_SCRIPT = `const cp = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
fs.writeFileSync('up.js', "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase())); process.stdin.on('end', () => console.error('up: eof'))")
fs.mkdirSync('sub', { recursive: true })
fs.writeFileSync('args.js', 'console.log(JSON.stringify(process.argv.slice(2)))')
const collect = (child) => new Promise((resolve) => {
  let out = '', err = ''
  child.stdout && child.stdout.on('data', (d) => (out += d))
  child.stderr && child.stderr.on('data', (d) => (err += d))
  const events = []
  child.on('spawn', () => events.push('spawn'))
  child.on('exit', (code, signal) => events.push('exit:' + code + ':' + signal))
  child.on('error', (e) => events.push('error:' + e.code))
  child.on('close', (code, signal) => resolve({ out, err, code, signal, events }))
})
;(async () => {
  const r = {}
  // spawn: a host command with args, env, cwd and piped stdin
  const greet = cp.spawn('greet', ['-', 'you', 'there'], { cwd: 'sub', env: { ...process.env, GREET_CODE: '4' } })
  greet.stdin.write('some ')
  greet.stdin.end('input')
  r.greet = await collect(greet)
  // spawn node, stream stdin through it
  const up = cp.spawn('node', ['up.js'])
  up.stdin.write('abc')
  up.stdin.end('def')
  r.up = await collect(up)
  // process.execPath and npm
  r.execPath = (await collect(cp.spawn(process.execPath, ['-p', '6 * 7']))).out
  r.npm = cp.execFileSync('npm', ['--version'], { encoding: 'utf8' })
  // exec runs jsh: pipes, &&, exit codes, env changes in this process
  process.env.FROM_PARENT = 'yes'
  r.exec = await promisify(cp.exec)('echo $FROM_PARENT && echo piped | grep pipe')
  r.execFail = await new Promise((res) => cp.exec('GREET_CODE=3 greet x', (e, stdout, stderr) => res({ message: e.message, code: e.code, stdout, stderr })))
  r.execFile = await new Promise((res) => cp.execFile('node', ['args.js', 'a', 'b c'], (e, stdout) => res([e, stdout])))
  // sync
  r.execSync = cp.execSync('node -p "1 + 1"').toString()
  r.spawnSync = (({ status, stdout, stderr }) => ({ status, stdout, stderr }))(cp.spawnSync('node', ['up.js'], { input: 'piped in', encoding: 'utf8' }))
  r.execSyncFail = (() => { try { cp.execSync('greet x', { env: { GREET_CODE: '5' }, stdio: 'pipe' }) } catch (e) { return { status: e.status, stdout: String(e.stdout), message: e.message } } })()
  r.syncEnoent = cp.spawnSync('no-such-cmd').error.code
  // inherit: the child writes to this process's stdout directly
  r.inherit = await collect(cp.spawn('echo', ['inherited'], { stdio: 'inherit' }))
  // shell option
  r.shell = (await collect(cp.spawn('echo a; echo b', { shell: true }))).out
  // ENOENT
  r.enoent = await new Promise((res) => cp.spawn('no-such-cmd', ['x']).on('error', (e) => res({ code: e.code, errno: e.errno, syscall: e.syscall, path: e.path, spawnargs: e.spawnargs })))
  // kill a long-running child
  const sleeper = cp.spawn('node', ['-e', 'setInterval(() => {}, 1000)'])
  setTimeout(() => sleeper.kill(), 300)
  r.kill = await collect(sleeper)
  r.killed = sleeper.killed
  // kill(0) only probes; a paused stdout doesn't hold 'close' back; SIGKILL can't be caught
  const probe = cp.spawn('node', ['-e', "process.on('SIGKILL', () => console.error('caught')); console.log('x'); setInterval(() => {}, 1000)"])
  let probeErr = ''
  probe.stderr.on('data', (d) => (probeErr += d))
  await new Promise((res) => probe.stdout.once('data', res))
  probe.stdout.pause()
  r.probe = probe.kill(0) && probe.exitCode === null
  probe.kill('SIGKILL')
  r.sigkill = await new Promise((res) => probe.on('close', (code, signal) => res([signal, probeErr])))
  // 'close' comes after a slow async-iterator reader has all the output
  const slow = cp.spawn('node', ['-e', "for (let i = 0; i < 5; i++) console.log('line ' + i)"])
  let slowOut = ''
  const reading = (async () => { for await (const c of slow.stdout) { slowOut += c; await new Promise((res) => setTimeout(res, 20)) } })()
  await new Promise((res) => slow.on('close', res))
  r.slowAtClose = slowOut
  await reading
  // a reader that pauses gets the rest after exit, then 'close'
  const pauser = cp.spawn('node', ['-e', "process.stdout.write('a'); setTimeout(() => process.stdout.write('b'), 30)"])
  let paused = ''
  pauser.stdout.on('data', (d) => { paused += d; pauser.stdout.pause() })
  await new Promise((res) => pauser.on('close', res))
  r.pausedAtClose = paused
  // an 'exit' handler that drops the only 'readable' listener (never read): the rest is discarded, then 'close'
  const dropper = cp.spawn('node', ['-e', "console.log('unread')"])
  const onReadable = () => {}
  dropper.stdout.on('readable', onReadable)
  dropper.on('exit', () => dropper.stdout.removeListener('readable', onReadable))
  r.dropped = await new Promise((res) => dropper.on('close', (code) => res(code)))
  r.timeout = await new Promise((res) => cp.exec('sleep 5', { timeout: 200 }, (e) => res({ killed: e.killed, signal: e.signal })))
  // a child blocked reading stdin still dies when killed
  r.catTimeout = await new Promise((res) => cp.exec('cat', { timeout: 100 }, (e) => res(e.signal)))
  // the signal reaches a node child
  const term = cp.spawn('node', ['-e', "process.on('SIGTERM', () => { console.log('got SIGTERM'); process.exit(0) }); setInterval(() => {}, 1000)"])
  setTimeout(() => term.kill('SIGTERM'), 300)
  r.sigterm = await collect(term)
  // process.execPath through the shell, several node -e children at once, cwd relative to process.cwd()
  r.execPathShell = cp.execSync(process.execPath + ' -p "3 + 4"', { encoding: 'utf8' })
  r.parallel = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => promisify(cp.execFile)('node', ['-p', String(i * 10)]).then((x) => x.stdout)))
  process.chdir('sub')
  r.relCwd = cp.execSync('pwd', { cwd: '..', encoding: 'utf8' })
  process.chdir('..')
  // multibyte characters split across stdin writes
  const utf = cp.spawn('cat')
  const bytes = Buffer.from('héllo ✓')
  utf.stdin.write(bytes.subarray(0, 2))
  utf.stdin.end(bytes.subarray(2))
  r.utf8 = (await collect(utf)).out
  console.log(JSON.stringify(r))
})()
`

function checkChild(r: Record<string, unknown>, out: string) {
  expect(r.greet).toEqual({ out: 'hello you there from /home/project/sub (stdin: some input)\n', err: 'greet: done\n', code: 4, signal: null, events: ['spawn', 'exit:4:null'] })
  expect(r.up).toEqual({ out: 'ABCDEF', err: 'up: eof\n', code: 0, signal: null, events: ['spawn', 'exit:0:null'] })
  expect(r.execPath).toBe('42\n')
  expect(r.npm).toMatch(/^\d+\.\d+\.\d+\n$/)
  expect(r.exec).toEqual({ stdout: 'yes\npiped\n', stderr: '' })
  expect(r.execFail).toEqual({ message: 'Command failed: GREET_CODE=3 greet x\ngreet: done\n', code: 3, stdout: 'hello x from /home/project\n', stderr: 'greet: done\n' })
  expect(r.execFile).toEqual([null, '["a","b c"]\n'])
  expect(r.execSync).toBe('2\n')
  expect(r.spawnSync).toEqual({ status: 0, stdout: 'PIPED IN', stderr: 'up: eof\n' })
  expect(r.execSyncFail).toEqual({ status: 5, stdout: 'hello x from /home/project\n', message: 'Command failed: greet x\ngreet: done\n' })
  expect(r.syncEnoent).toBe('ENOENT')
  expect(r.inherit).toEqual({ out: '', err: '', code: 0, signal: null, events: ['spawn', 'exit:0:null'] })
  expect(out).toContain('inherited\n')
  expect(r.shell).toBe('a\nb\n')
  expect(r.enoent).toEqual({ code: 'ENOENT', errno: -2, syscall: 'spawn no-such-cmd', path: 'no-such-cmd', spawnargs: ['x'] })
  expect(r.kill).toMatchObject({ code: null, signal: 'SIGTERM', events: ['spawn', 'exit:null:SIGTERM'] })
  expect(r.killed).toBe(true)
  expect(r.probe).toBe(true)
  expect(r.sigkill).toEqual(['SIGKILL', ''])
  expect(r.slowAtClose).toBe('line 0\nline 1\nline 2\nline 3\nline 4\n')
  expect(r.pausedAtClose).toBe('ab')
  expect(r.dropped).toBe(0)
  expect(r.timeout).toEqual({ killed: true, signal: 'SIGTERM' })
  expect(r.catTimeout).toBe('SIGTERM')
  expect(r.sigterm).toMatchObject({ out: 'got SIGTERM\n' })
  expect(r.execPathShell).toBe('7\n')
  expect(r.parallel).toEqual(['10\n', '20\n', '30\n', '40\n', '50\n', '60\n'])
  expect(r.relCwd).toBe('/home/project\n')
  expect(r.utf8).toBe('héllo ✓')
}

test.describe.serial('node zlib + child_process', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page)
  })

  test('zlib: gzip, deflate, deflate-raw and brotli, sync / callback / promise / streams, interoperable with Node', async () => {
    checkZlib(await run(page, 'z.js', ZLIB_SCRIPT))
  })

  test('child_process: spawn / exec / execFile and sync variants run jsh, node, npm and registered commands', async () => {
    await write(page, 'cp.js', CHILD_SCRIPT)
    const r = await sh(page, 'node cp.js')
    expect(r.code, r.out).toBe(0)
    checkChild(JSON.parse(r.out.trim().split('\n').pop()!), r.out)
  })

  test("children die with their parent process", async () => {
    await write(page, 'parent.js', "require('child_process').spawn('node', ['-e', 'setInterval(() => require(\"fs\").appendFileSync(\"ticks\", \"t\"), 50)'])\nsetTimeout(() => process.exit(0), 300)\n")
    expect((await sh(page, 'node parent.js')).code).toBe(0)
    const ticks = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('ticks', 'utf8'))
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => (window as unknown as Win).container.fs.readFile('ticks', 'utf8'))).toBe(ticks)
  })

  test('a real package: the `compression` middleware serves brotli and gzip that zlib reads back', async () => {
    await write(page, 'package.json', JSON.stringify({ name: 'z', version: '1.0.0', dependencies: { compression: '1.8.2' } }))
    const inst = await sh(page, 'npm install')
    expect(inst.code, inst.out).toBe(0)
    const r = await run(
      page,
      'server.js',
      `const http = require('http')
const zlib = require('zlib')
const compression = require('compression')
const mw = compression({ threshold: 0 })
const body = 'compressed '.repeat(500)
// in-container requests go through fetch(), which drops the forbidden Accept-Encoding header: send it as another
const server = http.createServer((req, res) => {
  req.headers['accept-encoding'] = req.headers['x-accept-encoding']
  mw(req, res, () => { res.setHeader('content-type', 'text/plain'); res.end(body) })
})
server.listen(3010, async () => {
  const get = (enc) => new Promise((resolve, reject) => http.get('http://localhost:3010/', { headers: { 'x-accept-encoding': enc } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ enc: res.headers['content-encoding'], buf: Buffer.concat(chunks) }))
  }).on('error', reject))
  const br = await get('br')
  const gz = await get('gzip')
  console.log(JSON.stringify({ br: br.enc, brOk: zlib.brotliDecompressSync(br.buf).toString() === body, gz: gz.enc, gzOk: zlib.gunzipSync(gz.buf).toString() === body, smaller: br.buf.length < body.length }))
  server.close()
})
`,
    )
    expect(r).toEqual({ br: 'br', brOk: true, gz: 'gzip', gzOk: true, smaller: true })
  })
})

test.describe.serial('node zlib + child_process on the preview origin', () => {
  let page: Page

  test.beforeAll(async ({ browser, baseURL }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, previewOf(baseURL!))
  })

  test('zlib, through the relay', async () => {
    checkZlib(await run(page, 'z.js', ZLIB_SCRIPT))
  })

  test('child_process, through the relay', async () => {
    await write(page, 'cp.js', CHILD_SCRIPT)
    const r = await sh(page, 'node cp.js')
    expect(r.code, r.out).toBe(0)
    checkChild(JSON.parse(r.out.trim().split('\n').pop()!), r.out)
  })
})
