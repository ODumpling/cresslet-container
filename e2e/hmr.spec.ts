import { expect, test, type Frame, type Page } from '@playwright/test'

type Win = Window & { container: import('../src/container').Container; __marker?: number }

// HMR against the demo app (React 19 + `import './index.css'`). A marker on the preview's window proves "no reload":
// a full reload gives the frame a fresh window without it.

const write = (page: Page, path: string, contents: string) =>
  page.evaluate(([p, s]) => (window as unknown as Win).container.fs.writeFile(p, s), [path, contents] as const)

const app = (heading: string, extraHook = '') => `import { useState } from 'react'

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

test.describe.serial('HMR', () => {
  let page: Page
  let frame: Frame
  const marked = () => frame.evaluate(() => (window as unknown as Win).__marker === 1)

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e) => console.log('[pageerror]', e.message))
    await page.goto('/')
    const f = page.frameLocator('#frame')
    await expect(f.getByRole('heading', { name: 'Hello from Cresslet' })).toBeVisible({ timeout: 120_000 })
    frame = (await (await page.$('#frame'))!.contentFrame())!
    await f.getByRole('button', { name: 'count is 0' }).click()
    await f.getByRole('button', { name: 'count is 1' }).click()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
  })

  test('CSS edit hot-swaps the stylesheet without a reload', async () => {
    const h1 = page.frameLocator('#frame').getByRole('heading')
    await expect(h1).toHaveCSS('color', 'rgb(31, 136, 61)')
    const css = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/index.css', 'utf8'))
    await write(page, 'src/index.css', css.replace('#1f883d', 'rgb(200, 0, 0)'))
    await expect(h1).toHaveCSS('color', 'rgb(200, 0, 0)')
    expect(await marked()).toBe(true)
    await expect(page.frameLocator('#frame').getByRole('button', { name: 'count is 2' })).toBeVisible()
  })

  test('component edit is fast-refreshed and keeps state', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', app('Hot edited'))
    await expect(f.getByRole('heading', { name: 'Hot edited' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 2' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('changing the hooks of a component remounts it (state reset, still no reload)', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', app('New hooks', `  const [label] = useState('x')\n`))
    await expect(f.getByRole('heading', { name: 'New hooks' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('a syntax error shows the overlay; fixing it hot-updates', async () => {
    const f = page.frameLocator('#frame')
    await f.getByRole('button', { name: 'count is 0' }).click()
    await write(page, 'src/App.tsx', app('broken</h2>', `  const [label] = useState('x')\n`))
    await expect(f.locator('cresslet-error-overlay pre')).toContainText('App.tsx')
    await write(page, 'src/App.tsx', app('Recovered', `  const [label] = useState('x')\n`))
    await expect(f.getByRole('heading', { name: 'Recovered' })).toBeVisible()
    await expect(f.locator('cresslet-error-overlay')).toHaveCount(0)
    await expect(f.getByRole('button', { name: 'count is 1' })).toBeVisible()
    expect(await marked()).toBe(true)
  })

  test('adding a hook inside a custom hook in a .ts module remounts its user (no "Rendered more hooks")', async () => {
    const f = page.frameLocator('#frame')
    const errors: string[] = []
    const onErr = (e: Error) => void errors.push(e.message)
    page.on('pageerror', onErr)
    const hook = (extra = '') => `import { useState } from 'react'\nexport function useCounter() {\n${extra}  return useState(0)\n}\n`
    const withHook = `import { useCounter } from './useCounter'

export default function App() {
  const [count, setCount] = useCounter()
  return (
    <main>
      <h1>Custom hook</h1>
      <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
    </main>
  )
}
`
    await page.evaluate(([h, a]) => {
      const fs = (window as unknown as Win).container.fs
      return fs.writeFile('src/useCounter.ts', h).then(() => fs.writeFile('src/App.tsx', a))
    }, [hook(), withHook] as const)
    await expect(f.getByRole('heading', { name: 'Custom hook' })).toBeVisible()
    await f.getByRole('button', { name: 'count is 0' }).click()
    await expect(f.getByRole('button', { name: 'count is 1' })).toBeVisible()
    await write(page, 'src/useCounter.ts', hook(`  const [extra] = useState('x')\n`))
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible() // remounted: state reset
    await expect(f.locator('cresslet-error-overlay')).toHaveCount(0)
    expect(errors.filter((m) => /hooks/i.test(m))).toEqual([])
    expect(await marked()).toBe(true)
    page.off('pageerror', onErr)
  })

  test('a broken boundary in a batch does not hold back the other updates', async () => {
    const f = page.frameLocator('#frame')
    const other = (text: string) => `export default function Other() {\n  return <p>${text}</p>\n}\n`
    const appWith = (heading: string) => `import Other from './Other'\n\n` + app(heading).replace('</h1>', '</h1>\n      <Other />')
    await page.evaluate(([o, a]) => {
      const fs = (window as unknown as Win).container.fs
      return fs.writeFile('src/Other.tsx', o).then(() => fs.writeFile('src/App.tsx', a))
    }, [other('other v1'), appWith('Batch')] as const)
    await expect(f.getByText('other v1')).toBeVisible()
    // one flush: App (first) gets a syntax error, Other changes
    await page.evaluate(([a, o]) => {
      const fs = (window as unknown as Win).container.fs
      return fs.writeFile('src/App.tsx', a).then(() => fs.writeFile('src/Other.tsx', o))
    }, [appWith('broken</h2>'), other('other v2')] as const)
    await expect(f.getByText('other v2')).toBeVisible()
    await expect(f.locator('cresslet-error-overlay pre')).toContainText('App.tsx')
    await write(page, 'src/App.tsx', appWith('Batch fixed'))
    await expect(f.getByRole('heading', { name: 'Batch fixed' })).toBeVisible()
    await expect(f.locator('cresslet-error-overlay')).toHaveCount(0)
    expect(await marked()).toBe(true)
  })

  test('renaming the default export (another component family) falls back to a full reload', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/App.tsx', app('Renamed').replace('function App()', 'function Main()'))
    await expect.poll(marked).toBe(false)
    await expect(f.getByRole('heading', { name: 'Renamed' })).toBeVisible()
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
  })

  test('editing a non-component module (the entry) falls back to a full reload', async () => {
    const f = page.frameLocator('#frame')
    const main = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('src/main.tsx', 'utf8'))
    await write(page, 'src/main.tsx', main + '\n// touched\n')
    await expect.poll(marked).toBe(false)
    await expect(f.getByRole('heading', { name: 'Renamed' })).toBeVisible()
    await expect(f.getByRole('button', { name: 'count is 0' })).toBeVisible()
  })

  test('<link rel=stylesheet> edits swap the link without a reload', async () => {
    const f = page.frameLocator('#frame')
    await write(page, 'src/linked.css', 'button { color: rgb(0, 0, 200); }\n')
    const html = await page.evaluate(() => (window as unknown as Win).container.fs.readFile('index.html', 'utf8'))
    await write(page, 'index.html', html.replace('</head>', '<link rel="stylesheet" href="/src/linked.css" /></head>'))
    const button = f.getByRole('button')
    await expect(button).toHaveCSS('color', 'rgb(0, 0, 200)') // index.html change: full reload
    await frame.evaluate(() => void ((window as unknown as Win).__marker = 1))
    await write(page, 'src/linked.css', 'button { color: rgb(0, 150, 0); }\n')
    await expect(button).toHaveCSS('color', 'rgb(0, 150, 0)')
    expect(await marked()).toBe(true)
    await expect(f.locator('link[rel=stylesheet]')).toHaveCount(1)
  })
})
