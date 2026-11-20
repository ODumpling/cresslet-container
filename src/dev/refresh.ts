// React Fast Refresh without Babel: a registration pass over esbuild's ESM output.
//
// esbuild has no refresh transform, but its output is very regular: top-level declarations start at column 0
// (`function X(`, `var X = `), and with every import external the exports end up in one trailing `export { … }`
// clause. That is enough to register each capitalized top-level binding with react-refresh and to give it a hook
// signature (the hook calls in its body), which is what decides whether state is kept or the component remounts.
// The registration code is appended (imports are hoisted), so source maps of the original lines stay valid.

export const REFRESH_RUNTIME_URL = '/@cresslet/react-refresh'
export const REFRESH_UTILS_URL = '/@cresslet/refresh'
/** Preact: the same registration pass, against prefresh (@prefresh/core, served with its `preact` import shared). */
export const PREFRESH_CORE_URL = '/@cresslet/prefresh-core'
export const PREFRESH_UTILS_URL = '/@cresslet/prefresh'

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

/**
 * `utilsUrl`: the registration module (React's, or prefresh's). `hot`: the module's `import.meta.hot` binding; a
 * boundary then accepts itself through it (Preact), flushing prefresh or invalidating when its exports changed.
 */
export function refreshTransform(code: string, id: string, utilsUrl = REFRESH_UTILS_URL, hot?: string): RefreshResult {
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
  // m is undefined when the update failed (its error is on the overlay)
  if (boundary && hot) tail.push(`${hot}.accept((m) => { if (!m) return; if (${ns}.canRefresh(${JSON.stringify(id)}, m)) ${ns}.flush(); else ${hot}.invalidate(); });`)
  const add = `\nimport * as ${ns} from ${JSON.stringify(utilsUrl)};\n${tail.join('\n')}\n`
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
  const next = Object.keys(mod).sort().map((k) => [k, R.getFamilyByType(mod[k]), mod[k]]);
  const prev = shapes.get(id);
  shapes.set(id, next);
  // an export with no known family (unregistered component) can't be refreshed in place: a new value is a change
  if (prev && (prev.length !== next.length || prev.some(([k, f, v], i) => next[i][0] !== k || next[i][1] !== f || (!f && next[i][2] !== v)))) shapeChanged.add(id);
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

/**
 * Browser module served at PREFRESH_UTILS_URL (loaded first by the HTML, so prefresh hooks Preact's options before the
 * app renders): the registration API refreshTransform emits, over prefresh's `self.__PREFRESH__`. Boundaries
 * accept themselves through `import.meta.hot` and call `flush()` (or invalidate when their exports changed).
 */
export function prefreshUtilsCode(): string {
  return `import ${JSON.stringify(PREFRESH_CORE_URL)};
const P = self.__PREFRESH__;
// a signature before register(): prefresh keeps the first one it gets for a type
const ids = new WeakMap();
export function register(type, id, key, getHooks) {
  if (typeof type !== 'function') return;
  P.sign(type, key, false, getHooks, 'begin');
  P.register(type, id);
  ids.set(type, id);
}
export function sign(fn, key, getHooks) {
  if (typeof fn === 'function') P.sign(fn, key, false, getHooks, 'begin');
}
const shapes = new Map();
const shapeChanged = new Set();
/** Record a boundary's exports (name -> registration id); added/removed exports or one re-pointed to another component can't hot-update. */
export function exportsOf(id, mod) {
  const next = Object.keys(mod).sort().map((k) => [k, ids.get(mod[k]), mod[k]]);
  const prev = shapes.get(id);
  shapes.set(id, next);
  if (prev && (prev.length !== next.length || prev.some(([k, r, v], i) => next[i][0] !== k || next[i][1] !== r || (!r && next[i][2] !== v)))) shapeChanged.add(id);
  else shapeChanged.delete(id);
}
const isComponent = (v) => typeof v === 'function' && /^[A-Z]/.test(v.displayName || v.name || '');
/** Whether a boundary's re-run can be applied in place (see exportsOf); else its importers must update. */
export function canRefresh(id, mod) {
  const keys = Object.keys(mod || {});
  return !shapeChanged.has(id) && keys.length > 0 && keys.every((k) => isComponent(mod[k]));
}
/** Swap every component registered again since the last flush; a changed hook signature resets its state. */
export function flush() {
  const pending = [...P.getPendingUpdates()];
  P.flush();
  for (const [prev, next] of pending) {
    const a = P.getSignature(prev) || {};
    const b = P.getSignature(next) || {};
    P.replaceComponent(prev, next, a.key !== b.key || P.computeKey(a) !== P.computeKey(b) || !!b.forceReset);
  }
}
`
}

/** prefresh's runtime (bundled with \`preact\` external) with its imports pointed at the app's optimized Preact. */
export function prefreshCoreModule(bundle: string): string {
  return bundle.replace(/(\bfrom\s*|\bimport\s*)(["'])preact\2/g, '$1"/@modules/preact"')
}

/** Wrap react-refresh's CJS runtime as an ES module. */
export function refreshRuntimeModule(cjs: string): string {
  return `var exports = {}, process = { env: { NODE_ENV: "development" } };\n${cjs}\nexport default exports;\n`
}
