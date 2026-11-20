import { expect, test, type Request } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A real install from the registry: the fixture's package-lock.json (written by npm 11) pins versions older than
// what its package.json ranges resolve to today, across a workspace (`packages/greet`, with a nested `ms@1`).

const REGISTRY = 'https://registry.npmjs.org/'
const FIXTURE = join(import.meta.dirname, 'fixtures/npm-workspace')

function files(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(join(dir, rel))) {
    const r = rel ? `${rel}/${name}` : name
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, files(dir, r))
    else out[r] = readFileSync(join(dir, r), 'utf8')
  }
  return out
}

test('npm install and npm ci follow package-lock.json, with workspaces', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  const packuments: string[] = []
  const tarballs: string[] = []
  page.on('request', (r: Request) => {
    const u = r.url()
    if (u.startsWith(REGISTRY)) (u.endsWith('.tgz') ? tarballs : packuments).push(u)
  })
  await page.goto('/demo/blank.html')
  const res = await page.evaluate(async (fixture) => {
    const { Container } = await import('/dist/cresslet-container.js')
    const c = await Container.boot({ serviceWorkerUrl: false, npmCache: false })
    for (const [p, s] of Object.entries(fixture)) await c.fs.writeFile(p, s)
    const run = async (cmd: string, args: string[], cwd?: string) => {
      const p = await c.spawn(cmd, args, cwd ? { cwd } : {})
      let out = ''
      await p.output.pipeTo(new WritableStream({ write: (d) => void (out += d) }))
      return { code: await p.exit, out: out.replace(/\x1b\[[0-9;]*m/g, '') }
    }
    const lockBefore = await c.fs.readFile('package-lock.json', 'utf-8')
    const install = await run('npm', ['install'])
    const main = await run('node', ['main.js'])
    const script = await run('npm', ['run', 'check'], 'packages/greet') // `semver` is hoisted to the root's .bin
    const bin = await run('npm', ['run', 'hi']) // the workspace's own bin, which requires ../shared.js
    const direct = await run('node', ['./node_modules/greet/cli.js']) // the same file named through the link
    const dry = await run('npm', ['ci', '--dry-run'])
    const help = await run('npm', ['ci', '--help'])
    const ws = await run('npm', ['install', '--workspace', 'greet', 'lodash'])
    const afterDry = await c.fs.readdir('node_modules')
    const link = await c.fs.readdir('node_modules', { withFileTypes: true }).then((ds) => ds.find((d) => d.name === 'greet')?.isSymbolicLink())
    const build = await run('vite', ['build'])
    const bundle = (await c.fs.readdir('dist/assets').catch(() => [] as string[])).filter((f) => f.endsWith('.js'))
    const js = bundle.length ? await c.fs.readFile(`dist/assets/${bundle[0]}`, 'utf-8') : ''
    await c.fs.writeFile('node_modules/stray.txt', 'x')
    const ci = await run('npm', ['ci'])
    const mainAfterCi = await run('node', ['main.js'])
    const lockAfter = await c.fs.readFile('package-lock.json', 'utf-8')
    return { install, main, script, bin, direct, dry, help, ws, pkgAfterWs: await c.fs.readFile('package.json', 'utf-8'), afterDry, link, build, bundled: js.includes('greet: ms@'), ci, mainAfterCi, lockUnchanged: lockBefore === lockAfter }
  }, files(FIXTURE))
  console.log(res.install.out, res.main.out, res.build.out, res.ci.out)
  expect(res.install.code).toBe(0)
  // the locked versions, not the newest matching ones (ms 2.1.3, semver 7.8.x)
  expect(res.main.out).toBe('greet: ms@1.0.0 1m, is-number@6.0.0 true, shared\nroot: ms@2.0.0, semver@7.5.0\n')
  expect(packuments).toEqual([]) // installed straight from the lockfile's tarball URLs
  expect(tarballs.sort()).toEqual(
    ['is-number/-/is-number-6.0.0', 'lru-cache/-/lru-cache-6.0.0', 'ms/-/ms-1.0.0', 'ms/-/ms-2.0.0', 'semver/-/semver-7.5.0', 'yallist/-/yallist-4.0.0'].map((t) => `${REGISTRY}${t}.tgz`),
  )
  expect(res.link).toBe(true)
  expect(res.script).toMatchObject({ code: 0 })
  expect(res.script.out).toContain('1.2.3')
  expect(res.bin).toMatchObject({ code: 0 })
  expect(res.bin.out).toContain('greet-cli shared')
  expect(res.direct).toMatchObject({ code: 0 })
  expect(res.direct.out).toContain('greet-cli shared')
  expect(res.dry.code).toBe(1) // refused, and nothing was wiped
  expect(res.help).toMatchObject({ code: 0 })
  expect(res.help.out).toContain('npm ci')
  expect(res.ws.code).toBe(1) // -w refused, not read as packages to add
  expect(res.pkgAfterWs).not.toContain('lodash')
  expect(res.afterDry).toContain('ms')
  expect(res.build.code).toBe(0)
  expect(res.bundled).toBe(true)
  expect(res.ci.code).toBe(0)
  expect(res.mainAfterCi.out).toBe(res.main.out)
  expect(res.lockUnchanged).toBe(true)
})
