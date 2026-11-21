import { describe, expect, it } from 'vitest'
import { VFS } from '../src/vfs'
import { heavyCli, heavyCliError } from '../src/node/fallback'

function project() {
  const v = new VFS()
  const file = (p: string, s = '') => v.writeFile(p, s, { mkdirp: true })
  const pkg = (dir: string, json: object) => file(`${dir}/package.json`, JSON.stringify(json))
  pkg('/p/node_modules/next', { name: 'next', bin: { next: './dist/bin/next' } })
  file('/p/node_modules/next/dist/bin/next')
  file('/p/node_modules/next/dist/bin/next.js') // an unrelated sibling of the extensionless bin
  pkg('/p/node_modules/vite', { name: 'vite', bin: { vite: 'bin/vite.js' } })
  file('/p/node_modules/vite/bin/vite.js')
  pkg('/p/node_modules/typescript', { name: 'typescript', bin: { tsc: './bin/tsc' } })
  file('/p/node_modules/typescript/bin/tsc')
  pkg('/p/node_modules/foo/node_modules/next', { name: 'next', bin: 'dist/bin/next' })
  file('/p/node_modules/foo/node_modules/next/dist/bin/next')
  pkg('/p/node_modules/next-alt', { name: 'next', bin: { next: 'dist/bin/next' } }) // next-alt@npm:next
  file('/p/node_modules/next-alt/dist/bin/next')
  pkg('/p/node_modules/constructor', { name: 'constructor', bin: 'cli.js' })
  file('/p/node_modules/constructor/cli.js')
  pkg('/q/node_modules/vite', { name: 'not-vite', bin: { vite: 'bin/vite.js' } }) // another package in a `vite` dir
  file('/q/node_modules/vite/bin/vite.js')
  const shim = (name: string, target: string) => file(`/p/node_modules/.bin/${name}`, `#!/usr/bin/env node\n// cresslet-bin -> ${target}\nrequire(${JSON.stringify(target)})\n`)
  shim('next', '../next/dist/bin/next')
  shim('vite', '../vite/bin/vite.js')
  shim('tsc', '../typescript/bin/tsc')
  // npm-style links (e.g. a mounted node_modules): a .bin symlink, and a package dir linked from elsewhere
  v.symlink('../vite/bin/vite.js', '/p/node_modules/.bin/vite-link')
  pkg('/s/node_modules/.pnpm/next@15/node_modules/next', { name: 'next', bin: { next: 'dist/bin/next' } })
  file('/s/node_modules/.pnpm/next@15/node_modules/next/dist/bin/next')
  v.symlink('.pnpm/next@15/node_modules/next', '/s/node_modules/next')
  return v
}

describe('heavyCli', () => {
  const v = project()
  const next = { package: 'next', bin: 'next', entry: '/p/node_modules/next/dist/bin/next' }
  const vite = { package: 'vite', bin: 'vite', entry: '/p/node_modules/vite/bin/vite.js' }
  it("detects a heavy package's bin script, by its path or its .bin shim", () => {
    expect(heavyCli(v, '/p/node_modules/next/dist/bin/next')).toEqual(next)
    expect(heavyCli(v, '/p/node_modules/vite/bin/vite.js')).toEqual(vite)
    expect(heavyCli(v, '/p/node_modules/vite/bin/vite')).toEqual(vite) // node adds the .js
    expect(heavyCli(v, '/p/node_modules/foo/node_modules/next/dist/bin/next')).toEqual({ ...next, entry: '/p/node_modules/foo/node_modules/next/dist/bin/next' }) // nested copy, string `bin`
    expect(heavyCli(v, '/p/node_modules/next-alt/dist/bin/next')).toEqual({ ...next, entry: '/p/node_modules/next-alt/dist/bin/next' }) // by its package.json name
    expect(heavyCli(v, '/p/node_modules/.bin/next')).toEqual(next) // `node node_modules/.bin/next`
    expect(heavyCli(v, '/p/node_modules/.bin/vite')).toEqual(vite)
    expect(heavyCli(v, '/p/node_modules/.bin/vite-link')).toEqual(vite)
    expect(heavyCli(v, '/s/node_modules/next/dist/bin/next')).toEqual({ ...next, entry: '/s/node_modules/.pnpm/next@15/node_modules/next/dist/bin/next' })
  })
  it('leaves everything else to node', () => {
    expect(heavyCli(v, '/p/node_modules/next/dist/bin/next.js')).toBeNull() // not the bin
    expect(heavyCli(v, '/p/node_modules/next/dist/server/next.js')).toBeNull() // e.g. a custom server's import
    expect(heavyCli(v, '/p/node_modules/vite/dist/node/cli.js')).toBeNull()
    expect(heavyCli(v, '/p/node_modules/typescript/bin/tsc')).toBeNull() // real tsc (≤ 6) runs on cresslet's node
    expect(heavyCli(v, '/p/node_modules/.bin/tsc')).toBeNull()
    expect(heavyCli(v, '/p/node_modules/constructor/cli.js')).toBeNull()
    expect(heavyCli(v, '/q/node_modules/vite/bin/vite.js')).toBeNull()
    expect(heavyCli(v, '/p/next/dist/bin/next')).toBeNull()
    expect(heavyCli(v, '/p/server.js')).toBeNull()
    expect(heavyCli(v, '/r/node_modules/next/dist/bin/next')).toBeNull() // no package.json
  })
  it('names the CLI and the hook in its error', () => {
    expect(heavyCliError(next, ['build'])).toMatch(/^next: next's CLI doesn't run on cresslet's node\. .*boot\(\{ fallbackRuntime \}\)/)
    expect(heavyCliError(vite, [])).toContain('built-in dev server')
  })
  it("lets next's --version / --help alone run on node (they work there), not vite's", () => {
    for (const a of ['-v', '--version', '-h', '--help']) {
      expect(heavyCliError(next, [a]), a).toBeNull()
      expect(heavyCliError(vite, [a]), a).toContain("vite's CLI doesn't run")
    }
    expect(heavyCliError(next, ['build', '--help'])).not.toBeNull()
  })
})
