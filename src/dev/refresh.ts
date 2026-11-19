// React Fast Refresh without Babel: a registration pass over esbuild's ESM output.
//
// esbuild has no refresh transform, but its output is very regular: top-level declarations start at column 0
// (`function X(`, `var X = `), and with every import external the exports end up in one trailing `export { … }`
// clause. That is enough to register each capitalized top-level binding with react-refresh and to give it a hook
// signature (the hook calls in its body), which is what decides whether state is kept or the component remounts.
// The registration code is appended (imports are hoisted), so source maps of the original lines stay valid.

export const REFRESH_RUNTIME_URL = '/@cresslet/react-refresh'
export const REFRESH_UTILS_URL = '/@cresslet/refresh'

const BUILTIN_HOOKS = new Set(
  'useState useReducer useEffect useLayoutEffect useInsertionEffect useMemo useCallback useRef useContext useImperativeHandle useDebugValue useDeferredValue useTransition useId useSyncExternalStore useOptimistic useActionState useFormStatus useEffectEvent'.split(
    ' ',
  ),
)
const DECL = /^(?:export\s+)?(?:(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(|(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=|class\s+([A-Za-z_$][\w$]*)\b)/
const HOOK_CALL = /(?<![\w$])(?:[A-Za-z_$][\w$]*\.)?(use[A-Z0-9][\w$]*)\s*\(/g

export interface RefreshResult {
  code: string
  /** All exports look like components: the module can accept its own updates. */
  boundary: boolean
  registered: string[]
}

/** Exported name -> local name from the trailing `export { a, b as c }` clause; null if there are other export forms. */
export function parseExports(code: string): Map<string, string> | null {
  if (/^export\s*\*|^export\s*\{[^}]*\}\s*from\b|^export\s+(default|function|const|let|var|class|async)\b/m.test(code)) return null
  const m = /^export\s*\{([^}]*)\};?\s*$/m.exec(code)
  const out = new Map<string, string>()
  if (!m) return out
  for (const part of m[1].split(',')) {
    const s = part.trim()
    if (!s) continue
    const [local, exported = local] = s.split(/\s+as\s+/)
    out.set(exported.replace(/^"|"$/g, ''), local)
  }
  return out
}

const isComponentName = (n: string) => /^[A-Z]/.test(n)
const isHookName = (n: string) => /^use[A-Z0-9]/.test(n)

export function refreshTransform(code: string, id: string): RefreshResult {
  const lines = code.split('\n')
  const decls: { name: string; start: number }[] = []
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^export\s*\{/.test(l) || l.startsWith('//# sourceMappingURL=')) {
      end = Math.min(end, i)
      continue
    }
    const m = DECL.exec(l)
    if (m) decls.push({ name: m[1] ?? m[2] ?? m[3], start: i })
  }
  const exports = parseExports(code)
  let ns = '__cresslet_refresh' // binding for the injected import: must not collide with anything in the module
  while (code.includes(ns)) ns += '_'
  const tail: string[] = []
  const registered: string[] = []
  decls.forEach((d, k) => {
    if (!isComponentName(d.name) && !isHookName(d.name)) return
    const body = lines.slice(d.start, k + 1 < decls.length ? decls[k + 1].start : end)
    const keys: string[] = []
    const custom: string[] = []
    for (const line of body) {
      for (const m of line.matchAll(HOOK_CALL)) {
        const hook = m[1]
        if (hook === d.name) continue
        // like Babel's plugin: useState/useReducer keys include their declaration, so changing the initial value resets
        keys.push(hook === 'useState' || hook === 'useReducer' ? line.trim() : hook)
        if (!BUILTIN_HOOKS.has(hook) && !m[0].includes('.') && !custom.includes(hook)) custom.push(hook)
      }
    }
    const getHooks = custom.length ? `() => [${custom.map((h) => `typeof ${h} === "function" ? ${h} : void 0`).join(', ')}]` : 'void 0'
    // `typeof` guard: a declaration-looking line inside a multi-line template literal is not a real binding
    const guard = `typeof ${d.name} !== "undefined" && `
    if (isComponentName(d.name)) {
      registered.push(d.name)
      tail.push(`${guard}${ns}.register(${d.name}, ${JSON.stringify(`${id} ${d.name}`)}, ${JSON.stringify(keys.join('\n'))}, ${getHooks});`)
    } else tail.push(`${guard}${ns}.sign(${d.name}, ${JSON.stringify(keys.join('\n'))}, ${getHooks});`)
  })
  const boundary = !!exports && exports.size > 0 && [...exports].every(([exp, local]) => isComponentName(exp === 'default' ? local : exp))
  if (!tail.length) return { code, boundary: false, registered }
  // export shape (names + refresh families), compared on update: an added/removed/re-pointed export needs a reload
  if (boundary) tail.push(`${ns}.exportsOf(${JSON.stringify(id)}, { ${[...exports!].map(([exp, local]) => `${JSON.stringify(exp)}: typeof ${local} !== "undefined" ? ${local} : void 0`).join(', ')} });`)
  const add = `\nimport * as ${ns} from ${JSON.stringify(REFRESH_UTILS_URL)};\n${tail.join('\n')}\n`
  const sm = code.lastIndexOf('\n//# sourceMappingURL=')
  return { code: sm < 0 ? code + add : code.slice(0, sm) + add + code.slice(sm), boundary, registered }
}

/** Browser module served at REFRESH_UTILS_URL; also loaded first by the HTML so it hooks React before react-dom runs. */
export function refreshUtilsCode(): string {
  return `import R from ${JSON.stringify(REFRESH_RUNTIME_URL)};
if (!window.__cresslet_refresh_installed) {
  R.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (t) => t;
  window.__cresslet_refresh_installed = true;
}
const inner = (t) => t && typeof t === 'object' ? (t.$$typeof === Symbol.for('react.memo') ? t.type : t.$$typeof === Symbol.for('react.forward_ref') ? t.render : null) : null;
export function register(type, id, key, getHooks) {
  if (!R.isLikelyComponentType(type)) return;
  R.register(type, id);
  for (let t = type; t; t = inner(t)) if (typeof t === 'function') R.setSignature(t, key, false, getHooks);
}
export function sign(fn, key, getHooks) {
  if (typeof fn === 'function') R.setSignature(fn, key, false, getHooks);
}
const shapes = new Map();
const shapeChanged = new Set();
/** Record a boundary's exports (name -> refresh family); a different shape than last time means it can't hot-update. */
export function exportsOf(id, mod) {
  const next = Object.keys(mod).sort().map((k) => [k, R.getFamilyByType(mod[k])]);
  const prev = shapes.get(id);
  shapes.set(id, next);
  if (prev && (prev.length !== next.length || prev.some(([k, f], i) => next[i][0] !== k || next[i][1] !== f))) shapeChanged.add(id);
  else shapeChanged.delete(id);
}
/** Whether the last evaluation of module \`id\` added/removed exports or re-pointed one to another component. */
export function exportsChanged(id) {
  return shapeChanged.has(id);
}
/** Every export of an updated module must be a component, otherwise its importers would keep stale values. */
export function isBoundary(mod) {
  const keys = Object.keys(mod);
  return keys.length > 0 && keys.every((k) => R.isLikelyComponentType(mod[k]));
}
let timer;
export function performRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => R.performReactRefresh(), 16);
}
`
}

/** Wrap react-refresh's CJS runtime as an ES module. */
export function refreshRuntimeModule(cjs: string): string {
  return `var exports = {}, process = { env: { NODE_ENV: "development" } };\n${cjs}\nexport default exports;\n`
}
