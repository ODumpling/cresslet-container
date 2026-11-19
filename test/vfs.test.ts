import { describe, expect, it } from 'vitest'
import { VFS } from '../src/vfs'
import { exportTree, globToRegExp, mountTree } from '../src/tree'

describe('VFS', () => {
  it('writes, reads, lists, stats', () => {
    const fs = new VFS()
    fs.writeFile('/a/b/c.txt', 'hi', { mkdirp: true })
    expect(fs.readText('/a/b/c.txt')).toBe('hi')
    expect(fs.readdir('/a')).toEqual(['b'])
    expect(fs.stat('/a/b').isDirectory()).toBe(true)
    expect(fs.stat('/a/b/c.txt').size).toBe(2)
    fs.writeFile('/a/b/c.txt', '!', { append: true })
    expect(fs.readText('/a/b/c.txt')).toBe('hi!')
  })

  it('throws node-style errors', () => {
    const fs = new VFS()
    expect(() => fs.readFile('/nope')).toThrow(/ENOENT/)
    fs.mkdir('/d')
    expect(() => fs.mkdir('/d')).toThrow(/EEXIST/)
    fs.writeFile('/d/f', 'x')
    expect(() => fs.rm('/d')).toThrow(/ENOTEMPTY/)
    expect(() => fs.readFile('/d')).toThrow(/EISDIR/)
    expect(() => fs.writeFile('/missing/f', 'x')).toThrow(/ENOENT/)
  })

  it('renames, copies, removes recursively', () => {
    const fs = new VFS()
    fs.writeFile('/src/x/y.js', '1', { mkdirp: true })
    fs.cp('/src', '/copy')
    fs.rename('/src', '/moved')
    expect(fs.exists('/src')).toBe(false)
    expect(fs.readText('/moved/x/y.js')).toBe('1')
    expect(fs.readText('/copy/x/y.js')).toBe('1')
    fs.rm('/moved', { recursive: true })
    expect(fs.exists('/moved')).toBe(false)
    expect(() => fs.rename('/copy', '/copy/x/inside')).toThrow(/EINVAL/)
  })

  it('follows symlinks', () => {
    const fs = new VFS()
    fs.writeFile('/real/f.txt', 'data', { mkdirp: true })
    fs.symlink('/real', '/link')
    expect(fs.readText('/link/f.txt')).toBe('data')
    expect(fs.lstat('/link').isSymbolicLink()).toBe(true)
    expect(fs.realpath('/link/f.txt')).toBe('/real/f.txt')
  })

  it('emits watch events (recursive and not)', () => {
    const fs = new VFS()
    fs.mkdir('/w/sub', { recursive: true })
    const rec: string[] = []
    const flat: string[] = []
    const a = fs.watch('/w', { recursive: true }, (e, f) => rec.push(`${e}:${f}`))
    fs.watch('/w', {}, (e, f) => flat.push(`${e}:${f}`))
    fs.writeFile('/w/a.txt', '1')
    fs.writeFile('/w/a.txt', '2')
    fs.writeFile('/w/sub/b.txt', '1')
    a.close()
    fs.rm('/w/a.txt')
    expect(rec).toEqual(['rename:a.txt', 'change:a.txt', 'rename:sub/b.txt'])
    expect(flat).toEqual(['rename:a.txt', 'change:a.txt', 'rename:a.txt'])
  })
})

describe('tree + glob', () => {
  it('mounts and exports with excludes', () => {
    const fs = new VFS()
    mountTree(fs, { 'a.txt': { file: { contents: 'A' } }, node_modules: { directory: { x: { file: { contents: 'x' } } } }, src: { directory: { 'm.ts': { file: { contents: new Uint8Array([65]) } } } } }, '/p')
    const t = exportTree(fs, '/p', ['node_modules/**'].map(globToRegExp))
    expect(Object.keys(t).sort()).toEqual(['a.txt', 'src'])
    expect(new TextDecoder().decode((t.src as { directory: Record<string, { file: { contents: Uint8Array } }> }).directory['m.ts'].file.contents)).toBe('A')
  })

  it('matches globs', () => {
    expect(globToRegExp('**/*.ts').test('a/b/c.ts')).toBe(true)
    expect(globToRegExp('**/*.ts').test('c.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('a/c.ts')).toBe(false)
    expect(globToRegExp('dist/**').test('dist/x/y')).toBe(true)
    expect(globToRegExp('*.{js,css}').test('a.css')).toBe(true)
  })
})
