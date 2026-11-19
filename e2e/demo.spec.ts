import { expect, test, type Page } from '@playwright/test'

type Win = Window & {
  container: import('../src/container').Container
  previewUrl?: string
}

/** Run a shell command line in the page's container; returns exit code + merged output. */
async function sh(page: Page, line: string): Promise<{ code: number; out: string }> {
  return page.evaluate(async (line) => {
    const c = (window as unknown as Win).container
    const p = await c.spawn('jsh', ['-c', line])
    let out = ''
    const piped = p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    await piped.catch(() => {})
    return { code, out }
  }, line)
}

test.describe.serial('clover-container demo', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e) => console.log('[pageerror]', e.message))
    await page.goto('/')
  })

  test('npm install + dev server renders the React app in the preview iframe', async () => {
    await expect.poll(() => page.evaluate(() => crossOriginIsolated)).toBe(true)
    const frame = page.frameLocator('#frame')
    await expect(frame.getByRole('heading', { name: 'Hello from Clover' })).toBeVisible({ timeout: 120_000 })
    await frame.getByRole('button', { name: 'count is 0' }).click()
    await expect(frame.getByRole('button', { name: 'count is 1' })).toBeVisible()
    // styles from `import './index.css'` applied
    await expect(frame.getByRole('heading')).toHaveCSS('color', 'rgb(31, 136, 61)')
  })

  test('editing a file through the API live-reloads the preview', async () => {
    await page.evaluate(() =>
      (window as unknown as Win).container.fs.writeFile('src/App.tsx', `export default function App() { return <h1>Edited via API</h1> }\n`),
    )
    await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Edited via API' })).toBeVisible()
  })

  test('preview hides its URL prefix from the app; pushState + reload keep working', async () => {
    await page.evaluate(() =>
      (window as unknown as Win).container.fs.writeFile(
        'src/App.tsx',
        `export default function App() {\n  return <><h1>path:{location.pathname}</h1><button onClick={() => history.pushState(null, '', '/deep/link')}>go</button></>\n}\n`,
      ),
    )
    const frame = page.frameLocator('#frame')
    await expect(frame.getByRole('heading', { name: 'path:/' })).toBeVisible()
    await frame.getByRole('button', { name: 'go' }).click()
    // live reload while on a client-side route keeps the route
    await page.evaluate(() => (window as unknown as Win).container.fs.writeFile('src/App.tsx', `export default function App() { return <h1>route:{location.pathname}</h1> }\n`))
    await expect(frame.getByRole('heading', { name: 'route:/deep/link' })).toBeVisible()
  })

  test('syntax errors show an overlay, fixing them recovers', async () => {
    await page.evaluate(() => (window as unknown as Win).container.fs.writeFile('src/App.tsx', `export default function App() { return <h1>broken</h1 }\n`))
    await expect(page.frameLocator('#frame').locator('clover-error-overlay pre')).toContainText('App.tsx')
    await page.evaluate(() => (window as unknown as Win).container.fs.writeFile('src/App.tsx', `export default function App() { return <h1>Fixed</h1> }\n`))
    await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Fixed' })).toBeVisible()
  })

  test('c.build() writes a production bundle; `vite preview` serves it', async () => {
    const files = await page.evaluate(async () => (await (window as unknown as Win).container.build()).files)
    expect(files).toContain('/home/project/dist/index.html')
    expect(files.some((f) => /\/dist\/assets\/main-[\w]+\.js$/.test(f))).toBe(true)
    expect(files.some((f) => /\/dist\/assets\/main-[\w]+\.css$/.test(f))).toBe(true)
    const html = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('dist/index.html', 'utf8'))
    expect(html).toMatch(/<script crossorigin type="module" src="\/assets\/main-\w+\.js"><\/script>/)

    const { code, out } = await sh(page, 'npm run build')
    expect(out).toContain('tsc: type-checking is skipped')
    expect(out).toContain('built in')
    expect(code).toBe(0)

    const url = await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      const ready = new Promise<string>((res) => c.on('server-ready', (port, u) => port === 4173 && res(u)))
      const p = await c.spawn('npx', ['vite', 'preview', '--port', '4173'])
      p.output.pipeTo(new WritableStream())
      return ready
    })
    const prod = await page.context().newPage()
    await prod.goto(url)
    await expect(prod.getByRole('heading', { name: 'Fixed' })).toBeVisible()
    await prod.close()
  })

  test('jsh: pipes, redirects, env, operators', async () => {
    const r = await sh(page, `echo "x=$HOME" > /tmp/o.txt && echo more >> /tmp/o.txt; cat /tmp/o.txt | grep -c x; FOO=bar env | grep FOO; false || echo recovered; cd src && pwd; nope`)
    expect(r.out).toBe('1\nFOO=bar\nrecovered\n/home/project/src\njsh: command not found: nope\n')
    expect(r.code).toBe(127)
  })

  test('node: CJS/ESM/TS, top-level await, http server via preview URL', async () => {
    await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      await c.fs.writeFile('scripts/tla.mts', `import { readFile } from 'node:fs/promises'\nconst pkg = JSON.parse(await readFile('package.json', 'utf8'))\nconst n: number = 2\nconsole.log('tla', pkg.name, n)\n`)
      await c.fs.writeFile('server.cjs', `const http = require('http')\nhttp.createServer((req, res) => { res.writeHead(200, {'content-type':'text/plain'}); res.end('node says ' + req.method + ' ' + req.url) }).listen(3005, () => console.log('up'))\n`)
    })
    const r = await sh(page, 'node scripts/tla.mts && node -p "require(\'react\').version.split(\'.\')[0] >= 18"')
    expect(r.out).toBe('tla demo-app 2\ntrue\n')
    const body = await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      const ready = new Promise<string>((res) => c.on('server-ready', (port, url) => port === 3005 && res(url)))
      const p = await c.spawn('node', ['server.cjs'])
      p.output.pipeTo(new WritableStream())
      const url = await ready
      const text = await (await fetch(url + 'ping?q=1')).text()
      p.kill()
      return text + ' / exit ' + (await p.exit)
    })
    expect(body).toBe('node says GET /ping?q=1 / exit 130')
  })

  test('c.bundle() bundles server code over the VFS', async () => {
    const out = await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      await c.fs.writeFile('server/index.ts', `import { join } from 'node:path'\nimport { greet } from './greet'\nexport default { fetch: () => new Response(greet(join('a', 'b'))) }\n`)
      await c.fs.writeFile('server/greet.ts', `export const greet = (s: string): string => 'hi ' + s\n`)
      const r = await c.bundle({ entryPoints: ['server/index.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: 'server.js' })
      return r.outputFiles.map((f) => f.text).join('')
    })
    expect(out).toContain('from "node:path"')
    expect(out).toContain('"hi " + s')
  })

  test('export() honours excludes; registerCommand plugs into jsh', async () => {
    const keys = await page.evaluate(async () => Object.keys(await (window as unknown as Win).container.export('.', { excludes: ['node_modules/**', 'dist/**'] })))
    expect(keys).toContain('src')
    expect(keys).not.toContain('node_modules')
    expect(keys).not.toContain('dist')
    await page.evaluate(() =>
      (window as unknown as Win).container.registerCommand('clover', async (ctx) => {
        ctx.stdout.write(`clover ${ctx.args.join(' ')} in ${ctx.cwd}\n`)
        return 3
      }),
    )
    const r = await sh(page, 'cd src && clover deploy --prod')
    expect(r).toEqual({ code: 3, out: 'clover deploy --prod in /home/project/src\n' })
  })

  test('interactive jsh: Ctrl+C stops the foreground dev server and returns to the prompt', async () => {
    const closed = page.evaluate(
      () => new Promise<number>((res) => (window as unknown as Win).container.on('port', (port, type) => type === 'close' && res(port))),
    )
    await page.evaluate(() => (window as unknown as { shellInput: WritableStreamDefaultWriter<string> }).shellInput.write('\x03'))
    expect(await closed).toBe(5173)
    await page.evaluate(() => (window as unknown as { shellInput: WritableStreamDefaultWriter<string> }).shellInput.write('echo after-ctrl-c\r'))
    await expect(page.locator('.xterm-rows')).toContainText('after-ctrl-c')
  })
})
