// Tiny HTML tag scanner/rewriter for index.html (no full parser needed).

export interface Tag {
  name: string
  start: number
  end: number
  raw: string
  attrs: Record<string, string>
}

const TAG_RE = /<(script|link|img|source|video|audio)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi

export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  let m
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  return out
}

export function findTags(html: string): Tag[] {
  const tags: Tag[] = []
  // skip comments
  const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(masked))) {
    tags.push({ name: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length, raw: html.slice(m.index, m.index + m[0].length), attrs: parseAttrs(m[2]) })
  }
  return tags
}

export const isLocalRef = (u: string): boolean => !!u && !/^(https?:|data:|blob:|mailto:|#|\/\/)/i.test(u) && !u.startsWith('%')

/** `src` of local `<script type="module" src>` tags. */
export function findModuleScripts(html: string): string[] {
  return findTags(html)
    .filter((t) => t.name === 'script' && t.attrs.type === 'module' && isLocalRef(t.attrs.src ?? ''))
    .map((t) => t.attrs.src)
}

/** Replace one attribute value inside a raw tag. */
export function setAttr(raw: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, 'i')
  return re.test(raw) ? raw.replace(re, `$1"${value}"`) : raw.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"${end}`)
}

export interface HtmlEdit {
  start: number
  end: number
  text: string
}

export function applyEdits(html: string, edits: HtmlEdit[]): string {
  let out = html
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** Insert markup right before </head> (or at the start). */
export function injectHead(html: string, markup: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${markup}\n  </head>`)
  return markup + html
}

export interface BuildRewriteInput {
  /** script src -> emitted js url */
  scripts: Record<string, string>
  /** stylesheet href -> emitted css url */
  styles: Record<string, string>
  /** other asset refs -> emitted url */
  assets: Record<string, string>
  /** css emitted for script entries, to be linked */
  extraCss: string[]
  /** modulepreload hints */
  preload?: string[]
}

/** Rewrite index.html for production output. */
export function rewriteHtmlForBuild(html: string, r: BuildRewriteInput): string {
  const edits: HtmlEdit[] = []
  for (const t of findTags(html)) {
    if (t.name === 'script' && t.attrs.src && r.scripts[t.attrs.src]) {
      let raw = setAttr(t.raw, 'src', r.scripts[t.attrs.src])
      if (!/\scrossorigin\b/i.test(raw)) raw = raw.replace(/<script/i, '<script crossorigin')
      edits.push({ start: t.start, end: t.end, text: raw })
    } else if (t.name === 'link' && t.attrs.href && (r.styles[t.attrs.href] || r.assets[t.attrs.href])) {
      edits.push({ start: t.start, end: t.end, text: setAttr(t.raw, 'href', r.styles[t.attrs.href] ?? r.assets[t.attrs.href]) })
    } else if ((t.name === 'img' || t.name === 'source' || t.name === 'video' || t.name === 'audio') && t.attrs.src && r.assets[t.attrs.src]) {
      edits.push({ start: t.start, end: t.end, text: setAttr(t.raw, 'src', r.assets[t.attrs.src]) })
    }
  }
  let out = applyEdits(html, edits)
  const head = [
    ...(r.preload ?? []).map((p) => `<link rel="modulepreload" crossorigin href="${p}">`),
    ...r.extraCss.map((c) => `<link rel="stylesheet" crossorigin href="${c}">`),
  ]
  if (head.length) out = injectHead(out, head.map((h) => '  ' + h).join('\n'))
  return out
}

/** Short stable content hash (FNV-1a, base36). */
export function contentHash(data: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193)
    h2 = Math.imul(h2 ^ data[i], 0x5bd1e995)
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 8)
}
