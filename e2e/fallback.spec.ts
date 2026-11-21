import { expect, test, type Page } from '@playwright/test'

// Heavy CLIs (`next`, vite's own bin) are handed to boot({ fallbackRuntime }), or refused with an error, however
// they're started. A stand-in `next` package (its bin would print if node ran it) keeps this offline.

type Win = Window & { container: import('../src/container').Container }

async function boot(page: Page, fallback: boolean) {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto('/demo/blank.html')
  await page.evaluate(async (fallback) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot(
      fallback
        ? {
            fallbackRuntime: async (ctx) => {
              const pkg = JSON.parse(await ctx.container.fs.readFile(ctx.cwd + '/package.json', 'utf8'))
              ctx.stdout.write(`fallback ${ctx.package} ${ctx.bin} [${ctx.args.join(' ')}] cwd=${ctx.cwd} entry=${ctx.entry} project=${pkg.name}\n`)
              return 7
            },
          }
        : {},
    )
    ;(window as unknown as Win).container = c
    const w = (p: string, s: string) => c.fs.writeFile(p, s)
    await w('package.json', JSON.stringify({ name: 'app', scripts: { build: 'next build --debug' } }))
    await w('node_modules/next/package.json', JSON.stringify({ name: 'next', version: '15.0.0', bin: { next: './dist/bin/next' } }))
    await w('node_modules/next/dist/bin/next', 'console.log("node ran next")')
    await w('node_modules/.bin/next', '#!/usr/bin/env node\n// cresslet-bin -> ../next/dist/bin/next\nrequire("../next/dist/bin/next")\n')
    await w('spawn.js', 'const r = require("child_process").spawnSync("node", ["node_modules/next/dist/bin/next", "dev"], { encoding: "utf8" }); console.log("child", r.status, JSON.stringify(r.stdout + r.stderr))')
  }, fallback)
}

const sh = (page: Page, line: string) =>
  page.evaluate(async (line) => {
    const p = await (window as unknown as Win).container.spawn('jsh', ['-c', line])
    let out = ''
    const piped = p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
    const code = await p.exit
    await piped.catch(() => {})
    return { code, out }
  }, line)

test('heavy CLIs go to boot({ fallbackRuntime }) with their args, cwd and the VFS', async ({ page }) => {
  await boot(page, true)
  const entry = 'entry=/home/project/node_modules/next/dist/bin/next project=app'
  for (const [line, args] of [
    ['npm run build', 'build --debug'], // package script → .bin shim
    ['npx next dev --port 3001', 'dev --port 3001'],
    ['./node_modules/.bin/next lint', 'lint'],
    ['node node_modules/next/dist/bin/next start', 'start'],
  ]) {
    const r = await sh(page, line)
    expect(r.out, line).toContain(`fallback next next [${args}] cwd=/home/project ${entry}`)
    expect(r.out, line).not.toContain('node ran next')
    expect(r.code, line).toBe(7)
  }
  // from a node process: the child is the fallback
  const r = await sh(page, 'node spawn.js')
  expect(r.out).toContain(`child 7 "fallback next next [dev] cwd=/home/project ${entry}\\n"`)
  // everything else still runs on node
  expect((await sh(page, 'node -e "console.log(1 + 1)"')).out).toBe('2\n')
})

test('without a fallbackRuntime, heavy CLIs fail saying so', async ({ page }) => {
  await boot(page, false)
  for (const line of ['npm run build', 'node node_modules/next/dist/bin/next build']) {
    const r = await sh(page, line)
    expect(r.out, line).toContain("next: next's CLI doesn't run on cresslet's node. A host can run it elsewhere with boot({ fallbackRuntime }).")
    expect(r.out, line).not.toContain('node ran next')
    expect(r.code, line).toBe(1)
  }
})
