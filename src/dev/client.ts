// Browser-side HMR / live-reload + error overlay client, served at /@cresslet/client.

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
let queue = Promise.resolve();
async function applyUpdates(updates) {
  if (stale) return reload();
  updating++;
  try {
    let refresh = false;
    for (const u of updates) {
      const url = u.url + (u.url.includes('?') ? '&' : '?') + 't=' + u.t;
      if (u.kind === 'css-link') {
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => new URL(l.href, location.href).pathname === u.url);
        if (!links.length) return reload();
        for (const l of links) {
          // swap in a fresh <link> and drop the old one once it has loaded (no flash of unstyled content)
          const next = l.cloneNode();
          next.href = url;
          next.onload = next.onerror = () => l.remove();
          l.after(next);
        }
        continue;
      }
      const mod = await import(url);
      if (u.kind === 'js') {
        const rt = await import('/@cresslet/refresh');
        if (!rt.isBoundary(mod)) return reload();
        refresh = true;
      }
    }
    if (refresh) (await import('/@cresslet/refresh')).performRefresh();
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
  else if (m.type === 'update') queue = queue.then(() => applyUpdates(m.updates));
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
