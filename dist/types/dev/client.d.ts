/**
 * Point the active `<link rel=stylesheet>`s for `pathname` at `href`. Each active link has at most one pending
 * replacement (a newer edit supersedes it); the active link goes only once its replacement has loaded, and stays if
 * the replacement fails. Returns false when the page has no such link. Plain JS: inlined into the client.
 */
export declare const SWAP_LINKS = "function swapLinks(doc, pathname, href) {\n  const links = [...doc.querySelectorAll('link[rel=\"stylesheet\"]')].filter((l) => !l.__cressletPending && new URL(l.href, doc.baseURI).pathname === pathname);\n  if (!links.length) return false;\n  for (const l of links) {\n    if (l.__cressletNext) l.__cressletNext.remove();\n    const next = l.cloneNode();\n    next.__cressletPending = true;\n    next.href = href;\n    l.__cressletNext = next;\n    next.onload = () => {\n      if (l.__cressletNext !== next) return;\n      next.__cressletPending = false;\n      l.remove();\n    };\n    next.onerror = () => {\n      if (l.__cressletNext === next) l.__cressletNext = null;\n      next.remove();\n    };\n    l.after(next);\n  }\n  return true;\n}";
export declare function clientCode(channel: string, prefix: string): string;
export declare function styleModule(css: string, id: string, exportsCode?: string): string;
export declare function errorModule(message: string): string;
