import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; __marker?: number }

// `import.meta.hot` (accept, dispose, data, invalidate) and the HMR built on it: Preact (prefresh), Vue SFCs and
// Svelte 5, each a project installed from the registry. A marker on the preview's window proves "no reload".

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

/** Boot a container on a blank page, mount `files`, `npm install` (if there are deps), start the dev server in #frame. */
async function boot(page: Page, files: Record<string, string>): Promise<Frame> {
  page.on('pageerror', (e) => console.log('[pageerror]', e.stack))
  await page.goto('/demo/blank.html')
  const out = await page.evaluate(async (files) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot()
    ;(window as unknown as Win).container = c
    for (const [p, s] of Object.entries(files)) await c.fs.writeFile(p, s)
    if (JSON.parse(files['package.json']).dependencies) {
      const p = await c.spawn('npm', ['install'])
      let out = ''
      await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
      if (await p.exit) return out
    }
    const server = await c.createDevServer()
    const f = document.createElement('iframe')
    f.id = 'frame'
    f.style.cssText = 'width:800px;height:600px'
    f.src = server.url
    document.body.append(f)
    return ''
  }, files)
  expect(out).toBe('')
  await expect.poll(async () => (await (await page.$('#frame'))?.contentFrame())?.evaluate(() => !!document.querySelector('script[src="/@cresslet/client"]')).catch(() => false), { timeout: 60_000 }).toBe(true)
  return (await (await page.$('#frame'))!.contentFrame())!
}

/** Mark the preview's current window (call once the app is up: a dependency re-optimization reloads it before that). */
const mark = async (page: Page) => {
  const frame = (await (await page.$('#frame'))!.contentFrame())!
  await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
  return () => frame.evaluate(() => (window as unknown as Win).__marker === 1).catch(() => false)
}

const html = (entry: string, body = '<div id="app"></div>') => `<!doctype html>\n<html><head><meta charset="utf-8" /></head><body>${body}<script type="module" src="${entry}"></script></body></html>\n`

