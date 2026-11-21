// CLIs cresslet's `node` can't run (docs/research/wasm-node.md): detected by their bin script, then handed to
// `boot({ fallbackRuntime })`, or refused with an error (they'd otherwise fail late, or exit 0 with no output).
import type { CommandContext } from '../process'
import type { VFS } from '../vfs'
import { join, normalize } from '../path'
import { binEntries, readPkg } from '../npm/install'

/** What a `fallbackRuntime` is called with: the command's context, plus which CLI it is. */
export interface FallbackContext extends CommandContext {
  /** The CLI's package name, e.g. 'next'. */
  package: string
  /** The bin name, e.g. 'next'. */
  bin: string
  /** Absolute VFS path of the bin script `node` was asked to run. `args` are the arguments after it. */
  entry: string
}

/** Runs a CLI cresslet's `node` can't (`boot({ fallbackRuntime })`); resolves to its exit code. */
export type FallbackRuntime = (ctx: FallbackContext) => Promise<number>

/** Packages whose CLIs don't run on cresslet's `node`, and what to say about it. */
const HEAVY_CLIS: Record<string, string> = {
  next: '',
  vite: ' (the `vite` command is cresslet’s built-in dev server and build: run that instead)',
}

/** The heavy CLI `entry` is the bin script of (in a `node_modules/<pkg>/` of HEAVY_CLIS), else null. */
export function heavyCli(vfs: VFS, entry: string): { package: string; bin: string } | null {
  const m = /^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\//.exec(entry)
  // the last node_modules segment is the package's own dir (the greedy `.*` takes every earlier one)
  if (!m || !(m[2] in HEAVY_CLIS)) return null
  const dir = m[1] + m[2]
  let bins: [string, string][]
  try {
    bins = binEntries(m[2], readPkg(vfs, dir)?.bin as never)
  } catch {
    return null
  }
  const target = normalize(entry)
  for (const [bin, rel] of bins) {
    const p = normalize(join(dir, rel))
    if (target === p || target === p + '.js') return { package: m[2], bin }
  }
  return null
}

export function heavyCliError(pkg: string, bin: string): string {
  return `${bin}: ${pkg}'s CLI doesn't run on cresslet's node${HEAVY_CLIS[pkg] ?? ''}. A host can run it elsewhere with boot({ fallbackRuntime }).\n`
}
