// Browser-side HMR / live-reload + error overlay client, served at /@cresslet/client.

/**
 * Point the active `<link rel=stylesheet>`s for `pathname` at `href`. Each active link has at most one pending
 * replacement (a newer edit supersedes it); the active link goes only once its replacement has loaded, and stays if
 * the replacement fails. Returns false when the page has no such link. Plain JS: inlined into the client.
 */
export const SWAP_LINKS = `function swapLinks(doc, pathname, href) {
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter((l) => !l.__cressletPending && new URL(l.href, doc.baseURI).pathname === pathname);
  if (!links.length) return false;
  for (const l of links) {
    if (l.__cressletNext) l.__cressletNext.remove();
    const next = l.cloneNode();
    next.__cressletPending = true;
    next.href = href;
    l.__cressletNext = next;
    next.onload = () => {
      if (l.__cressletNext !== next) return;
      next.__cressletPending = false;
      l.remove();
    };
    next.onerror = () => {
      if (l.__cressletNext === next) l.__cressletNext = null;
      next.remove();
    };
    l.after(next);
  }
  return true;
}`

export function clientCode(channel: string, prefix: string): string {
  return `const CH = ${JSON.stringify(channel)};
const PREFIX = ${JSON.stringify(prefix)};
let overlay;
export function showOverlay(msg) {
  if (typeof document === 'undefined') return;
  if (!overlay) {
    overlay = document.createElement('cresslet-error-overlay');
    const root = overlay.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.66);display:flex;align-items:flex-start;justify-content:center;font:13px/1.5 ui-monospace,Menlo,monospace}'
      + '.box{margin:6vh 16px;max-width:960px;width:100%;max-height:80vh;overflow:auto;background:#181818;color:#eee;border-top:6px solid #ff5555;border-radius:6px;padding:20px 24px;box-shadow:0 10px 40px #000a}'
      + 'h1{font-size:15px;color:#ff7b7b;margin:0 0 12px}pre{white-space:pre-wrap;margin:0}button{float:right;background:none;border:1px solid #555;color:#ccc;border-radius:4px;cursor:pointer;padding:2px 8px}</style>'
      + '<div class="box"><button>close</button><h1>Error</h1><pre></pre></div>';
    root.querySelector('button').onclick = () => { overlay.remove(); };
  }
  overlay.shadowRoot.querySelector('pre').textContent = String(msg);
  if (!overlay.isConnected) (document.body || document.documentElement).appendChild(overlay);
}
export function clearOverlay() { overlay?.remove(); }
window.__cresslet_overlay = showOverlay;
// navigate via the preview prefix rather than location.reload(): works even when the browser can't
// attribute a clean (prefix-stripped) URL to this preview
function reload() { location.replace(location.pathname.startsWith(PREFIX + '/') ? location.href : PREFIX + location.pathname + location.search + location.hash); }

// ---- HMR ----
// An error outside an HMR update (failed initial load, uncaught runtime error) may have left the page half-initialised:
// the next change then does a full reload instead of a hot update.
let updating = 0;
let stale = false;
/** Called by modules that failed to transform. */
export function moduleError(msg) {
  if (!updating) stale = true;
  showOverlay(msg);
}
${SWAP_LINKS}

// ---- import.meta.hot (Vite-compatible subset: accept, dispose, data, invalidate) ----
/** module URL -> accept callbacks registered by its current instance ({ deps: URLs, fn(modules) }) */
const hotAccepts = new Map();
const hotDisposers = new Map();
const hotData = new Map();
/** The hot context of one evaluation of module "url" (its path, no query): each re-run registers its callbacks again. */
export function createHotContext(url) {
  if (!hotData.has(url)) hotData.set(url, {});
  const accepts = [];
  hotAccepts.set(url, accepts);
  hotDisposers.delete(url);
  return {
    get data() { return hotData.get(url); },
    accept(deps, cb) {
      if (deps === undefined || typeof deps === 'function') accepts.push({ deps: [url], fn: ([m]) => deps && deps(m) });
      else if (typeof deps === 'string') accepts.push({ deps: [deps], fn: ([m]) => cb && cb(m) });
      else accepts.push({ deps: [...deps], fn: (mods) => cb && cb(mods) });
    },
    dispose(cb) { hotDisposers.set(url, cb); },
    /** This module can't take the update: its importers are updated instead (or the page reloads). Only during an update. */
    invalidate(message) {
      if (!updating) return;
      if (message) console.debug('[cresslet] invalidate', url, message);
      fetch('/@cresslet/invalidate?path=' + encodeURIComponent(url) + '&batch=' + batch).then((r) => { if (!r.ok) reload(); }, reload);
    },
    // not implemented: no-ops, so code written for Vite (\`if (import.meta.hot) import.meta.hot.on(...)\`) still runs
    on() {},
    off() {},
    send() {},
  };
}
const pathOf = (u) => u.split('?')[0];
const stamped = (u, t) => u + (u.includes('?') ? '&' : '?') + 't=' + t;
/** module path -> stamp of the copy an update loaded (an invalidation hands importers that copy again: no dispose) */
const hotLoaded = new Map();
/** The accept callbacks of boundary "u.url" that take "u.accepted", from the instance that is on the page now. */
const callbacksFor = (u) => (hotAccepts.get(u.url) || []).filter((c) => c.deps.some((d) => pathOf(d) === u.accepted));
/** Dispose the accepted modules of a batch, each once, before anything in it is imported (a fresh copy may register its own). */
async function disposeHot(updates) {
  const done = new Set();
  for (const u of updates) {
    if (u.kind !== 'hot' || done.has(u.accepted) || hotLoaded.get(u.accepted) === u.t) continue;
    done.add(u.accepted);
    const dispose = hotDisposers.get(u.accepted);
    if (dispose) await dispose(hotData.get(u.accepted));
  }
}
/**
 * Hand boundary "u.url"'s callbacks ("cbs", snapshot before the batch ran) the new copy of "u.accepted", imported with
 * the URL each accept() named (its flags: \`?raw\`, \`?import\`), once per batch ("loading"). A failed import (a compile
 * error) gives them undefined, as in Vite, and is rethrown for the overlay. False: no callback took it.
 */
async function applyHot(u, cbs, loading) {
  if (!cbs.length) return false; // the accept call didn't run on this page
  let failed;
  for (const c of cbs) {
    const mods = [];
    for (const d of c.deps) {
      if (pathOf(d) !== u.accepted) {
        mods.push(undefined);
        continue;
      }
      const href = stamped(d, u.t);
      if (!loading.has(href)) loading.set(href, import(href));
      try {
        mods.push(await loading.get(href));
        hotLoaded.set(u.accepted, u.t);
      } catch (err) {
        failed = err;
        mods.push(undefined);
      }
    }
    try {
      await c.fn(mods);
    } catch (err) {
      if (!failed) throw err;
      console.debug('[cresslet] accept callback after a failed update:', err); // the update's own error is the one to show
    }
  }
  if (failed) throw failed;
  return true;
}

let queue = Promise.resolve();
/** The update batch being applied (the server only takes invalidate() for the batch that re-ran the module). */
let batch = 0;
async function applyUpdates(updates, id) {
  if (stale) return reload();
  updating++;
  batch = id;
  try {
    let refresh = false;
    let failed;
    const hotCbs = updates.map((u) => (u.kind === 'hot' ? callbacksFor(u) : null));
    const loading = new Map();
    await disposeHot(updates);
    for (const [i, u] of updates.entries()) {
      const target = u.kind === 'hot' ? u.accepted : u.url;
      const url = target + (target.includes('?') ? '&' : '?') + 't=' + u.t;
      if (u.kind === 'css-link') {
        if (!swapLinks(document, u.url, url)) return reload();
        continue;
      }
      if (u.kind === 'hot') {
        try {
          if (!(await applyHot(u, hotCbs[i], loading))) return reload();
        } catch (err) {
          failed = err;
        }
        continue;
      }
      // one failing boundary (e.g. a syntax error) must not hold back the others in this batch;
      // the server re-sends it once it is fixed
      let mod;
      try {
        mod = await import(url);
      } catch (err) {
        failed = err;
        continue;
      }
      if (u.kind === 'js') {
        const rt = await import('/@cresslet/refresh');
        // added/removed exports, or a default that now is another component: importers hold the old bindings
        if (!rt.isBoundary(mod) || rt.exportsChanged(u.url)) return reload();
        refresh = true;
      }
    }
    if (refresh) (await import('/@cresslet/refresh')).performRefresh();
    if (failed) throw failed;
    clearOverlay();
    console.debug('[cresslet] hot updated', updates.map((u) => u.url).join(', '));
  } catch (err) {
    showOverlay((err && err.stack) || String(err));
  } finally {
    updating--;
  }
}

const bc = new BroadcastChannel(CH);
bc.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'reload') reload();
  else if (m.type === 'update') queue = queue.then(() => applyUpdates(m.updates, m.batch));
  else if (m.type === 'error') showOverlay(m.message);
  else if (m.type === 'clear') clearOverlay();
};
window.addEventListener('error', (e) => {
  if (!updating) stale = true;
  const msg = (e.error && e.error.stack) || e.message;
  // a module that failed to transform breaks linking of its importers (browser-specific messages);
  // prefer the dev server's pending transform error when there is one
  fetch('/@cresslet/last-error').then((r) => r.text()).then((t) => showOverlay(t || msg), () => showOverlay(msg));
});
// an error the server hit before this client was listening (e.g. a <link> stylesheet that failed to process)
fetch('/@cresslet/last-error').then((r) => r.text()).then((t) => { if (t) showOverlay(t); }, () => {});
window.addEventListener('unhandledrejection', (e) => showOverlay((e.reason && e.reason.stack) || String(e.reason)));
`
}

export function styleModule(css: string, id: string, exportsCode = ''): string {
  return `const id = ${JSON.stringify(id)};
let el = document.querySelector('style[data-cresslet-id="' + id + '"]');
if (!el) { el = document.createElement('style'); el.setAttribute('data-cresslet-id', id); document.head.appendChild(el); }
el.textContent = ${JSON.stringify(css)};
${exportsCode || 'export default ' + JSON.stringify(css) + ';'}
`
}

export function errorModule(message: string): string {
  return `import { moduleError } from '/@cresslet/client';
const msg = ${JSON.stringify(message)};
moduleError(msg);
throw new Error(msg);
`
}
