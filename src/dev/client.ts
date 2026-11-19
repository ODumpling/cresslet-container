// Browser-side live-reload + error overlay client, served at /@clover/client.

export function clientCode(channel: string): string {
  return `const CH = ${JSON.stringify(channel)};
let overlay;
export function showOverlay(msg) {
  if (typeof document === 'undefined') return;
  if (!overlay) {
    overlay = document.createElement('clover-error-overlay');
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
window.__clover_overlay = showOverlay;
const bc = new BroadcastChannel(CH);
bc.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'reload') location.reload();
  else if (m.type === 'error') showOverlay(m.message);
  else if (m.type === 'clear') clearOverlay();
};
window.addEventListener('error', (e) => showOverlay((e.error && e.error.stack) || e.message));
window.addEventListener('unhandledrejection', (e) => showOverlay((e.reason && e.reason.stack) || String(e.reason)));
`
}

export function styleModule(css: string, id: string, exportsCode = ''): string {
  return `const id = ${JSON.stringify(id)};
let el = document.querySelector('style[data-clover-id="' + id + '"]');
if (!el) { el = document.createElement('style'); el.setAttribute('data-clover-id', id); document.head.appendChild(el); }
el.textContent = ${JSON.stringify(css)};
${exportsCode || 'export default ' + JSON.stringify(css) + ';'}
`
}

export function errorModule(message: string): string {
  return `import { showOverlay } from '/@clover/client';
const msg = ${JSON.stringify(message)};
showOverlay(msg);
throw new Error(msg);
`
}
