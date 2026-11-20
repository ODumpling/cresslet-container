import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; __marker?: number }

// CSS processing: Tailwind CSS v4 and PostCSS configs, with packages installed from the registry like a real project.

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

/** Boot a container on a blank page, mount `files`, `npm install`, start the dev server in #frame. */
async function boot(page: Page, files: Record<string, string>): Promise<Frame> {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto('/demo/blank.html')
  const out = await page.evaluate(async (files) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot()
    ;(window as unknown as Win).container = c
    for (const [p, s] of Object.entries(files)) await c.fs.writeFile(p, s)
    const p = await c.spawn('npm', ['install'])
    let out = ''
    await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    if (code) return out
    const server = await c.createDevServer()
    const f = document.createElement('iframe')
    f.id = 'frame'
    f.style.cssText = 'width:800px;height:600px'
    f.src = server.url
    document.body.append(f)
    return ''
  }, files)
  expect(out).toBe('')
  // the preview strips its /__cresslet__/ prefix from the URL; wait for the app's document instead
  await expect.poll(async () => (await (await page.$('#frame'))?.contentFrame())?.evaluate(() => !!document.querySelector('script[src="/@cresslet/client"]')).catch(() => false), { timeout: 60_000 }).toBe(true)
  return (await (await page.$('#frame'))!.contentFrame())!
}

const app = (cls: string) => `export default function App() {
  return (
    <main>
      <h1 className="${cls}">Tailwind works</h1>
    </main>
  )
}
`

test.describe.serial('Tailwind CSS v4', () => {
  let page: Page
  let frame: Frame
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    frame = await boot(page, {
      'package.json': JSON.stringify({ name: 'tw', private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, devDependencies: { tailwindcss: '^4.1.0' } }),
      'index.html': '<!doctype html>\n<html><head><meta charset="utf-8" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
      'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n",
      'src/App.tsx': app('text-brand font-bold p-4'),
      'src/index.css': '@import "tailwindcss";\n\n@theme {\n  --color-brand: rgb(10, 120, 30);\n}\n',
    })
  })

  test('utility classes and @theme values apply', async () => {
    const h1 = page.frameLocator('#frame').getByRole('heading', { name: 'Tailwind works' })
    await expect(h1).toHaveCSS('color', 'rgb(10, 120, 30)', { timeout: 120_000 })
    await expect(h1).toHaveCSS('font-weight', '700')
    await expect(h1).toHaveCSS('padding-top', '16px')
    // preflight ran: h1 margins reset
    await expect(h1).toHaveCSS('margin-top', '0px')
  })

  test('adding a class in a component hot-updates the stylesheet without a reload', async () => {
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
    const h1 = page.frameLocator('#frame').getByRole('heading', { name: 'Tailwind works' })
    await expect(h1).not.toHaveCSS('text-decoration-line', 'underline')
    await write(page, 'src/App.tsx', app('text-brand font-bold p-4 underline tracking-[0.25em]'))
    await expect(h1).toHaveCSS('text-decoration-line', 'underline')
    await expect(h1).toHaveCSS('letter-spacing', '4px') // 0.25em of 16px (preflight: h1 font-size inherits)
    expect(await frame.evaluate(() => (window as unknown as Win).__marker)).toBe(1)
  })

  test('editing the stylesheet (@theme) hot-swaps it', async () => {
    const h1 = page.frameLocator('#frame').getByRole('heading', { name: 'Tailwind works' })
    await write(page, 'src/index.css', '@import "tailwindcss";\n\n@theme {\n  --color-brand: rgb(200, 0, 0);\n}\n')
    await expect(h1).toHaveCSS('color', 'rgb(200, 0, 0)')
    expect(await frame.evaluate(() => (window as unknown as Win).__marker)).toBe(1)
  })

  test('a class added to index.html applies after the full reload', async () => {
    await write(page, 'index.html', '<!doctype html>\n<html><head><meta charset="utf-8" /></head><body><p id="from-html" class="italic">html</p><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n')
    await expect(page.frameLocator('#frame').locator('#from-html')).toHaveCSS('font-style', 'italic')
  })

  test('c.build() emits the same Tailwind CSS', async () => {
    const out = await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      const { files } = await c.build()
      const css = files.filter((f) => f.endsWith('.css'))
      return { css: await Promise.all(css.map((f) => c.fs.readFile(f, 'utf8'))), html: await c.fs.readFile('dist/index.html', 'utf8') }
    })
    expect(out.css).toHaveLength(1)
    const css = out.css[0]
    expect(css).not.toContain('@import')
    for (const sel of ['.text-brand', '.font-bold', '.p-4', '.underline', '.tracking-\\[0\\.25em\\]']) expect(css).toContain(sel)
    expect(css).toContain('--color-brand:')
    expect(css).not.toContain('.text-red-500')
    expect(out.html).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/[^"]+\.css">/)
  })
})

