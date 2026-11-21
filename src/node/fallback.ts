// CLIs cresslet's `node` can't run (docs/research/wasm-node.md): detected by their bin script, then handed to
// `boot({ fallbackRuntime })`, or refused with an error (they'd otherwise fail late, or exit 0 with no output).
import type { CommandContext } from '../process'
import type { VFS } from '../vfs'
import { dirname, join, normalize, resolve } from '../path'
import { binEntries, binShimTarget, readPkg } from '../npm/install'

/** What a `fallbackRuntime` is called with: the command's context, plus which CLI it is. */
export interface FallbackContext extends CommandContext {
  /** The CLI's package name, e.g. 'next'. */
  package: string
  /** The bin name, e.g. 'next'. */
  bin: string
  /** Absolute VFS path of the package's bin script (also when `node` was given its `.bin` shim). `args` are the arguments after it. */
  entry: string
}

/** Runs a CLI cresslet's `node` can't (`boot({ fallbackRuntime })`); resolves to its exit code. */
export type FallbackRuntime = (ctx: FallbackContext) => Promise<number>

/** Packages whose CLIs don't run on cresslet's `node`, and what to say about it. */
const HEAVY_CLIS: Record<string, string> = {
  next: '',
  vite: " (the `vite` command is cresslet's built-in dev server and build: run that instead)",
}

/**
 * The heavy CLI `entry` (as `node` was given it) runs: the bin script of a HEAVY_CLIS package (by its package.json
 * name, in the last `node_modules/<pkg>/` of the path), directly or through its `.bin` shim. Else null.
 */
export function heavyCli(vfs: VFS, entry: string): Pick<FallbackContext, 'package' | 'bin' | 'entry'> | null {
  // as node resolves a main script: the path itself, else with .js
  const main = (p: string) => (!vfs.isFile(p) && vfs.isFile(p + '.js') ? p + '.js' : p)
  let file = main(normalize(entry))
  const shim = vfs.isFile(file) ? binShimTarget(vfs.readText(file).slice(0, 512)) : null
  if (shim) file = main(resolve(dirname(file), shim))
  // the greedy `.*` takes every earlier node_modules segment, so this is the package's own dir
  const m = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file)
  if (!m) return null
  let name: unknown, bin: unknown
  try {
    ;({ name, bin } = readPkg(vfs, m[1]) ?? {})
  } catch {
    return null // unreadable package.json
  }
  if (typeof name !== 'string' || !Object.hasOwn(HEAVY_CLIS, name)) return null
  for (const [b, rel] of binEntries(name, bin as never)) if (normalize(join(m[1], String(rel))) === file) return { package: name, bin: b, entry: file }
  return null
}

export function heavyCliError(pkg: string, bin: string): string {
  return `${bin}: ${pkg}'s CLI doesn't run on cresslet's node${HEAVY_CLIS[pkg] ?? ''}. A host can run it elsewhere with boot({ fallbackRuntime }).\n`
}
