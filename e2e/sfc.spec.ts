import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; __marker?: number }

// Vue and Svelte single-file components beyond the basics (hot-api.spec.ts): style @imports, CSS modules, src= blocks,
// imported prop types, PostCSS on SFC styles, Sass in Svelte, .svelte.ts rune modules; then a production build
// (`npm run build`, served by `vite preview`). Real packages from the registry.

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

/** Boot a container on a blank page, mount `files`, `npm install`, start the dev server in #frame. */
async function boot(page: Page, files: Record<string, string>): Promise<void> {
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack))
  await page.goto('/demo/blank.html')
  const out = await page.evaluate(async (files) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot()
    ;(window as unknown as Win).container = c
    for (const [p, s] of Object.entries(files)) await c.fs.writeFile(p, s)
    const p = await c.spawn('npm', ['install'])
    let out = ''
    await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    if (await p.exit) return out
    const server = await c.createDevServer()
    const f = document.createElement('iframe')
    f.id = 'frame'
    f.style.cssText = 'width:800px;height:600px'
    f.src = server.url
    document.body.append(f)
    return ''
  }, files)
  expect(out).toBe('')
}

const frame = async (page: Page): Promise<Frame> => (await (await page.$('#frame'))!.contentFrame())!
/** Mark the preview's current window: `marked()` stays true until it reloads. */
const mark = async (page: Page) => {
  const f = await frame(page)
  await f.evaluate(() => void ((window as unknown as Win).__marker = 1))
  return () => f.evaluate(() => (window as unknown as Win).__marker === 1).catch(() => false)
}

/** `npm run build`, then `vite preview`: a page on the built app. */
async function buildAndPreview(page: Page): Promise<{ prod: Page; css: string }> {
  const r = await page.evaluate(async () => {
    const c = (window as unknown as Win).container
    const p = await c.spawn('npm', ['run', 'build'])
    let out = ''
    await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    if (code) return { out, url: '', css: '' }
    const files = await c.fs.readdir('dist/assets')
    const css = (await Promise.all(files.filter((f) => f.endsWith('.css')).map((f) => c.fs.readFile(`dist/assets/${f}`, 'utf8')))).join('\n')
    const ready = new Promise<string>((res) => c.on('server-ready', (port, u) => port === 4173 && res(u)))
    const pv = await c.spawn('npx', ['vite', 'preview', '--port', '4173'])
    pv.output.pipeTo(new WritableStream())
    return { out, url: await ready, css }
  })
  expect(r.out).toContain('built in')
  const prod = await page.context().newPage()
  prod.on('pageerror', (e) => console.log('[prod pageerror]', e.stack))
  await prod.goto(r.url)
  return { prod, css: r.css }
}

const html = '<!doctype html>\n<html><head><meta charset="utf-8" /></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n'