test.describe.serial('PostCSS config', () => {
  let page: Page
  let frame: Frame
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    frame = await boot(page, {
      'package.json': JSON.stringify({ name: 'pc', private: true, type: 'module', devDependencies: { postcss: '^8.4.0', autoprefixer: '^10.4.0' } }),
      'postcss.config.js': "export default {\n  plugins: {\n    autoprefixer: { overrideBrowserslist: ['safari 8'] },\n  },\n}\n",
      'index.html': '<!doctype html>\n<html><head><meta charset="utf-8" /><link rel="stylesheet" href="/src/style.css" /></head><body><div class="box">box</div><script type="module" src="/src/main.js"></script></body></html>\n',
      'src/main.js': "import './extra.css'\n",
      'src/style.css': '.box { display: flex; color: rgb(0, 0, 200); }\n',
      'src/extra.css': '.box { user-select: none; }\n',
    })
  })

  test('autoprefixer applies to <link> and imported stylesheets', async () => {
    await expect(page.frameLocator('#frame').getByText('box')).toHaveCSS('color', 'rgb(0, 0, 200)', { timeout: 120_000 })
    const linked = await frame.evaluate(() => fetch('/src/style.css').then((r) => r.text()))
    expect(linked).toContain('display: -webkit-flex')
    await expect.poll(() => frame.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'))).toContain('-webkit-user-select: none')
  })

  test('build output is prefixed too', async () => {
    const css = await page.evaluate(async () => {
      const c = (window as unknown as Win).container
      const { files } = await c.build()
      return Promise.all(files.filter((f) => f.endsWith('.css')).map((f) => c.fs.readFile(f, 'utf8')))
    })
    expect(css.join('\n')).toContain('display:-webkit-flex')
  })

  test('a plugin that cannot load shows its error in the overlay', async () => {
    await write(page, 'postcss.config.js', "export default {\n  plugins: { 'postcss-not-installed': {} },\n}\n")
    const f = page.frameLocator('#frame')
    await expect(f.locator('cresslet-error-overlay pre')).toContainText("PostCSS plugin 'postcss-not-installed' can't be loaded")
  })
})

test.describe.serial('Tailwind CSS v3 through PostCSS', () => {
  let page: Page
  let frame: Frame
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    frame = await boot(page, {
      'package.json': JSON.stringify({ name: 'tw3', private: true, type: 'module', dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' }, devDependencies: { tailwindcss: '^3.4.0', postcss: '^8.4.0', autoprefixer: '^10.4.0' } }),
      'postcss.config.js': 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n',
      'tailwind.config.ts': "export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: { colors: { brand: 'rgb(10, 120, 30)' } } } }\n",
      'index.html': '<!doctype html>\n<html><head><meta charset="utf-8" /></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx' } }),
      'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport App from './App'\nimport './index.css'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n",
      'src/App.tsx': app('text-brand font-bold'),
      'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    })
  })

  test('renders, and a new class in a component hot-updates the stylesheet', async () => {
    const h1 = page.frameLocator('#frame').getByRole('heading', { name: 'Tailwind works' })
    await expect(h1).toHaveCSS('color', 'rgb(10, 120, 30)', { timeout: 120_000 })
    await expect(h1).toHaveCSS('font-weight', '700')
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
    await write(page, 'src/App.tsx', app('text-brand font-bold underline'))
    await expect(h1).toHaveCSS('text-decoration-line', 'underline')
    expect(await frame.evaluate(() => (window as unknown as Win).__marker)).toBe(1)
  })
})
