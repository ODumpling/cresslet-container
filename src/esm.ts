// ESM vs CommonJS detection for files in the VFS.
import { dirname, extname } from './path'
import { findPackageRoot, readPackageJson, type ResolveFs } from './resolve'

const ESM_SYNTAX = /(^|[\n;])\s*(import\s*[\w{*"'$]|export\s*(\{|\*|default\b|const\b|let\b|var\b|function\b|class\b|async\b))/
const CJS_SYNTAX = /\b(module\.exports|exports\.[\w$]+\s*=|require\s*\(\s*['"`])/

export function isEsmFile(fs: ResolveFs, path: string, code: string): boolean {
  const ext = extname(path)
  if (ext === '.mjs' || ext === '.mts') return true
  if (ext === '.cjs' || ext === '.cts') return false
  const root = findPackageRoot(fs, dirname(path))
  const pkg = root ? readPackageJson(fs, root) : null
  if (pkg?.type === 'module' && (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx')) return true
  const stripped = code.replace(/\/\*[\s\S]*?\*\/|([^:\\'"`]|^)\/\/.*$/gm, '$1')
  if (ESM_SYNTAX.test(stripped)) return true
  if (CJS_SYNTAX.test(stripped)) return false
  return pkg?.type === 'module'
}