test.describe.serial('Vue SFC features', () => {
  let page: Page
  let marked: () => Promise<boolean>
  const card = (styles: string) => `<script setup lang="ts">
import type { CardProps } from './types'
defineProps<CardProps>()
</script>

<template src="./card.html"></template>

<style scoped>
@import './theme.css';
.card { display: flex; user-select: none; }
</style>

<style module>
.big { font-weight: 700; }
</style>
${styles}`
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'vue-sfc', private: true, type: 'module', scripts: { build: 'vite build' }, dependencies: { vue: '^3.5.0', 'modern-normalize': '^3.0.0' }, devDependencies: { postcss: '^8.4.0', autoprefixer: '^10.4.0' } }),
      'postcss.config.js': "export default {\n  plugins: {\n    autoprefixer: { overrideBrowserslist: ['safari 8'] },\n  },\n}\n",
      'index.html': html,
      'src/main.ts': "import { createApp } from 'vue'\nimport App from './App.vue'\n\ncreateApp(App).mount('#app')\n",
      // a bare package @import, in an unscoped block
      'src/App.vue': `<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import Card from './Card.vue'
const Lazy = defineAsyncComponent(() => import('./Lazy.vue'))
const count = ref(0)
</script>

<template>
  <h1>Vue app</h1>
  <p class="theme" id="outside">outside the card</p>
  <Card msg="card" :count="count" />
  <button @click="count++">count is {{ count }}</button>
  <Lazy />
</template>

<style>
@import "modern-normalize";
h1 { color: rgb(0, 0, 160); filter: url(#none); }
.card { padding-top: 7px; background-image: url(/src/dot.svg); }
</style>
`,
      'src/Card.vue': card(''),
      // a lazily loaded component: its CSS is in a chunk of its own
      'src/Lazy.vue': '<template><p id="lazy">lazy</p></template>\n<style scoped>\np { color: rgb(120, 0, 120); }\n</style>\n',
      'src/card.html': '<div class="card"><p class="theme" id="inside" :class="$style.big">{{ msg }} {{ count }}</p></div>\n',
      'src/theme.css': '.theme { color: rgb(0, 128, 0); }\n',
      'src/dot.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>\n',
      'src/types.ts': 'export interface CardProps {\n  msg: string\n  count: number\n}\n',
    })
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('heading', { name: 'Vue app' })).toBeVisible({ timeout: 120_000 })
    marked = await mark(page)
    await f.getByRole('button', { name: 'count is 0' }).click()
    await expect(f.locator('#inside')).toHaveText('card 1')
  })

  test('a scoped style scopes the sheet it @imports; <style module>, src= template, imported prop types', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.locator('#inside')).toHaveCSS('color', 'rgb(0, 128, 0)')
    await expect(f.locator('#outside')).toHaveCSS('color', 'rgb(0, 0, 0)') // the imported rule is scoped to the card
    await expect(f.locator('#inside')).toHaveCSS('font-weight', '700')
    await expect(f.locator('h1')).toHaveCSS('color', 'rgb(0, 0, 160)')
    await expect(f.locator('#lazy')).toHaveCSS('color', 'rgb(120, 0, 120)')
  })

  test('a bare package @import resolves to the package (modern-normalize), not the page URL', async () => {
    await expect(page.frameLocator('#frame').locator('html')).toHaveCSS('tab-size', '4')
  })

  test('SFC styles go through the project PostCSS config (autoprefixer)', async () => {
    const f = await frame(page)
    await expect.poll(() => f.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n'))).toContain('display: -webkit-flex')
  })

  test('editing the @imported sheet hot-updates the component (no reload, state kept)', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/theme.css', '.theme { color: rgb(200, 0, 0); }\n')
    await expect(f.locator('#inside')).toHaveCSS('color', 'rgb(200, 0, 0)')
    await expect(f.locator('#inside')).toHaveText('card 1')
    expect(await marked()).toBe(true)
  })

  test('a <style> block added during HMR goes next to the component’s other sheets', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/Card.vue', card('\n<style>\n.card { outline: 3px solid rgb(1, 2, 3); padding-top: 3px; }\n</style>\n'))
    await expect(f.locator('.card')).toHaveCSS('outline-color', 'rgb(1, 2, 3)')
    await expect(f.locator('.card')).toHaveCSS('padding-top', '7px') // the parent's rule still comes after the child's
    const order = await (await frame(page)).evaluate(() => [...document.head.querySelectorAll('style[data-cresslet-id]')].map((s) => s.getAttribute('data-cresslet-id')))
    const own = order.find((id, i) => order.indexOf(id) === i && order.filter((x) => x === id).length === 3)! // its three blocks
    const at = order.map((id, i) => (id === own ? i : -1)).filter((i) => i >= 0)
    expect(at[2] - at[0]).toBe(2) // contiguous
    expect(order.length).toBeGreaterThan(3) // (App's sheet is there too)
    expect(await marked()).toBe(true)
  })

  test('vite build compiles the components; the built app renders with its styles and runs', async () => {
    const { prod, css } = await buildAndPreview(page)
    try {
      await expect(prod.getByRole('heading', { name: 'Vue app' })).toBeVisible()
      await expect(prod.locator('#inside')).toHaveCSS('color', 'rgb(200, 0, 0)')
      await expect(prod.locator('#outside')).toHaveCSS('color', 'rgb(0, 0, 0)')
      await expect(prod.locator('#inside')).toHaveCSS('font-weight', '700')
      await expect(prod.locator('.card')).toHaveCSS('outline-color', 'rgb(1, 2, 3)')
      await expect(prod.locator('.card')).toHaveCSS('padding-top', '7px') // child components' CSS first, as in dev
      await expect(prod.locator('html')).toHaveCSS('tab-size', '4')
      await expect(prod.locator('#lazy')).toHaveCSS('color', 'rgb(120, 0, 120)')
      await prod.getByRole('button', { name: 'count is 0' }).click()
      await expect(prod.locator('#inside')).toHaveText('card 1')
      expect(css).toContain('display:-webkit-flex')
      expect(css).toMatch(/\.theme\[data-v-\w+\]/)
      expect(css).not.toContain('@import')
      expect(css).toContain('url(#none)') // a fragment, left as written
      expect(css).toMatch(/url\("?\/assets\/dot-\w+\.svg"?\)/) // a root-relative project file, bundled
    } finally {
      await prod.close()
    }
  })
})