test.describe.serial('import.meta.hot API', () => {
  let page: Page
  let marked: () => Promise<boolean>
  // also imports msg.js: an edit of msg re-runs it in the same batch that hands msg to its acceptors
  const counter = (label: string) => `import './msg.js'
const state = import.meta.hot.data.state ?? { n: 0 }
const runs = (import.meta.hot.data.runs ?? 0) + 1
const el = document.getElementById('counter')
el.textContent = '${label} n=' + state.n + ' runs=' + runs
el.onclick = () => { state.n++; el.textContent = '${label} n=' + state.n + ' runs=' + runs }
import.meta.hot.dispose((data) => { data.state = state; data.runs = runs })
import.meta.hot.accept()
`
  const mid = (tag: string) => `import { value } from './inv'\ndocument.getElementById('mid').textContent = '${tag} ' + value\nimport.meta.hot.accept()\n`
  // the callback that runs is the current (old) copy's, with the new module
  const inv = (value: string) => `export const value = '${value}'\nimport.meta.hot.accept((m) => { if (m.value.startsWith('reject')) import.meta.hot.invalidate('cannot apply') })\n`
  // accepted by two importers: disposed and re-run once per edit
  const msg = (text: string) => `const runs = (import.meta.hot.data.runs ?? 0) + 1\nimport.meta.hot.dispose((d) => { d.runs = runs; window.msgDisposed = (window.msgDisposed ?? 0) + 1 })\nexport const msg = '${text} run ' + runs\n`

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'hot', private: true, type: 'module' }),
      'index.html': html('/src/main.js', '<button id="counter"></button><p id="msg"></p><p id="msg2"></p><p id="data"></p><p id="mid"></p><p id="depc"></p>'),
      // the entry accepts its dep (extensionless specifier): it isn't re-run, the callback gets the new module
      'src/main.js': "import './counter.js'\nimport './mid.js'\nimport './other.js'\nimport './dep-c.js'\nimport { msg } from './msg'\nwindow.mainRuns = (window.mainRuns ?? 0) + 1\ndocument.getElementById('msg').textContent = msg\nimport.meta.hot.accept('./msg', (m) => { document.getElementById('msg').textContent = 'accepted ' + m.msg })\n",
      'src/msg.js': msg('msg v1'),
      'src/other.js': "import { msg } from './msg.js'\nimport data from './data.json'\ndocument.getElementById('msg2').textContent = msg\ndocument.getElementById('data').textContent = data.v\nimport.meta.hot.accept(['./msg.js'], ([m]) => { document.getElementById('msg2').textContent = 'other ' + m.msg })\nimport.meta.hot.accept('./data.json', (m) => { document.getElementById('data').textContent = 'accepted ' + m.default.v })\n",
      'src/data.json': '{ "v": "data v1" }\n',
      // B accepts A but can't apply it: it invalidates, so B is updated as if it had changed (C, above it, re-runs)
      'src/dep-a.js': "export const a = 'a v1'\n",
      'src/dep-b.js': "import { a } from './dep-a.js'\nexport const b = 'b(' + a + ')'\nimport.meta.hot.accept('./dep-a.js', () => import.meta.hot.invalidate())\n",
      'src/dep-c.js': "import { b } from './dep-b.js'\ndocument.getElementById('depc').textContent = 'c(' + b + ')'\nimport.meta.hot.accept()\n",
      // invalidates on every run: only one during an update counts (no reload loop)
      'src/eager.js': "window.eagerRuns = (window.eagerRuns ?? 0) + 1\nimport.meta.hot.accept()\nimport.meta.hot.invalidate()\n",
      'src/counter.js': counter('v1'),
      'src/mid.js': mid('mid v1'),
      'src/inv.js': inv('inv v1'),
    })
    const f = page.frameLocator('#frame')
    await expect(f.locator('#counter')).toHaveText('v1 n=0 runs=1', { timeout: 120_000 })
    marked = await mark(page)
    await f.locator('#counter').click()
    await f.locator('#counter').click()
    await expect(f.locator('#counter')).toHaveText('v1 n=2 runs=1')
  })

  test('a self-accepting module re-runs; dispose hands state to the new copy through hot.data', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/counter.js', counter('v2'))
    await expect(f.locator('#counter')).toHaveText('v2 n=2 runs=2')
    await f.locator('#counter').click()
    await expect(f.locator('#counter')).toHaveText('v2 n=3 runs=2')
    expect(await marked()).toBe(true)
  })

  test('accept(dep, cb): the importer gets the new module and is not re-run', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/msg.js', msg('msg v2'))
    await expect(f.locator('#msg')).toHaveText('accepted msg v2 run 2')
    await expect(f.locator('#msg2')).toHaveText('other msg v2 run 2') // two importers, one new copy
    type W = { mainRuns: number; msgDisposed: number }
    expect(await f.locator('body').evaluate(() => [(window as unknown as W).mainRuns, (window as unknown as W).msgDisposed])).toEqual([1, 1])
    await expect(f.locator('#counter')).toHaveText('v2 n=3 runs=3') // re-ran as msg's importer (keeps its state)
    expect(await marked()).toBe(true)
  })

  test('an accepted JSON import is re-imported as a module (with the flags it is served with)', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.locator('#data')).toHaveText('data v1')
    await write(page, 'src/data.json', '{ "v": "data v2" }\n')
    await expect(f.locator('#data')).toHaveText('accepted data v2')
    expect(await marked()).toBe(true)
  })

  test('invalidate() updates the importers instead', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.locator('#mid')).toHaveText('mid v1 inv v1')
    // accepted in place: the importer keeps its old binding
    await write(page, 'src/inv.js', inv('inv v2'))
    await page.waitForTimeout(500)
    await expect(f.locator('#mid')).toHaveText('mid v1 inv v1')
    // invalidated: the self-accepting importer re-runs with the new value
    await write(page, 'src/inv.js', inv('reject v3'))
    await expect(f.locator('#mid')).toHaveText('mid v1 reject v3')
    expect(await marked()).toBe(true)
  })

  test('invalidate() from a module that accepted a dep updates it as changed', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.locator('#depc')).toHaveText('c(b(a v1))')
    await write(page, 'src/dep-a.js', "export const a = 'a v2'\n")
    await expect(f.locator('#depc')).toHaveText('c(b(a v2))')
    expect(await marked()).toBe(true)
  })

  test('a change no module accepts still reloads the page', async () => {
    await write(page, 'src/main.js', "import './counter.js'\nimport './eager.js'\ndocument.getElementById('msg').textContent = 'main v2'\n")
    await expect.poll(marked).toBe(false)
    await expect(page.frameLocator('#frame').locator('#msg')).toHaveText('main v2')
  })

  test('invalidate() outside an update is ignored; during one, once (no reload loop)', async () => {
    const f = page.frameLocator('#frame')
    marked = await mark(page)
    await page.waitForTimeout(500)
    expect(await marked()).toBe(true) // eager.js invalidated on load: ignored
    await write(page, 'src/eager.js', "window.eagerRuns = (window.eagerRuns ?? 0) + 1\nwindow.eagerV = 2\nimport.meta.hot.accept()\nimport.meta.hot.invalidate()\n")
    await expect.poll(marked).toBe(false) // its importer is the entry: reload
    await expect.poll(() => f.locator('body').evaluate(() => (window as unknown as { eagerV?: number }).eagerV)).toBe(2)
    marked = await mark(page)
    await page.waitForTimeout(1000)
    expect(await marked()).toBe(true)
  })
})

