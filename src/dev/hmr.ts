// Dev server module graph for HMR: which served modules import which, and which can accept their own updates.

export interface ModuleNode {
  importers: Set<string>
  imports: Set<string>
  /** 'self' = accepts its own updates (React Refresh boundary / plain CSS); 'link' = `<link rel=stylesheet>`. */
  accept: 'self' | 'link' | null
  kind: 'js' | 'css'
  /**
   * `import.meta.hot.accept(...)` calls in the module: itself (`accept()` / `accept(cb)`), and/or these imports.
   * `auto`: a self-accept the dev server added (Preact refresh boundary): not for entries, like React's.
   */
  hot?: { self: boolean; deps: Set<string>; auto?: boolean }
}

export interface HmrUpdate {
  /** 'hot': an `import.meta.hot` boundary (`accepted` is the module to re-import: the boundary itself, or a dep it accepts) */
  kind: 'js' | 'css' | 'css-link' | 'hot'
  /** VFS path of the boundary module */
  file: string
  accepted?: string
}

export class ModuleGraph {
  readonly nodes = new Map<string, ModuleNode>()
  /** html file -> the module scripts it loads (entries are never refresh boundaries: re-running them re-mounts the app) */
  private entries = new Map<string, Set<string>>()

  setEntries(html: string, files: Iterable<string>): void {
    this.entries.set(html, new Set(files))
  }

  isEntry(file: string): boolean {
    for (const s of this.entries.values()) if (s.has(file)) return true
    return false
  }

  /** Forget everything page-scoped (a full reload): the new page's requests rebuild it. */
  reset(): void {
    this.nodes.clear()
    this.entries.clear()
  }

  /** Drop a deleted/renamed module: its node and the edges pointing at it. */
  remove(file: string): void {
    const n = this.nodes.get(file)
    if (!n) return
    for (const d of n.imports) this.nodes.get(d)?.importers.delete(file)
    for (const i of n.importers) this.nodes.get(i)?.imports.delete(file)
    this.nodes.delete(file)
  }

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
   * nobody accepts for (an entry script, index.html, unknown file) or only cycles back on itself: the caller falls
   * back to a full reload. An `import.meta.hot` boundary may be an entry: it opted in.
   */
  propagate(file: string): { updates: HmrUpdate[]; chain: Set<string> } | null {
    const chain = new Set<string>()
    const updates: HmrUpdate[] = []
    const walk = (f: string): boolean => {
      if (chain.has(f)) return true
      chain.add(f)
      const n = this.nodes.get(f)
      if (n?.hot && (n.hot.self || (n.hot.auto && !this.isEntry(f)))) return updates.push({ kind: 'hot', file: f, accepted: f }), true
      if (!n || this.isEntry(f)) return false
      if (n.accept === 'self') return updates.push({ kind: n.kind, file: f }), true
      if (n.accept === 'link') return updates.push({ kind: 'css-link', file: f }), true
      if (!n.importers.size) return false
      for (const imp of n.importers) {
        // an importer that accepts this module (`import.meta.hot.accept('./dep', cb)`): it gets the new module, isn't re-run
        if (this.nodes.get(imp)?.hot?.deps.has(f)) updates.push({ kind: 'hot', file: imp, accepted: f })
        else if (!walk(imp)) return false
      }
      return true
    }
    return walk(file) && updates.length ? { updates, chain } : null // no boundary at all (importer cycle): reload
  }

  /**
   * `import.meta.hot.invalidate()` from `file` (already re-run with its new code): its importers are updated instead,
   * as if they had changed. null: a full reload (no importers, or one no boundary accepts for).
   */
  invalidate(file: string): { updates: HmrUpdate[]; chain: Set<string> } | null {
    const n = this.nodes.get(file)
    if (!n?.importers.size || this.isEntry(file)) return null
    const updates = new Map<string, HmrUpdate>()
    const chain = new Set<string>()
    for (const imp of n.importers) {
      // an importer that accepts it gets its (already loaded) new copy
      if (this.nodes.get(imp)?.hot?.deps.has(file)) {
        const u: HmrUpdate = { kind: 'hot', file: imp, accepted: file }
        updates.set(updateKey(u), u)
        continue
      }
      const r = this.propagate(imp)
      if (!r) return null
      for (const u of r.updates) updates.set(updateKey(u), u)
      for (const m of r.chain) chain.add(m)
    }
    return { updates: [...updates.values()], chain }
  }
}

/** Dedupe key: a boundary can accept several of its imports in one flush. */
export const updateKey = (u: HmrUpdate): string => (u.kind === 'hot' ? `${u.file}\0${u.accepted}` : u.file)