test.describe.serial('Svelte features', () => {
  let page: Page
  let marked: () => Promise<boolean>
  const app = (color: string) => `<script lang="ts">
  import { counter, inc } from './counter.svelte.js'
</script>

<button onclick={inc}>clicks: {counter.n}</button>
<p class="s">styled</p>

<style lang="scss">
  $c: ${color};
  .s { color: $c; }
</style>
`
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'svelte-sfc', private: true, type: 'module', scripts: { build: 'vite build' }, dependencies: { svelte: '^5.0.0' }, devDependencies: { sass: '^1.80.0' } }),
      'index.html': html,
      'src/main.ts': "import { mount } from 'svelte'\nimport App from './App.svelte'\n\nmount(App, { target: document.getElementById('app')! })\n",
      'src/App.svelte': app('rgb(0, 0, 200)'),
      // a rune module in TypeScript
      'src/counter.svelte.ts': 'export const counter: { n: number } = $state({ n: 0 })\nexport function inc(): void {\n  counter.n++\n}\n',
    })
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('button', { name: 'clicks: 0' })).toBeVisible({ timeout: 120_000 })
    marked = await mark(page)
  })

  test('<style lang="scss"> compiles; a .svelte.ts rune module holds shared state', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.locator('.s')).toHaveCSS('color', 'rgb(0, 0, 200)')
    await f.getByRole('button', { name: 'clicks: 0' }).click()
    await expect(f.getByRole('button', { name: 'clicks: 1' })).toBeVisible()
  })

  test('editing the Sass style hot-updates (no reload)', async () => {
    await write(page, 'src/App.svelte', app('rgb(0, 150, 0)'))
    await expect(page.frameLocator('#frame').locator('.s')).toHaveCSS('color', 'rgb(0, 150, 0)')
    expect(await marked()).toBe(true)
  })

  test('vite build compiles the components and rune modules; the built app renders and runs', async () => {
    // a component library exposing its .svelte sources through the `svelte` export condition (the dev server's
    // pre-bundling doesn't compile those: this is for the build only)
    await write(page, 'node_modules/ui/package.json', JSON.stringify({ name: 'ui', version: '1.0.0', type: 'module', exports: { '.': { svelte: './src/index.js', default: './dist/index.js' } } }))
    await write(page, 'node_modules/ui/dist/index.js', "throw new Error('the svelte export condition was not used')\n")
    await write(page, 'node_modules/ui/src/index.js', "export { default as Badge } from './Badge.svelte'\n")
    await write(page, 'node_modules/ui/src/Badge.svelte', '<span class="badge">from ui</span>\n<style>.badge { color: rgb(150, 0, 150); }</style>\n')
    await write(page, 'src/App.svelte', app('rgb(0, 150, 0)').replace("</script>", "  import { Badge } from 'ui'\n</script>\n<Badge />"))
    const { prod, css } = await buildAndPreview(page)
    try {
      await expect(prod.locator('.badge')).toHaveCSS('color', 'rgb(150, 0, 150)')
      await expect(prod.locator('.s')).toHaveCSS('color', 'rgb(0, 150, 0)')
      await prod.getByRole('button', { name: 'clicks: 0' }).click()
      await expect(prod.getByRole('button', { name: 'clicks: 1' })).toBeVisible()
      expect(css).toMatch(/\.s\.svelte-\w+\{color:#009600\}|\.s\.svelte-\w+\{color:rgb\(0,150,0\)\}/)
    } finally {
      await prod.close()
    }
  })
})