test.describe.serial('Preact (prefresh)', () => {
  let page: Page
  let marked: () => Promise<boolean>
  const app = (heading: string, extraHook = '') => `import { useState } from 'preact/hooks'

export default function App() {
${extraHook}  const [count, setCount] = useState(0)
  return (
    <main>
      <h1>${heading}</h1>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
    </main>
  )
}
`
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'pre', private: true, type: 'module', dependencies: { preact: '^10.26.0' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' } }),
      'index.html': html('/src/main.tsx'),
      'src/main.tsx': "import { render } from 'preact'\nimport App from './App'\n\nrender(<App />, document.getElementById('app')!)\n",
      'src/App.tsx': app('Preact v1'),
    })
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('heading', { name: 'Preact v1' })).toBeVisible({ timeout: 120_000 })
    marked = await mark(page)
    await f.getByRole('button', { name: 'count is 0' }).click()
    await f.getByRole('button', { name: 'count is 1' }).click()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
  })

  test('a component edit is hot-swapped and keeps state', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', app('Preact v2'))
    await expect(f.getByRole('heading', { name: 'Preact v2' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('changing the hooks of a component resets its state (still no reload)', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', app('Preact v3', "  const [label] = useState('x')\n"))
    await expect(f.getByRole('heading', { name: 'Preact v3' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('renaming the default export (another component) falls back to a full reload', async () => {
    await write(page, 'src/App.tsx', app('Renamed').replace('function App()', 'function Main()'))
    await expect.poll(marked).toBe(false)
    await expect(page.frameLocator('#frame').getByRole('heading', { name: 'Renamed' })).toBeVisible()
  })
})

test.describe.serial('Vue SFC', () => {
  let page: Page
  let marked: () => Promise<boolean>
  const sfc = (heading: string, color: string | null = 'rgb(0, 120, 0)', script = '') => `<script setup lang="ts">
import { ref } from 'vue'
import { label } from './label'
import Child from './Child.vue'
const count = ref<number>(0)${script}
</script>

<template>
  <h1>${heading}</h1>
  <p>{{ label }}</p>
  <Child />
  <button @click="count++">count is {{ count }}</button>
</template>
${color ? `\n<style scoped>\nh1 { color: ${color}; }\n</style>\n` : ''}`
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'vue', private: true, type: 'module', dependencies: { vue: '^3.5.0' } }),
      'index.html': html('/src/main.ts'),
      'src/main.ts': "import { createApp } from 'vue'\nimport App from './App.vue'\n\ncreateApp(App).mount('#app')\n",
      'src/App.vue': sfc('Vue v1'),
      'src/label.ts': "export const label = 'label v1'\n",
      'src/Child.vue': '<template><p>child v1</p></template>\n',
    })
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('heading', { name: 'Vue v1' })).toBeVisible({ timeout: 120_000 })
    marked = await mark(page)
    await f.getByRole('button', { name: 'count is 0' }).click()
    await f.getByRole('button', { name: 'count is 1' }).click()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
  })

  test('scoped styles apply', async () => {
    await expect(page.frameLocator('#frame').getByRole('heading')).toHaveCSS('color', 'rgb(0, 120, 0)')
  })

  test('a template edit re-renders in place and keeps state', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.vue', sfc('Vue v2'))
    await expect(f.getByRole('heading', { name: 'Vue v2' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('a style edit applies and keeps state', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.vue', sfc('Vue v2', 'rgb(200, 0, 0)'))
    await expect(f.getByRole('heading')).toHaveCSS('color', 'rgb(200, 0, 0)')
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('a script edit reloads the component (state reset, still no page reload)', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.vue', sfc('Vue v3', 'rgb(200, 0, 0)', "\nconst unused = 'x'"))
    await expect(f.getByRole('heading', { name: 'Vue v3' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('editing a module the script imports reloads the component with it', async () => {
    const f = page.frameLocator('#frame')
    await f.getByRole('button', { name: 'count is 0' }).click()
    await write(page, 'src/label.ts', "export const label = 'label v2'\n")
    await expect(f.getByText('label v2')).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('editing a child component updates it alone; a later template edit of the parent still keeps its state', async () => {
    const f = page.frameLocator('#frame')
    await f.getByRole('button', { name: 'count is 0' }).click()
    await write(page, 'src/Child.vue', '<template><p>child v2</p></template>\n')
    await expect(f.getByText('child v2')).toBeVisible()
    await write(page, 'src/App.vue', sfc('Vue v3b', 'rgb(200, 0, 0)', "\nconst unused = 'x'"))
    await expect(f.getByRole('heading', { name: 'Vue v3b' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 1' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('removing the last <style> block removes its styles', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.vue', sfc('Vue v4', null, "\nconst unused = 'x'"))
    await expect(f.getByRole('heading', { name: 'Vue v4' })).toBeVisible()
    await expect(f.getByRole('heading')).toHaveCSS('color', 'rgb(0, 0, 0)')
    expect(await marked()).toBe(true)
  })

  test('a compile error shows the overlay; fixing it hot-updates', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.vue', sfc('Vue v3').replace('</template>', ''))
    await expect(f.locator('cresslet-error-overlay pre')).toContainText('App.vue')
    await write(page, 'src/App.vue', sfc('Vue fixed', 'rgb(200, 0, 0)', "\nconst unused = 'x'"))
    await expect(f.getByRole('heading', { name: 'Vue fixed' })).toBeVisible()
    await expect(f.locator('cresslet-error-overlay')).toHaveCount(0)
    expect(await marked()).toBe(true)
  })
})

test.describe.serial('Svelte 5', () => {
  let page: Page
  let marked: () => Promise<boolean>
  const child = (text: string) => `<script lang="ts">\n  let { label }: { label: string } = $props()\n</script>\n\n<p>${text}: {label}</p>\n\n<style>\n  p { color: rgb(0, 0, 180); }\n</style>\n`
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    await boot(page, {
      'package.json': JSON.stringify({ name: 'sv', private: true, type: 'module', dependencies: { svelte: '^5.0.0' } }),
      'index.html': html('/src/main.ts'),
      'src/main.ts': "import { mount } from 'svelte'\nimport App from './App.svelte'\n\nmount(App, { target: document.getElementById('app')! })\n",
      'src/App.svelte': "<script lang=\"ts\">\n  import Child from './Child.svelte'\n  let count = $state(0)\n</script>\n\n<button onclick={() => count++}>count is {count}</button>\n<Child label={'n' + count} />\n",
      'src/Child.svelte': child('child v1'),
    })
    const f = page.frameLocator('#frame')
    await expect(f.getByText('child v1: n0')).toBeVisible({ timeout: 120_000 })
    marked = await mark(page)
    await f.getByRole('button', { name: 'count is 0' }).click()
    await f.getByRole('button', { name: 'count is 1' }).click()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
  })

  test('editing a child component hot-updates it; the parent keeps its state', async () => {
    const f = page.frameLocator('#frame')
    await expect(f.getByText('child v1: n2')).toHaveCSS('color', 'rgb(0, 0, 180)')
    await write(page, 'src/Child.svelte', child('child v2').replace('rgb(0, 0, 180)', 'rgb(180, 0, 0)'))
    await expect(f.getByText('child v2: n2')).toBeVisible()
    await expect(f.getByText('child v2: n2')).toHaveCSS('color', 'rgb(180, 0, 0)')
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('a compile error shows the overlay; fixing it hot-updates', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/Child.svelte', child('child v3').replace('{label}', '{label'))
    await expect(f.locator('cresslet-error-overlay pre')).toContainText('Child.svelte')
    await expect(f.getByText('child v2: n2')).toHaveCSS('color', 'rgb(180, 0, 0)') // the failed update left its styles
    await write(page, 'src/Child.svelte', child('child v4'))
    await expect(f.getByText('child v4: n2')).toBeVisible()
    await expect(f.locator('cresslet-error-overlay')).toHaveCount(0)
    expect(await marked()).toBe(true)
  })
})
