import { describe, expect, it } from 'vitest'
import { VFS } from '../src/vfs'
import { heavyCli, heavyCliError } from '../src/node/fallback'

function project() {
  const v = new VFS()
  const pkg = (dir: string, json: object) => v.writeFile(`${dir}/package.json`, JSON.stringify(json), { mkdirp: true })
  pkg('/p/node_modules/next', { name: 'next', bin: { next: './dist/bin/next' } })
  v.writeFile('/p/node_modules/next/dist/bin/next', '', { mkdirp: true })
  pkg('/p/node_modules/vite', { name: 'vite', bin: { vite: 'bin/vite.js' } })
  pkg('/p/node_modules/typescript', { name: 'typescript', bin: { tsc: './bin/tsc' } })
  pkg('/p/node_modules/foo/node_modules/next', { name: 'next', bin: 'dist/bin/next' })
  return v
}

describe('heavyCli', () => {
  const v = project()
  it("detects a heavy package's bin script, by its path", () => {
    expect(heavyCli(v, '/p/node_modules/next/dist/bin/next')).toEqual({ package: 'next', bin: 'next' })
    expect(heavyCli(v, '/p/node_modules/next/dist/bin/next.js')).toEqual({ package: 'next', bin: 'next' })
    expect(heavyCli(v, '/p/node_modules/vite/bin/vite.js')).toEqual({ package: 'vite', bin: 'vite' })
    // nested copy, string `bin`
    expect(heavyCli(v, '/p/node_modules/foo/node_modules/next/dist/bin/next')).toEqual({ package: 'next', bin: 'next' })
  })
  it('leaves everything else to node', () => {
    expect(heavyCli(v, '/p/node_modules/next/dist/server/next.js')).toBeNull() // not a bin (e.g. a custom server's import)
    expect(heavyCli(v, '/p/node_modules/vite/dist/node/cli.js')).toBeNull()
    expect(heavyCli(v, '/p/node_modules/typescript/bin/tsc')).toBeNull() // real tsc runs on cresslet's node
    expect(heavyCli(v, '/p/next/dist/bin/next')).toBeNull()
    expect(heavyCli(v, '/p/server.js')).toBeNull()
    expect(heavyCli(v, '/q/node_modules/next/dist/bin/next')).toBeNull() // no package.json
  })
  it('names the CLI and the hook in its error', () => {
    expect(heavyCliError('next', 'next')).toMatch(/^next: next's CLI doesn't run on cresslet's node\. .*boot\(\{ fallbackRuntime \}\)/)
    expect(heavyCliError('vite', 'vite')).toContain('built-in dev server')
  })
})
