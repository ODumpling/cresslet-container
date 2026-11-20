import { describe, expect, it } from 'vitest'
import { VFS } from '../src/vfs'
import { BROWSER_OPTS, matchExports, NODE_OPTS, resolveModule } from '../src/resolve'
import { join, relative, resolve, normalize, dirname, basename, extname } from '../src/path'

describe('path', () => {
  it('posix basics', () => {
    expect(join('/a', '../b', './c/')).toBe('/b/c/')
    expect(resolve('/x', 'y', '../z')).toBe('/x/z')
    expect(relative('/a/b/c', '/a/d')).toBe('../../d')
    expect(normalize('a//b/../c')).toBe('a/c')
    expect([dirname('/a/b.js'), basename('/a/b.js', '.js'), extname('x.tar.gz')]).toEqual(['/a', 'b', '.gz'])
  })
})

describe('module resolution', () => {
  const fs = new VFS()
  const w = (p: string, d: string) => fs.writeFile(p, d, { mkdirp: true })
  w('/p/node_modules/pkg/package.json', JSON.stringify({ name: 'pkg', main: 'lib/main.js', module: 'esm/index.js', browser: { './lib/node.js': './lib/browser.js', fs: false }, exports: { '.': { browser: './esm/index.js', require: './lib/main.js', default: './lib/main.js' }, './sub/*': './lib/sub/*.js', './package.json': './package.json' } }))
  for (const f of ['lib/main.js', 'esm/index.js', 'lib/sub/a.js', 'lib/node.js', 'lib/browser.js']) w(`/p/node_modules/pkg/${f}`, '')
  w('/p/src/util/index.ts', '')
  w('/p/src/a.ts', '')
  const rfs = { isFile: (p: string) => fs.isFile(p), isDir: (p: string) => fs.isDir(p), readText: (p: string) => fs.tryReadText(p) }

  it('resolves relative files with extensions + index', () => {
    expect(resolveModule(rfs, './util', '/p/src', BROWSER_OPTS)).toBe('/p/src/util/index.ts')
    expect(resolveModule(rfs, './a.js', '/p/src', BROWSER_OPTS)).toBe('/p/src/a.ts')
  })

  it('uses export conditions', () => {
    expect(resolveModule(rfs, 'pkg', '/p/src', BROWSER_OPTS)).toBe('/p/node_modules/pkg/esm/index.js')
    expect(resolveModule(rfs, 'pkg', '/p/src', NODE_OPTS)).toBe('/p/node_modules/pkg/lib/main.js')
    expect(resolveModule(rfs, 'pkg/sub/a', '/p/src', NODE_OPTS)).toBe('/p/node_modules/pkg/lib/sub/a.js')
    expect(() => resolveModule(rfs, 'nope', '/p/src', NODE_OPTS)).toThrow(/Cannot find module 'nope'/)
  })

  it('applies browser field maps', () => {
    expect(resolveModule(rfs, './node.js', '/p/node_modules/pkg/lib', BROWSER_OPTS)).toBe('/p/node_modules/pkg/lib/browser.js')
    expect(resolveModule(rfs, 'fs', '/p/node_modules/pkg/lib', BROWSER_OPTS)).toBe(false)
  })

  it('matches export patterns', () => {
    expect(matchExports({ './*': './dist/*.js' }, './x/y', ['default'])).toBe('./dist/x/y.js')
    expect(matchExports('./i.js', '.', ['default'])).toBe('./i.js')
    expect(matchExports({ import: './m.mjs', require: './c.cjs' }, '.', ['require'])).toBe('./c.cjs')
    expect(matchExports([{ worker: './w.js' }, './f.js'], '.', ['default'])).toBe('./f.js')
  })
})

describe('linked packages', () => {
  it('resolve to their real path (as node does), so their relative imports work', () => {
    const fs = new VFS()
    fs.writeFile('/p/packages/a/package.json', JSON.stringify({ name: 'a', main: 'index.js' }), { mkdirp: true })
    fs.writeFile('/p/packages/a/index.js', "require('../shared.js')")
    fs.mkdir('/p/node_modules', { recursive: true })
    fs.symlink('../packages/a', '/p/node_modules/a')
    const rfs = { isFile: (p: string) => fs.isFile(p), isDir: (p: string) => fs.isDir(p), readText: (p: string) => fs.tryReadText(p) }
    expect(resolveModule({ ...rfs, realpath: (p) => fs.realpath(p) }, 'a', '/p', NODE_OPTS)).toBe('/p/packages/a/index.js')
    expect(resolveModule(rfs, 'a', '/p', NODE_OPTS)).toBe('/p/node_modules/a/index.js') // without realpath: the link path
    // a file named through the link (`node node_modules/a/index.js`) resolves to its real path too
    expect(resolveModule({ ...rfs, realpath: (p) => fs.realpath(p) }, './node_modules/a/index.js', '/p', NODE_OPTS)).toBe('/p/packages/a/index.js')
  })
})
