// Dev server module graph for HMR: which served modules import which, and which can accept their own updates.

export interface ModuleNode {
  importers: Set<string>
  imports: Set<string>
  /** 'self' = accepts its own updates (React Refresh boundary / plain CSS); 'link' = `<link rel=stylesheet>`. */
  accept: 'self' | 'link' | null
  kind: 'js' | 'css'
}

export interface HmrUpdate {
  kind: 'js' | 'css' | 'css-link'
  /** VFS path of the boundary module */
  file: string
}

export class ModuleGraph {
  readonly nodes = new Map<string, ModuleNode>()

  ensure(file: string, kind?: ModuleNode['kind']): ModuleNode {
    let n = this.nodes.get(file)
    if (!n) this.nodes.set(file, (n = { importers: new Set(), imports: new Set(), accept: null, kind: kind ?? 'js' }))
    else if (kind) n.kind = kind
    return n
  }

  /** Replace a module's import edges (after a successful transform). */
  setImports(file: string, imports: Iterable<string>): void {
    const n = this.ensure(file)
    for (const d of n.imports) this.nodes.get(d)?.importers.delete(file)
    n.imports = new Set(imports)
    for (const d of n.imports) this.ensure(d).importers.add(file)
  }

  /**
   * Walk importers from a changed file up to accepting boundaries. Returns the boundaries plus every module on the
   * way (they must be re-executed, i.e. re-imported with a fresh timestamp), or null when some path reaches a module
   * nobody accepts for (an entry script, index.html, unknown file): the caller falls back to a full reload.
   */
  propagate(file: string): { updates: HmrUpdate[]; chain: Set<string> } | null {
    const chain = new Set<string>()
    const updates: HmrUpdate[] = []
    const walk = (f: string): boolean => {
      if (chain.has(f)) return true
      chain.add(f)
      const n = this.nodes.get(f)
      if (!n) return false
      if (n.accept === 'self') return updates.push({ kind: n.kind, file: f }), true
      if (n.accept === 'link') return updates.push({ kind: 'css-link', file: f }), true
      if (!n.importers.size) return false
      for (const imp of n.importers) if (!walk(imp)) return false
      return true
    }
    return walk(file) ? { updates, chain } : null
  }
}
