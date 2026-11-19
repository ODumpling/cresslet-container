// WebContainer-compatible FileSystemTree mount/export + glob matching.
import type { VFS } from './vfs'
import { toBytes } from './vfs'

export interface FileNodeTree {
  file: { contents: string | Uint8Array }
}
export interface SymlinkNodeTree {
  file: { symlink: string }
}
export interface DirectoryNodeTree {
  directory: FileSystemTree
}
export interface FileSystemTree {
  [name: string]: FileNodeTree | SymlinkNodeTree | DirectoryNodeTree
}

export function mountTree(fs: VFS, tree: FileSystemTree, at: string): void {
  fs.mkdir(at, { recursive: true })
  for (const [name, node] of Object.entries(tree)) {
    const p = at === '/' ? `/${name}` : `${at}/${name}`
    if ('directory' in node) mountTree(fs, node.directory, p)
    else if ('symlink' in node.file) {
      fs.rm(p, { force: true })
      fs.symlink(node.file.symlink, p)
    } else fs.writeFile(p, toBytes(node.file.contents))
  }
}

export function exportTree(fs: VFS, dir: string, excludes: RegExp[] = [], rel = ''): FileSystemTree {
  const out: FileSystemTree = {}
  for (const d of fs.readdirEntries(dir)) {
    const r = rel ? `${rel}/${d.name}` : d.name
    if (excludes.some((re) => re.test(r) || (d.isDirectory() && re.test(r + '/')))) continue
    const p = `${dir === '/' ? '' : dir}/${d.name}`
    if (d.isSymbolicLink()) out[d.name] = { file: { symlink: fs.readlink(p) } }
    else if (d.isDirectory()) out[d.name] = { directory: exportTree(fs, p, excludes, r) }
    else out[d.name] = { file: { contents: fs.readFile(p).slice() } }
  }
  return out
}

/** Convert a glob ('**', '*', '?', '{a,b}') to an anchored RegExp over relative POSIX paths. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/'
        re += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escape).join('|') + ')'
      i = end
    } else re += escape(c)
  }
  return new RegExp(`^${re}$`)
}
const escape = (s: string) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')
