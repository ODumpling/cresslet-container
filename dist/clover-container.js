var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err2) => function() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __commonJS = (cb, mod) => function() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
  mod
));

// src/path.ts
function normalizeParts(parts, allowAboveRoot) {
  let out = [];
  for (let p of parts)
    !p || p === "." || (p === ".." ? out.length && out[out.length - 1] !== ".." ? out.pop() : allowAboveRoot && out.push("..") : out.push(p));
  return out;
}
function isAbsolute(p) {
  return p.startsWith("/");
}
function normalize(p) {
  if (!p) return ".";
  let abs2 = isAbsolute(p), trailing = p.endsWith("/"), res = normalizeParts(p.split("/"), !abs2).join("/");
  return !res && !abs2 && (res = "."), res && trailing && (res += "/"), (abs2 ? "/" : "") + res;
}
function join(...parts) {
  let joined = parts.filter((p) => p).join("/");
  return joined ? normalize(joined) : ".";
}
function resolve(...parts) {
  let res = "";
  for (let i = parts.length - 1; i >= 0 && !isAbsolute(res); i--) {
    let p = parts[i];
    p && (res = res ? `${p}/${res}` : p);
  }
  return isAbsolute(res) || (res = `${cwdFn()}/${res}`), "/" + normalizeParts(res.split("/"), !1).join("/");
}
function dirname(p) {
  if (!p) return ".";
  let s = p.replace(/\/+$/, "");
  if (!s) return "/";
  let i = s.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : s.slice(0, i);
}
function basename(p, ext) {
  let s = p.replace(/\/+$/, ""), b = s.slice(s.lastIndexOf("/") + 1);
  return ext && b.endsWith(ext) && b !== ext && (b = b.slice(0, -ext.length)), b;
}
function extname(p) {
  let b = basename(p), i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}
function relative(from, to) {
  let f = resolve(from).split("/").filter(Boolean), t = resolve(to).split("/").filter(Boolean), i = 0;
  for (; i < f.length && i < t.length && f[i] === t[i]; ) i++;
  return [...Array(f.length - i).fill(".."), ...t.slice(i)].join("/");
}
function parse(p) {
  let root = isAbsolute(p) ? "/" : "", base = basename(p), ext = extname(p), d = dirname(p);
  return { root, dir: d === "." && !p.includes("/") ? "" : d, base, ext, name: ext ? base.slice(0, -ext.length) : base };
}
function format(o) {
  let dir = o.dir || o.root || "", base = o.base || (o.name || "") + (o.ext || "");
  return dir ? dir === o.root ? dir + base : `${dir}/${base}` : base;
}
function toNamespacedPath(p) {
  return p;
}
var cwdFn, path, init_path = __esm({
  "src/path.ts"() {
    "use strict";
    cwdFn = () => "/";
    path = {
      sep: "/",
      delimiter: ":",
      isAbsolute,
      normalize,
      join,
      resolve,
      dirname,
      basename,
      extname,
      relative,
      parse,
      format,
      toNamespacedPath,
      posix: void 0,
      win32: void 0
    };
    path.posix = path;
    path.win32 = path;
  }
});

// src/vfs.ts
function describe(code) {
  return {
    ENOENT: "no such file or directory",
    EEXIST: "file already exists",
    ENOTDIR: "not a directory",
    EISDIR: "illegal operation on a directory",
    ENOTEMPTY: "directory not empty",
    EINVAL: "invalid argument",
    ELOOP: "too many symbolic links encountered"
  }[code] ?? code;
}
function makeStats(n) {
  let size = n.type === "file" ? n.data.byteLength : n.type === "dir" ? 4096 : n.target.length;
  return {
    type: n.type,
    size,
    mtimeMs: n.mtime,
    ctimeMs: n.ctime,
    mode: n.type === "dir" ? 16877 : n.type === "symlink" ? 41471 : 33188,
    isFile: () => n.type === "file",
    isDirectory: () => n.type === "dir",
    isSymbolicLink: () => n.type === "symlink"
  };
}
var FsError, ERRNO, enc, dec, toBytes, toText, VFS, init_vfs = __esm({
  "src/vfs.ts"() {
    "use strict";
    init_path();
    FsError = class extends Error {
      constructor(code, op, path2) {
        super(`${code}: ${describe(code)}, ${op} '${path2}'`);
        this.code = code;
        this.path = path2;
        this.name = "Error";
      }
      code;
      path;
      get errno() {
        return ERRNO[this.code] ?? -1;
      }
      get syscall() {
        return this.message.split(", ")[1]?.split(" ")[0] ?? "";
      }
    }, ERRNO = { ENOENT: -2, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, ENOTEMPTY: -39, EINVAL: -22, ELOOP: -40 };
    enc = new TextEncoder(), dec = new TextDecoder(), toBytes = (d) => typeof d == "string" ? enc.encode(d) : d, toText = (d) => dec.decode(d);
    VFS = class {
      root = { type: "dir", children: /* @__PURE__ */ new Map(), mtime: Date.now(), ctime: Date.now() };
      watchers = /* @__PURE__ */ new Set();
      // ---- lookup ----
      split(p) {
        return normalize(p.startsWith("/") ? p : "/" + p).split("/").filter(Boolean);
      }
      /** Resolve a path to its node. followLast=false returns a symlink itself. */
      lookup(p, followLast = !0, depth = 0) {
        if (depth > 32) throw new FsError("ELOOP", "stat", p);
        let parts = this.split(p), cur = this.root;
        for (let i = 0; i < parts.length; i++) {
          if (cur.type === "symlink" && (cur = this.lookup(cur.target, !0, depth + 1)), !cur || cur.type !== "dir") return;
          let next = cur.children.get(parts[i]);
          if (!next) return;
          if (next.type === "symlink" && (i < parts.length - 1 || followLast)) {
            let target = next.target.startsWith("/") ? next.target : "/" + parts.slice(0, i).join("/") + "/" + next.target, r = this.lookup(target, !0, depth + 1);
            if (!r) return;
            cur = r;
          } else cur = next;
        }
        return cur;
      }
      parentOf(p, op) {
        let path2 = normalize("/" + this.split(p).join("/"));
        if (path2 === "/") throw new FsError("EINVAL", op, p);
        let dir = this.lookup(dirname(path2));
        if (!dir) throw new FsError("ENOENT", op, p);
        if (dir.type !== "dir") throw new FsError("ENOTDIR", op, p);
        return { dir, name: basename(path2), path: path2 };
      }
      // ---- queries ----
      exists(p) {
        return !!this.lookup(p);
      }
      stat(p) {
        let n = this.lookup(p);
        if (!n) throw new FsError("ENOENT", "stat", p);
        return makeStats(n);
      }
      lstat(p) {
        let n = this.lookup(p, !1);
        if (!n) throw new FsError("ENOENT", "lstat", p);
        return makeStats(n);
      }
      isFile(p) {
        return this.lookup(p)?.type === "file";
      }
      isDir(p) {
        return this.lookup(p)?.type === "dir";
      }
      readFile(p) {
        let n = this.lookup(p);
        if (!n) throw new FsError("ENOENT", "open", p);
        if (n.type === "dir") throw new FsError("EISDIR", "read", p);
        return n.data;
      }
      readText(p) {
        return toText(this.readFile(p));
      }
      /** Returns file text or null (no throw). */
      tryReadText(p) {
        let n = this.lookup(p);
        return n?.type === "file" ? toText(n.data) : null;
      }
      readdir(p) {
        return this.readdirEntries(p).map((d) => d.name);
      }
      readdirEntries(p) {
        let n = this.lookup(p);
        if (!n) throw new FsError("ENOENT", "scandir", p);
        if (n.type !== "dir") throw new FsError("ENOTDIR", "scandir", p);
        return [...n.children.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, c]) => ({
          name,
          isFile: () => c.type === "file",
          isDirectory: () => c.type === "dir",
          isSymbolicLink: () => c.type === "symlink"
        }));
      }
      readlink(p) {
        let n = this.lookup(p, !1);
        if (!n) throw new FsError("ENOENT", "readlink", p);
        if (n.type !== "symlink") throw new FsError("EINVAL", "readlink", p);
        return n.target;
      }
      realpath(p) {
        let parts = this.split(p), real = "";
        for (let i = 0; i < parts.length; i++) {
          let cand = real + "/" + parts[i], n = this.lookup(cand, !1);
          if (!n) throw new FsError("ENOENT", "realpath", p);
          n.type === "symlink" ? real = this.realpath(n.target.startsWith("/") ? n.target : (real || "/") + "/" + n.target) : real = cand;
        }
        return real || "/";
      }
      // ---- mutations ----
      mkdir(p, opts = {}) {
        let parts = this.split(p), cur = this.root;
        for (let i = 0; i < parts.length; i++) {
          let sub = "/" + parts.slice(0, i + 1).join("/"), next = cur.children.get(parts[i]);
          if (next?.type === "symlink" && (next = this.lookup(sub)), next) {
            if (i === parts.length - 1 && !opts.recursive) throw new FsError("EEXIST", "mkdir", p);
          } else {
            if (!opts.recursive && i < parts.length - 1) throw new FsError("ENOENT", "mkdir", p);
            let now = Date.now();
            next = { type: "dir", children: /* @__PURE__ */ new Map(), mtime: now, ctime: now }, cur.children.set(parts[i], next), cur.mtime = now, this.emit(sub, "rename");
          }
          if (next.type !== "dir") throw new FsError(i === parts.length - 1 ? "EEXIST" : "ENOTDIR", "mkdir", p);
          cur = next;
        }
      }
      writeFile(p, data, opts = {}) {
        opts.mkdirp && this.mkdir(dirname(normalize("/" + this.split(p).join("/"))), { recursive: !0 });
        let { dir, name, path: path2 } = this.parentOf(p, "open"), existing = dir.children.get(name);
        if (existing?.type === "symlink" && (existing = this.lookup(path2)), existing?.type === "dir") throw new FsError("EISDIR", "open", p);
        let bytes = toBytes(data), now = Date.now();
        if (existing?.type === "file") {
          if (opts.append) {
            let merged = new Uint8Array(existing.data.byteLength + bytes.byteLength);
            merged.set(existing.data), merged.set(bytes, existing.data.byteLength), bytes = merged;
          }
          existing.data = bytes, existing.mtime = now, this.emit(path2, "change");
        } else
          dir.children.set(name, { type: "file", data: bytes, mtime: now, ctime: now }), dir.mtime = now, this.emit(path2, "rename");
      }
      symlink(target, p) {
        let { dir, name, path: path2 } = this.parentOf(p, "symlink");
        if (dir.children.has(name)) throw new FsError("EEXIST", "symlink", p);
        let now = Date.now();
        dir.children.set(name, { type: "symlink", target, mtime: now, ctime: now }), this.emit(path2, "rename");
      }
      rm(p, opts = {}) {
        let path2 = normalize("/" + this.split(p).join("/"));
        if (path2 === "/") {
          if (!opts.recursive) throw new FsError("EISDIR", "rm", p);
          for (let k of [...this.root.children.keys()]) this.rm("/" + k, opts);
          return;
        }
        let parent = this.lookup(dirname(path2)), name = basename(path2), n = parent?.type === "dir" ? parent.children.get(name) : void 0;
        if (!n || parent?.type !== "dir") {
          if (opts.force) return;
          throw new FsError("ENOENT", "rm", p);
        }
        if (n.type === "dir" && n.children.size && !opts.recursive) throw new FsError("ENOTEMPTY", "rmdir", p);
        n.type === "dir" && !opts.recursive && n.children.size, parent.children.delete(name), parent.mtime = Date.now(), this.emit(path2, "rename");
      }
      unlink(p) {
        let n = this.lookup(p, !1);
        if (!n) throw new FsError("ENOENT", "unlink", p);
        if (n.type === "dir") throw new FsError("EISDIR", "unlink", p);
        this.rm(p);
      }
      rmdir(p) {
        let n = this.lookup(p, !1);
        if (!n) throw new FsError("ENOENT", "rmdir", p);
        if (n.type !== "dir") throw new FsError("ENOTDIR", "rmdir", p);
        if (n.children.size) throw new FsError("ENOTEMPTY", "rmdir", p);
        this.rm(p);
      }
      rename(from, to) {
        let a = this.parentOf(from, "rename"), n = a.dir.children.get(a.name);
        if (!n) throw new FsError("ENOENT", "rename", from);
        let b = this.parentOf(to, "rename");
        if (b.path === a.path) return;
        if (n.type === "dir" && (b.path + "/").startsWith(a.path + "/")) throw new FsError("EINVAL", "rename", from);
        let existing = b.dir.children.get(b.name);
        if (existing?.type === "dir" && existing.children.size) throw new FsError("ENOTEMPTY", "rename", to);
        a.dir.children.delete(a.name), b.dir.children.set(b.name, n), a.dir.mtime = b.dir.mtime = Date.now(), this.emit(a.path, "rename"), this.emit(b.path, "rename");
      }
      copyFile(from, to) {
        this.writeFile(to, this.readFile(from).slice());
      }
      /** Recursively copy a file or directory. */
      cp(from, to) {
        if (this.stat(from).isDirectory()) {
          this.mkdir(to, { recursive: !0 });
          for (let name of this.readdir(from)) this.cp(`${from}/${name}`, `${to}/${name}`);
        } else this.copyFile(from, to);
      }
      utimes(p, mtime) {
        let n = this.lookup(p);
        if (!n) throw new FsError("ENOENT", "utime", p);
        n.mtime = mtime;
      }
      /** Walk all files under dir (absolute paths). */
      *walk(dir, skip) {
        let n = this.lookup(dir);
        if (!(!n || n.type !== "dir"))
          for (let [name, c] of n.children) {
            let p = dir === "/" ? `/${name}` : `${dir}/${name}`, isDir = c.type === "dir";
            skip?.(p, isDir) || (isDir ? yield* this.walk(p, skip) : yield p);
          }
      }
      // ---- watching ----
      watch(path2, opts, fn) {
        let w = { path: normalize("/" + this.split(path2).join("/")), recursive: !!opts.recursive, fn };
        return this.watchers.add(w), { close: () => {
          this.watchers.delete(w);
        } };
      }
      emit(path2, event) {
        for (let w of this.watchers) {
          let base = w.path === "/" ? "" : w.path;
          if (path2 === w.path) {
            w.fn(event, basename(path2));
            continue;
          }
          if (!path2.startsWith(base + "/")) continue;
          let rel = path2.slice(base.length + 1);
          if (!(!w.recursive && rel.includes("/")))
            try {
              w.fn(event, rel);
            } catch (e) {
              console.error(e);
            }
        }
      }
    };
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0", MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991, MAX_SAFE_COMPONENT_LENGTH = 16, MAX_SAFE_BUILD_LENGTH = 250, WHITESPACE_CHARACTERS = [
      "	",
      `
`,
      "\v",
      "\f",
      "\r",
      " ",
      "\xA0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200A",
      "\u2028",
      "\u2029",
      "\u202F",
      "\u205F",
      "\u3000",
      "\uFEFF"
    ], RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH: 256,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      WHITESPACE_CHARACTERS,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process == "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants(), debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [], safeRe = exports.safeRe = [], src = exports.src = [], safeSrc = exports.safeSrc = [], t = exports.t = {}, R = 0, LETTERDASHNUMBER = "[a-zA-Z0-9-]", safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ], makeSafeRegex = (value) => {
      for (let [token, max] of safeRegexReplacements)
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      return value;
    }, createToken = (name, value, isGlobal) => {
      let safe = makeSafeRegex(value), index = R++;
      debug(name, index, value), t[name] = index, src[index] = value, safeSrc[index] = safe, re[index] = new RegExp(value, isGlobal ? "g" : void 0), safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `(^|[^\\d])(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], !0);
    createToken("COERCERTLFULL", src[t.COERCEFULL], !0);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, !0);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, !0);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, !0);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: !0 }), emptyOpts = Object.freeze({}), parseOptions = (options) => options ? typeof options != "object" ? looseOption : options : emptyOpts;
    module.exports = parseOptions;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/, compareIdentifiers = (a, b) => {
      if (typeof a == "number" && typeof b == "number")
        return a === b ? 0 : a < b ? -1 : 1;
      let anum = numeric.test(a), bnum = numeric.test(b);
      return anum && bnum && (a = +a, b = +b), a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    }, rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug(), { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants(), { safeRe: re, t } = require_re(), parseOptions = require_parse_options(), { compareIdentifiers } = require_identifiers(), isPrereleaseIdentifier = (prerelease, identifier) => {
      let identifiers = identifier.split(".");
      if (identifiers.length > prerelease.length)
        return !1;
      for (let i = 0; i < identifiers.length; i++)
        if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0)
          return !1;
      return !0;
    }, SemVer = class _SemVer {
      constructor(version2, options) {
        if (options = parseOptions(options), version2 instanceof _SemVer) {
          if (version2.loose === !!options.loose && version2.includePrerelease === !!options.includePrerelease)
            return version2;
          version2 = version2.version;
        } else if (typeof version2 != "string")
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version2}".`);
        if (version2.length > MAX_LENGTH)
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        debug("SemVer", version2, options), this.options = options, this.loose = !!options.loose, this.includePrerelease = !!options.includePrerelease;
        let m = version2.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m)
          throw new TypeError(`Invalid Version: ${version2}`);
        if (this.raw = version2, this.major = +m[1], this.minor = +m[2], this.patch = +m[3], this.major > MAX_SAFE_INTEGER || this.major < 0)
          throw new TypeError("Invalid major version");
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0)
          throw new TypeError("Invalid minor version");
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0)
          throw new TypeError("Invalid patch version");
        m[4] ? this.prerelease = m[4].split(".").map((id) => {
          if (/^[0-9]+$/.test(id)) {
            let num = +id;
            if (num >= 0 && num < MAX_SAFE_INTEGER)
              return num;
          }
          return id;
        }) : this.prerelease = [], this.build = m[5] ? m[5].split(".") : [], this.format();
      }
      format() {
        return this.version = `${this.major}.${this.minor}.${this.patch}`, this.prerelease.length && (this.version += `-${this.prerelease.join(".")}`), this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        if (debug("SemVer.compare", this.version, this.options, other), !(other instanceof _SemVer)) {
          if (typeof other == "string" && other === this.version)
            return 0;
          other = new _SemVer(other, this.options);
        }
        return other.version === this.version ? 0 : this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        return other instanceof _SemVer || (other = new _SemVer(other, this.options)), this.major < other.major ? -1 : this.major > other.major ? 1 : this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : this.patch < other.patch ? -1 : this.patch > other.patch ? 1 : 0;
      }
      comparePre(other) {
        if (other instanceof _SemVer || (other = new _SemVer(other, this.options)), this.prerelease.length && !other.prerelease.length)
          return -1;
        if (!this.prerelease.length && other.prerelease.length)
          return 1;
        if (!this.prerelease.length && !other.prerelease.length)
          return 0;
        let i = 0;
        do {
          let a = this.prerelease[i], b = other.prerelease[i];
          if (debug("prerelease compare", i, a, b), a === void 0 && b === void 0)
            return 0;
          if (b === void 0)
            return 1;
          if (a === void 0)
            return -1;
          if (a === b)
            continue;
          return compareIdentifiers(a, b);
        } while (++i);
      }
      compareBuild(other) {
        other instanceof _SemVer || (other = new _SemVer(other, this.options));
        let i = 0;
        do {
          let a = this.build[i], b = other.build[i];
          if (debug("build compare", i, a, b), a === void 0 && b === void 0)
            return 0;
          if (b === void 0)
            return 1;
          if (a === void 0)
            return -1;
          if (a === b)
            continue;
          return compareIdentifiers(a, b);
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === !1)
            throw new Error("invalid increment argument: identifier is empty");
          if (identifier) {
            let match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier)
              throw new Error(`invalid identifier: ${identifier}`);
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0, this.patch = 0, this.minor = 0, this.major++, this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0, this.patch = 0, this.minor++, this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0, this.inc("patch", identifier, identifierBase), this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            this.prerelease.length === 0 && this.inc("patch", identifier, identifierBase), this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0)
              throw new Error(`version ${this.raw} is not a prerelease`);
            this.prerelease.length = 0;
            break;
          case "major":
            (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) && this.major++, this.minor = 0, this.patch = 0, this.prerelease = [];
            break;
          case "minor":
            (this.patch !== 0 || this.prerelease.length === 0) && this.minor++, this.patch = 0, this.prerelease = [];
            break;
          case "patch":
            this.prerelease.length === 0 && this.patch++, this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            let base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0)
              this.prerelease = [base];
            else {
              let i = this.prerelease.length;
              for (; --i >= 0; )
                typeof this.prerelease[i] == "number" && (this.prerelease[i]++, i = -2);
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === !1)
                  throw new Error("invalid increment argument: identifier already exists");
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === !1 && (prerelease = [identifier]), isPrereleaseIdentifier(this.prerelease, identifier)) {
                let prereleaseBase = this.prerelease[identifier.split(".").length];
                isNaN(prereleaseBase) && (this.prerelease = prerelease);
              } else
                this.prerelease = prerelease;
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        return this.raw = this.format(), this.build.length && (this.raw += `+${this.build.join(".")}`), this;
      }
    };
    module.exports = SemVer;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), parse3 = (version2, options, throwErrors = !1) => {
      if (version2 instanceof SemVer)
        return version2;
      try {
        return new SemVer(version2, options);
      } catch (er) {
        if (!throwErrors)
          return null;
        throw er;
      }
    };
    module.exports = parse3;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse3 = require_parse(), valid = (version2, options) => {
      let v = parse3(version2, options);
      return v ? v.version : null;
    };
    module.exports = valid;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/clean.js"(exports, module) {
    "use strict";
    var parse3 = require_parse(), clean = (version2, options) => {
      let s = parse3(version2.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/inc.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), inc = (version2, release, options, identifier, identifierBase) => {
      typeof options == "string" && (identifierBase = identifier, identifier = options, options = void 0);
      try {
        return new SemVer(
          version2 instanceof SemVer ? version2.version : version2,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch {
        return null;
      }
    };
    module.exports = inc;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/diff.js"(exports, module) {
    "use strict";
    var parse3 = require_parse(), diff = (version1, version2) => {
      let v1 = parse3(version1, null, !0), v2 = parse3(version2, null, !0), comparison = v1.compare(v2);
      if (comparison === 0)
        return null;
      let v1Higher = comparison > 0, highVersion = v1Higher ? v1 : v2, lowVersion = v1Higher ? v2 : v1, highHasPre = !!highVersion.prerelease.length;
      if (!!lowVersion.prerelease.length && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor)
          return "major";
        if (lowVersion.compareMain(highVersion) === 0)
          return lowVersion.minor && !lowVersion.patch ? "minor" : "patch";
      }
      let prefix2 = highHasPre ? "pre" : "";
      return v1.major !== v2.major ? prefix2 + "major" : v1.minor !== v2.minor ? prefix2 + "minor" : v1.patch !== v2.patch ? prefix2 + "patch" : "prerelease";
    };
    module.exports = diff;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/major.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), major = (a, loose) => new SemVer(a, loose).major;
    module.exports = major;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/minor.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), minor = (a, loose) => new SemVer(a, loose).minor;
    module.exports = minor;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/patch.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), patch = (a, loose) => new SemVer(a, loose).patch;
    module.exports = patch;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/prerelease.js"(exports, module) {
    "use strict";
    var parse3 = require_parse(), prerelease = (version2, options) => {
      let parsed = parse3(version2, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/rcompare.js"(exports, module) {
    "use strict";
    var compare = require_compare(), rcompare = (a, b, loose) => compare(b, a, loose);
    module.exports = rcompare;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare-loose.js"(exports, module) {
    "use strict";
    var compare = require_compare(), compareLoose = (a, b) => compare(a, b, !0);
    module.exports = compareLoose;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/compare-build.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), compareBuild = (a, b, loose) => {
      let versionA = new SemVer(a, loose), versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/sort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build(), sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/rsort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build(), rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare = require_compare(), gt = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/lt.js"(exports, module) {
    "use strict";
    var compare = require_compare(), lt = (a, b, loose) => compare(a, b, loose) < 0;
    module.exports = lt;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/eq.js"(exports, module) {
    "use strict";
    var compare = require_compare(), eq = (a, b, loose) => compare(a, b, loose) === 0;
    module.exports = eq;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/neq.js"(exports, module) {
    "use strict";
    var compare = require_compare(), neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/gte.js"(exports, module) {
    "use strict";
    var compare = require_compare(), gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/lte.js"(exports, module) {
    "use strict";
    var compare = require_compare(), lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/cmp.js"(exports, module) {
    "use strict";
    var eq = require_eq(), neq = require_neq(), gt = require_gt(), gte = require_gte(), lt = require_lt(), lte = require_lte(), cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          return typeof a == "object" && (a = a.version), typeof b == "object" && (b = b.version), a === b;
        case "!==":
          return typeof a == "object" && (a = a.version), typeof b == "object" && (b = b.version), a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/coerce.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), parse3 = require_parse(), { safeRe: re, t } = require_re(), coerce = (version2, options) => {
      if (version2 instanceof SemVer)
        return version2;
      if (typeof version2 == "number" && (version2 = String(version2)), typeof version2 != "string")
        return null;
      options = options || {};
      let match = null;
      if (!options.rtl)
        match = version2.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      else {
        let coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL], next;
        for (; (next = coerceRtlRegex.exec(version2)) && (!match || match.index + match[0].length !== version2.length); )
          (!match || next.index + next[0].length !== match.index + match[0].length) && (match = next), coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null)
        return null;
      let major = match[2], minor = match[3] || "0", patch = match[4] || "0", prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "", build2 = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse3(`${major}.${minor}.${patch}${prerelease}${build2}`, options);
    };
    module.exports = coerce;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/truncate.js
var require_truncate = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/truncate.js"(exports, module) {
    "use strict";
    var parse3 = require_parse(), constants = require_constants(), SemVer = require_semver(), truncate = (version2, truncation, options) => {
      if (!constants.RELEASE_TYPES.includes(truncation))
        return null;
      let clonedVersion = cloneInputVersion(version2, options);
      return clonedVersion && doTruncation(clonedVersion, truncation);
    }, cloneInputVersion = (version2, options) => {
      let versionStringToParse = version2 instanceof SemVer ? version2.version : version2;
      return parse3(versionStringToParse, options);
    }, doTruncation = (version2, truncation) => {
      if (isPrerelease(truncation))
        return version2.version;
      switch (version2.prerelease = [], truncation) {
        case "major":
          version2.minor = 0, version2.patch = 0;
          break;
        case "minor":
          version2.patch = 0;
          break;
      }
      return version2.format();
    }, isPrerelease = (type) => type.startsWith("pre");
    module.exports = truncate;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/lrucache.js"(exports, module) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3, this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        let value = this.map.get(key);
        if (value !== void 0)
          return this.map.delete(key), this.map.set(key, value), value;
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        if (!this.delete(key) && value !== void 0) {
          if (this.map.size >= this.max) {
            let firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/trim-comparator-whitespace.js
var require_trim_comparator_whitespace = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/internal/trim-comparator-whitespace.js"(exports, module) {
    "use strict";
    var {
      MAX_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      WHITESPACE_CHARACTERS
    } = require_constants(), whitespace = new Uint8Array(65536);
    for (let char of WHITESPACE_CHARACTERS)
      whitespace[char.charCodeAt(0)] = 1;
    var isWhitespace = (char) => char !== void 0 && whitespace[char.charCodeAt(0)] === 1, isVersionPrefix = (char) => char === "v" || char === "=" || isWhitespace(char), isDigit = (char) => char !== void 0 && char >= "0" && char <= "9", isLetter = (char) => char !== void 0 && (char >= "a" && char <= "z" || char >= "A" && char <= "Z"), isIdentifierCharacter = (char) => isDigit(char) || isLetter(char) || char === "-", isVersionStart = (char) => isDigit(char) || char === "x" || char === "X" || char === "*", findDigitsEndIndex = (range, start, limit, digitRuns) => {
      if (!isDigit(range[start]))
        return start;
      if (start >= digitRuns.start && start < digitRuns.end)
        return Math.min(start + limit, digitRuns.end);
      if (start >= digitRuns.previousStart && start < digitRuns.previousEnd)
        return Math.min(start + limit, digitRuns.previousEnd);
      let end = start + 1;
      for (; isDigit(range[end]); )
        end++;
      return digitRuns.previousStart = digitRuns.start, digitRuns.previousEnd = digitRuns.end, digitRuns.start = start, digitRuns.end = end, Math.min(start + limit, end);
    }, findVersionNumberEndIndex = (range, start, loose, digitRuns) => !loose && range[start] === "0" ? start + 1 : findDigitsEndIndex(range, start, loose ? MAX_LENGTH : MAX_LENGTH + 1, digitRuns), findPrereleaseIdentifierEndIndex = (range, start, loose, digitRuns) => {
      let digitsEnd = findDigitsEndIndex(range, start, MAX_LENGTH, digitRuns);
      if (isLetter(range[digitsEnd]) || range[digitsEnd] === "-") {
        let end = digitsEnd + 1, limit = end + MAX_SAFE_BUILD_LENGTH;
        for (; end < limit && isIdentifierCharacter(range[end]); )
          end++;
        return end;
      }
      return findVersionNumberEndIndex(range, start, loose, digitRuns);
    }, findPrereleaseEndIndex = (range, start, loose, digitRuns) => {
      let hyphen = range[start] === "-";
      if (!loose && !hyphen)
        return start;
      let identifierStart = start + (hyphen ? 1 : 0), end = findPrereleaseIdentifierEndIndex(range, identifierStart, loose, digitRuns);
      if (end === identifierStart) {
        if (!loose || !hyphen)
          return start;
        end = findPrereleaseIdentifierEndIndex(range, start, loose, digitRuns);
      }
      for (; range[end] === "."; ) {
        let next = findPrereleaseIdentifierEndIndex(range, end + 1, loose, digitRuns);
        if (next === end + 1)
          break;
        end = next;
      }
      return end;
    }, findBuildIdentifierEndIndex = (range, start) => {
      let end = start;
      for (; end - start < MAX_SAFE_BUILD_LENGTH && isIdentifierCharacter(range[end]); )
        end++;
      return end;
    }, findBuildEndIndex = (range, start) => {
      if (range[start] !== "+")
        return start;
      let end = findBuildIdentifierEndIndex(range, start + 1);
      if (end === start + 1)
        return start;
      for (; range[end] === "."; ) {
        let next = findBuildIdentifierEndIndex(range, end + 1);
        if (next === end + 1)
          break;
        end = next;
      }
      return end;
    }, findLooseFullVersionEndIndex = (range, start, digitRuns) => {
      let end = start;
      for (let component = 0; component < 3; component++) {
        let next = findVersionNumberEndIndex(range, end, !0, digitRuns);
        if (next === end)
          return start;
        if (end = next, component < 2) {
          if (range[end] !== ".")
            return start;
          end++;
        }
      }
      let prereleaseEnd = findPrereleaseEndIndex(range, end, !0, digitRuns);
      return findBuildEndIndex(range, prereleaseEnd);
    }, findPartialVersionComponentEndIndex = (range, start, digitRuns) => isDigit(range[start]) ? findVersionNumberEndIndex(range, start, !1, digitRuns) : isVersionStart(range[start]) ? start + 1 : start, findPartialVersionEndIndex = (range, start, digitRuns) => {
      let end = findPartialVersionComponentEndIndex(range, start, digitRuns);
      for (let component = 0; component < 2; component++) {
        if (range[end] !== ".")
          return end;
        let next = findPartialVersionComponentEndIndex(range, end + 1, digitRuns);
        if (next === end + 1)
          return end;
        end = next;
      }
      let prereleaseEnd = findPrereleaseEndIndex(range, end, !1, digitRuns);
      return findBuildEndIndex(range, prereleaseEnd);
    }, findVersionEndIndex = (range, start, digitRuns) => {
      let fullVersionEnd = findLooseFullVersionEndIndex(range, start, digitRuns);
      return fullVersionEnd !== start ? fullVersionEnd : findPartialVersionEndIndex(range, start, digitRuns);
    }, findRemovableWhitespaceIndex = (range, matchStart) => {
      let position = matchStart;
      return isWhitespace(range[position]) && position++, (range[position] === "<" || range[position] === ">") && position++, range[position] === "=" && position++, isWhitespace(range[position]) ? position : -1;
    }, trimComparatorWhitespace = (range) => {
      let result = "", copyFrom = 0, cursor = 0, digitRuns = { start: -1, end: -1, previousStart: -1, previousEnd: -1 };
      for (; cursor < range.length; ) {
        let matchStart = cursor;
        if (range[cursor] === "<" || range[cursor] === ">")
          cursor++;
        else if (!isVersionPrefix(range[cursor]) && !isVersionStart(range[cursor])) {
          cursor++;
          continue;
        }
        for (; cursor < range.length && isVersionPrefix(range[cursor]); )
          cursor++;
        if (!isVersionStart(range[cursor]))
          continue;
        let whitespacePosition = findRemovableWhitespaceIndex(range, matchStart);
        whitespacePosition !== -1 && (result += range.slice(copyFrom, whitespacePosition), copyFrom = whitespacePosition + 1), cursor = findVersionEndIndex(range, cursor, digitRuns);
      }
      return result + range.slice(copyFrom);
    };
    module.exports = trimComparatorWhitespace;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/range.js"(exports, module) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g, Range = class _Range {
      constructor(range, options) {
        if (options = parseOptions(options), range instanceof _Range)
          return range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease ? range : new _Range(range.raw, options);
        if (range instanceof Comparator)
          return this.raw = range.value, this.set = [[range]], this.formatted = void 0, this;
        if (this.options = options, this.loose = !!options.loose, this.includePrerelease = !!options.includePrerelease, this.raw = range.trim().replace(SPACE_CHARACTERS, " "), this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length), !this.set.length)
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        if (this.set.length > 1) {
          let first = this.set[0];
          if (this.set = this.set.filter((c) => !isNullSet(c[0])), this.set.length === 0)
            this.set = [first];
          else if (this.set.length > 1) {
            for (let c of this.set)
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            i > 0 && (this.formatted += "||");
            let comps = this.set[i];
            for (let k = 0; k < comps.length; k++)
              k > 0 && (this.formatted += " "), this.formatted += comps[k].toString().trim();
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        range = range.replace(BUILDSTRIPRE, "");
        let memoKey = ((this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE)) + ":" + range, cached = cache.get(memoKey);
        if (cached)
          return cached;
        let loose = this.options.loose, hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease)), debug("hyphen replace", range), range = trimComparatorWhitespace(range), debug("comparator trim", range), range = range.replace(re[t.TILDETRIM], tildeTrimReplace), debug("tilde trim", range), range = range.replace(re[t.CARETTRIM], caretTrimReplace), debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        loose && (rangeList = rangeList.filter((comp) => (debug("loose invalid filter", comp, this.options), !!comp.match(re[t.COMPARATORLOOSE])))), debug("range list", rangeList);
        let rangeMap = /* @__PURE__ */ new Map(), comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (let comp of comparators) {
          if (isNullSet(comp))
            return [comp];
          rangeMap.set(comp.value, comp);
        }
        rangeMap.size > 1 && rangeMap.has("") && rangeMap.delete("");
        let result = [...rangeMap.values()];
        return cache.set(memoKey, result), result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range))
          throw new TypeError("a Range is required");
        return this.set.some((thisComparators) => isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => rangeComparators.every((rangeComparator) => thisComparator.intersects(rangeComparator, options)))));
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version2) {
        if (!version2)
          return !1;
        if (typeof version2 == "string")
          try {
            version2 = new SemVer(version2, this.options);
          } catch {
            return !1;
          }
        for (let i = 0; i < this.set.length; i++)
          if (testSet(this.set[i], version2, this.options))
            return !0;
        return !1;
      }
    };
    module.exports = Range;
    var LRU = require_lrucache(), cache = new LRU(), parseOptions = require_parse_options(), Comparator = require_comparator(), debug = require_debug(), SemVer = require_semver(), trimComparatorWhitespace = require_trim_comparator_whitespace(), {
      safeRe: re,
      src,
      t,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re(), { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants(), BUILDSTRIPRE = new RegExp(src[t.BUILD], "g"), isNullSet = (c) => c.value === "<0.0.0-0", isAny = (c) => c.value === "", isSatisfiable = (comparators, options) => {
      let result = !0, remainingComparators = comparators.slice(), testComparator = remainingComparators.pop();
      for (; result && remainingComparators.length; )
        result = remainingComparators.every((otherComparator) => testComparator.intersects(otherComparator, options)), testComparator = remainingComparators.pop();
      return result;
    }, parseComparator = (comp, options) => (comp = comp.replace(re[t.BUILD], ""), debug("comp", comp, options), comp = replaceCarets(comp, options), debug("caret", comp), comp = replaceTildes(comp, options), debug("tildes", comp), comp = replaceXRanges(comp, options), debug("xrange", comp), comp = replaceStars(comp, options), debug("stars", comp), comp), isX = (id) => !id || id.toLowerCase() === "x" || id === "*", invalidXRangeOrder = (M, m, p) => isX(M) && !isX(m) || isX(m) && p && !isX(p), replaceTildes = (comp, options) => comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" "), replaceTilde = (comp, options) => {
      let r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE], z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        return isX(M) ? ret = "" : isX(m) ? ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0` : isX(p) ? ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0` : pr ? (debug("replaceTilde pr", pr), ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`) : ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`, debug("tilde return", ret), ret;
      });
    }, replaceCarets = (comp, options) => comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" "), replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      let r = options.loose ? re[t.CARETLOOSE] : re[t.CARET], z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        return isX(M) ? ret = "" : isX(m) ? ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0` : isX(p) ? M === "0" ? ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0` : ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0` : pr ? (debug("replaceCaret pr", pr), M === "0" ? m === "0" ? ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0` : ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0` : ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`) : (debug("no pr"), M === "0" ? m === "0" ? ret = `>=${M}.${m}.${p} <${M}.${m}.${+p + 1}-0` : ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0` : ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`), debug("caret return", ret), ret;
      });
    }, replaceXRanges = (comp, options) => (debug("replaceXRanges", comp, options), comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ")), replaceXRange = (comp, options) => {
      comp = comp.trim();
      let r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        if (debug("xRange", comp, ret, gtlt, M, m, p, pr), invalidXRangeOrder(M, m, p))
          return comp;
        let xM = isX(M), xm = xM || isX(m), xp = xm || isX(p), anyX = xp;
        return gtlt === "=" && anyX && (gtlt = ""), pr = options.includePrerelease ? "-0" : "", xM ? gtlt === ">" || gtlt === "<" ? ret = "<0.0.0-0" : ret = "*" : gtlt && anyX ? (xm && (m = 0), p = 0, gtlt === ">" ? (gtlt = ">=", xm ? (M = +M + 1, m = 0, p = 0) : (m = +m + 1, p = 0)) : gtlt === "<=" && (gtlt = "<", xm ? M = +M + 1 : m = +m + 1), gtlt === "<" && (pr = "-0"), ret = `${gtlt + M}.${m}.${p}${pr}`) : xm ? ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0` : xp && (ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`), debug("xRange return", ret), ret;
      });
    }, replaceStars = (comp, options) => (debug("replaceStars", comp, options), comp.trim().replace(re[t.STAR], "")), replaceGTE0 = (comp, options) => (debug("replaceGTE0", comp, options), comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "")), hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => (isX(fM) ? from = "" : isX(fm) ? from = `>=${fM}.0.0${incPr ? "-0" : ""}` : isX(fp) ? from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}` : fpr ? from = `>=${from}` : from = `>=${from}${incPr ? "-0" : ""}`, isX(tM) ? to = "" : isX(tm) ? to = `<${+tM + 1}.0.0-0` : isX(tp) ? to = `<${tM}.${+tm + 1}.0-0` : tpr ? to = `<=${tM}.${tm}.${tp}-${tpr}` : incPr ? to = `<${tM}.${tm}.${+tp + 1}-0` : to = `<=${to}`, `${from} ${to}`.trim()), testSet = (set, version2, options) => {
      for (let i = 0; i < set.length; i++)
        if (!set[i].test(version2))
          return !1;
      if (version2.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++)
          if (debug(set[i].semver), set[i].semver !== Comparator.ANY && set[i].semver.prerelease.length > 0) {
            let allowed = set[i].semver;
            if (allowed.major === version2.major && allowed.minor === version2.minor && allowed.patch === version2.patch)
              return !0;
          }
        return !1;
      }
      return !0;
    };
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/classes/comparator.js"(exports, module) {
    "use strict";
    var ANY = /* @__PURE__ */ Symbol("SemVer ANY"), Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        if (options = parseOptions(options), comp instanceof _Comparator) {
          if (comp.loose === !!options.loose)
            return comp;
          comp = comp.value;
        }
        comp = comp.trim().split(/\s+/).join(" "), debug("comparator", comp, options), this.options = options, this.loose = !!options.loose, this.parse(comp), this.semver === ANY ? this.value = "" : this.value = this.operator + this.semver.version, debug("comp", this);
      }
      parse(comp) {
        let r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR], m = comp.match(r);
        if (!m)
          throw new TypeError(`Invalid comparator: ${comp}`);
        this.operator = m[1] !== void 0 ? m[1] : "", this.operator === "=" && (this.operator = ""), m[2] ? this.semver = new SemVer(m[2], this.options.loose) : this.semver = ANY;
      }
      toString() {
        return this.value;
      }
      test(version2) {
        if (debug("Comparator.test", version2, this.options.loose), this.semver === ANY || version2 === ANY)
          return !0;
        if (typeof version2 == "string")
          try {
            version2 = new SemVer(version2, this.options);
          } catch {
            return !1;
          }
        return cmp(version2, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator))
          throw new TypeError("a Comparator is required");
        return this.operator === "" ? this.value === "" ? !0 : new Range(comp.value, options).test(this.value) : comp.operator === "" ? comp.value === "" ? !0 : new Range(this.value, options).test(comp.semver) : (options = parseOptions(options), options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0") || !options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0")) ? !1 : !!(this.operator.startsWith(">") && comp.operator.startsWith(">") || this.operator.startsWith("<") && comp.operator.startsWith("<") || this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=") || cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<") || cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")));
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options(), { safeRe: re, t } = require_re(), cmp = require_cmp(), debug = require_debug(), SemVer = require_semver(), Range = require_range();
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/functions/satisfies.js"(exports, module) {
    "use strict";
    var Range = require_range(), satisfies = (version2, range, options) => {
      try {
        range = new Range(range, options);
      } catch {
        return !1;
      }
      return range.test(version2);
    };
    module.exports = satisfies;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/to-comparators.js"(exports, module) {
    "use strict";
    var Range = require_range(), toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), Range = require_range(), maxSatisfying = (versions, range, options) => {
      let max = null, maxSV = null, rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch {
        return null;
      }
      return versions.forEach((v) => {
        rangeObj.test(v) && (!max || maxSV.compare(v) === -1) && (max = v, maxSV = new SemVer(max, options));
      }), max;
    };
    module.exports = maxSatisfying;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), Range = require_range(), minSatisfying = (versions, range, options) => {
      let min = null, minSV = null, rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch {
        return null;
      }
      return versions.forEach((v) => {
        rangeObj.test(v) && (!min || minSV.compare(v) === 1) && (min = v, minSV = new SemVer(min, options));
      }), min;
    };
    module.exports = minSatisfying;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/min-version.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), Range = require_range(), gt = require_gt(), minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver) || (minver = new SemVer("0.0.0-0"), range.test(minver)))
        return minver;
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        let comparators = range.set[i], setMin = null;
        comparators.forEach((comparator) => {
          let compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              compver.prerelease.length === 0 ? compver.patch++ : compver.prerelease.push(0), compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              (!setMin || gt(compver, setMin)) && (setMin = compver);
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        }), setMin && (!minver || gt(minver, setMin)) && (minver = setMin);
      }
      return minver && range.test(minver) ? minver : null;
    };
    module.exports = minVersion;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/valid.js"(exports, module) {
    "use strict";
    var Range = require_range(), validRange = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch {
        return null;
      }
    };
    module.exports = validRange;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/outside.js"(exports, module) {
    "use strict";
    var SemVer = require_semver(), Comparator = require_comparator(), { ANY } = Comparator, Range = require_range(), satisfies = require_satisfies(), gt = require_gt(), lt = require_lt(), lte = require_lte(), gte = require_gte(), outside = (version2, range, hilo, options) => {
      version2 = new SemVer(version2, options), range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt, ltefn = lte, ltfn = lt, comp = ">", ecomp = ">=";
          break;
        case "<":
          gtfn = lt, ltefn = gte, ltfn = gt, comp = "<", ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies(version2, range, options))
        return !1;
      for (let i = 0; i < range.set.length; ++i) {
        let comparators = range.set[i], high = null, low = null;
        if (comparators.forEach((comparator) => {
          comparator.semver === ANY && (comparator = new Comparator(">=0.0.0")), high = high || comparator, low = low || comparator, gtfn(comparator.semver, high.semver, options) ? high = comparator : ltfn(comparator.semver, low.semver, options) && (low = comparator);
        }), high.operator === comp || high.operator === ecomp || (!low.operator || low.operator === comp) && ltefn(version2, low.semver))
          return !1;
        if (low.operator === ecomp && ltfn(version2, low.semver))
          return !1;
      }
      return !0;
    };
    module.exports = outside;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/gtr.js"(exports, module) {
    "use strict";
    var outside = require_outside(), gtr = (version2, range, options) => outside(version2, range, ">", options);
    module.exports = gtr;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/ltr.js"(exports, module) {
    "use strict";
    var outside = require_outside(), ltr = (version2, range, options) => outside(version2, range, "<", options);
    module.exports = ltr;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/intersects.js"(exports, module) {
    "use strict";
    var Range = require_range(), intersects = (r1, r2, options) => (r1 = new Range(r1, options), r2 = new Range(r2, options), r1.intersects(r2, options));
    module.exports = intersects;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/simplify.js"(exports, module) {
    "use strict";
    var satisfies = require_satisfies(), compare = require_compare();
    module.exports = (versions, range, options) => {
      let set = [], first = null, prev = null, v = versions.sort((a, b) => compare(a, b, options));
      for (let version2 of v)
        satisfies(version2, range, options) ? (prev = version2, first || (first = version2)) : (prev && set.push([first, prev]), prev = null, first = null);
      first && set.push([first, null]);
      let ranges = [];
      for (let [min, max] of set)
        min === max ? ranges.push(min) : !max && min === v[0] ? ranges.push("*") : max ? min === v[0] ? ranges.push(`<=${max}`) : ranges.push(`${min} - ${max}`) : ranges.push(`>=${min}`);
      let simplified = ranges.join(" || "), original = typeof range.raw == "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/ranges/subset.js"(exports, module) {
    "use strict";
    var Range = require_range(), Comparator = require_comparator(), { ANY } = Comparator, satisfies = require_satisfies(), compare = require_compare(), subset = (sub, dom, options = {}) => {
      if (sub === dom)
        return !0;
      sub = new Range(sub, options), dom = new Range(dom, options);
      let sawNonNull = !1;
      OUTER: for (let simpleSub of sub.set) {
        for (let simpleDom of dom.set) {
          let isSub = simpleSubset(simpleSub, simpleDom, options);
          if (sawNonNull = sawNonNull || isSub !== null, isSub)
            continue OUTER;
        }
        if (sawNonNull)
          return !1;
      }
      return !0;
    }, minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")], minimumVersion = [new Comparator(">=0.0.0")], simpleSubset = (sub, dom, options) => {
      if (sub === dom)
        return !0;
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY)
          return !0;
        options.includePrerelease ? sub = minimumVersionWithPreRelease : sub = minimumVersion;
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease)
          return !0;
        dom = minimumVersion;
      }
      let eqSet = /* @__PURE__ */ new Set(), gt, lt;
      for (let c of sub)
        c.operator === ">" || c.operator === ">=" ? gt = higherGT(gt, c, options) : c.operator === "<" || c.operator === "<=" ? lt = lowerLT(lt, c, options) : eqSet.add(c.semver);
      if (eqSet.size > 1)
        return null;
      let gtltComp;
      if (gt && lt) {
        if (gtltComp = compare(gt.semver, lt.semver, options), gtltComp > 0)
          return null;
        if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<="))
          return null;
      }
      for (let eq of eqSet) {
        if (gt && !satisfies(eq, String(gt), options) || lt && !satisfies(eq, String(lt), options))
          return null;
        for (let c of dom)
          if (!satisfies(eq, String(c), options))
            return !1;
        return !0;
      }
      let higher, lower, hasDomLT, hasDomGT, needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : !1, needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : !1;
      needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0 && (needDomLTPre = !1);
      for (let c of dom) {
        if (hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=", hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=", gt) {
          if (needDomGTPre && c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch && (needDomGTPre = !1), c.operator === ">" || c.operator === ">=") {
            if (higher = higherGT(gt, c, options), higher === c && higher !== gt)
              return !1;
          } else if (gt.operator === ">=" && !c.test(gt.semver))
            return !1;
        }
        if (lt) {
          if (needDomLTPre && c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch && (needDomLTPre = !1), c.operator === "<" || c.operator === "<=") {
            if (lower = lowerLT(lt, c, options), lower === c && lower !== lt)
              return !1;
          } else if (lt.operator === "<=" && !c.test(lt.semver))
            return !1;
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0)
          return !1;
      }
      return !(gt && hasDomLT && !lt && gtltComp !== 0 || lt && hasDomGT && !gt && gtltComp !== 0 || needDomGTPre || needDomLTPre);
    }, higherGT = (a, b, options) => {
      if (!a)
        return b;
      let comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 || b.operator === ">" && a.operator === ">=" ? b : a;
    }, lowerLT = (a, b, options) => {
      if (!a)
        return b;
      let comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 || b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// node_modules/.pnpm/semver@7.8.6/node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/.pnpm/semver@7.8.6/node_modules/semver/index.js"(exports, module) {
    "use strict";
    var internalRe = require_re(), constants = require_constants(), SemVer = require_semver(), identifiers = require_identifiers(), parse3 = require_parse(), valid = require_valid(), clean = require_clean(), inc = require_inc(), diff = require_diff(), major = require_major(), minor = require_minor(), patch = require_patch(), prerelease = require_prerelease(), compare = require_compare(), rcompare = require_rcompare(), compareLoose = require_compare_loose(), compareBuild = require_compare_build(), sort = require_sort(), rsort = require_rsort(), gt = require_gt(), lt = require_lt(), eq = require_eq(), neq = require_neq(), gte = require_gte(), lte = require_lte(), cmp = require_cmp(), coerce = require_coerce(), truncate = require_truncate(), Comparator = require_comparator(), Range = require_range(), satisfies = require_satisfies(), toComparators = require_to_comparators(), maxSatisfying = require_max_satisfying(), minSatisfying = require_min_satisfying(), minVersion = require_min_version(), validRange = require_valid2(), outside = require_outside(), gtr = require_gtr(), ltr = require_ltr(), intersects = require_intersects(), simplifyRange = require_simplify(), subset = require_subset();
    module.exports = {
      parse: parse3,
      valid,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      truncate,
      Comparator,
      Range,
      satisfies,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// src/resolve.ts
function readPackageJson(fs, dir) {
  let cache = pkgCache.get(fs);
  cache || pkgCache.set(fs, cache = /* @__PURE__ */ new Map());
  let p = join(dir, "package.json");
  if (cache.has(p)) return cache.get(p);
  let txt = fs.readText(p), pkg = null;
  if (txt != null)
    try {
      pkg = JSON.parse(txt);
    } catch {
      pkg = null;
    }
  return cache.set(p, pkg), pkg;
}
function clearPackageCache(fs) {
  pkgCache.delete(fs);
}
function findPackageRoot(fs, dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (fs.isFile(join(d, "package.json"))) return d;
    if (d === "/") return null;
  }
}
function isBare(spec) {
  return !(spec.startsWith(".") || spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec));
}
function splitBare(spec) {
  let parts = spec.split("/"), n = spec.startsWith("@") ? 2 : 1;
  return { name: parts.slice(0, n).join("/"), sub: parts.slice(n).join("/") };
}
function resolveModule(fs, spec, fromDir, opts) {
  if (spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    let abs2 = normalize(spec.startsWith("/") ? spec : join(fromDir, spec)), mapped = opts.browser ? browserMap(fs, abs2) : abs2;
    if (mapped === !1) return !1;
    let r = resolveFileOrDir(fs, mapped, opts);
    if (r) return r;
    throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`);
  }
  if (spec.startsWith("#")) {
    let root = findPackageRoot(fs, fromDir), pkg = root ? readPackageJson(fs, root) : null;
    if (root && pkg?.imports) {
      let t = matchExports(pkg.imports, spec, opts.conditions);
      if (t) return isBare(t) ? resolveModule(fs, t, root, opts) : resolveModule(fs, "./" + t.replace(/^\.\//, ""), root, opts);
    }
    throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`);
  }
  let { name, sub } = splitBare(spec);
  if (opts.browser) {
    let root = findPackageRoot(fs, fromDir), pkg = root ? readPackageJson(fs, root) : null;
    if (pkg && typeof pkg.browser == "object" && spec in pkg.browser) {
      let m = pkg.browser[spec];
      if (m === !1) return !1;
      if (m !== spec) return resolveModule(fs, isBare(m) ? m : "./" + m.replace(/^\.\//, ""), root, opts);
    }
  }
  for (let d = fromDir; ; d = dirname(d)) {
    if (!d.endsWith("/node_modules")) {
      let pkgDir = join(d, "node_modules", name);
      if (fs.isDir(pkgDir)) {
        let r = resolvePackage(fs, pkgDir, sub, opts);
        if (r !== null) return r;
      }
    }
    if (d === "/") break;
  }
  throw new ResolveError(`Cannot find module '${spec}' from '${fromDir}'`);
}
function resolvePackage(fs, pkgDir, sub, opts) {
  let pkg = readPackageJson(fs, pkgDir);
  if (pkg?.exports !== void 0 && pkg.exports !== null) {
    let t = matchExports(pkg.exports, sub ? "./" + sub : ".", opts.conditions);
    if (t) {
      let r = resolveFileOrDir(fs, join(pkgDir, t), opts);
      if (r) return opts.browser && browserMap(fs, r) === !1 ? !1 : r;
    }
  }
  if (sub) {
    let abs2 = join(pkgDir, sub), m = opts.browser ? browserMap(fs, abs2) : abs2;
    return m === !1 ? !1 : resolveFileOrDir(fs, m, opts);
  }
  return resolveFileOrDir(fs, pkgDir, opts);
}
function resolveFileOrDir(fs, abs2, opts) {
  if (fs.isFile(abs2)) return abs2;
  for (let ext of opts.extensions) if (fs.isFile(abs2 + ext)) return abs2 + ext;
  let m = abs2.match(/\.(m|c)?jsx?$/);
  if (m) {
    let base = abs2.slice(0, -m[0].length);
    for (let ext of [".ts", ".tsx", ".mts", ".cts"]) if (fs.isFile(base + ext)) return base + ext;
  }
  if (fs.isDir(abs2)) {
    let pkg = readPackageJson(fs, abs2);
    if (pkg)
      for (let f of opts.mainFields) {
        let v = pkg[f];
        if (!(f === "browser" && typeof v != "string") && typeof v == "string" && v) {
          let r = resolveFileOrDir(fs, join(abs2, v), { ...opts, mainFields: [] });
          if (r) return r;
        }
      }
    for (let ext of opts.extensions) if (fs.isFile(join(abs2, "index" + ext))) return join(abs2, "index" + ext);
  }
  return null;
}
function browserMap(fs, abs2) {
  let root = findPackageRoot(fs, dirname(abs2)), pkg = root ? readPackageJson(fs, root) : null;
  if (!root || !pkg || typeof pkg.browser != "object") return abs2;
  let rel = "./" + abs2.slice(root.length + 1);
  for (let cand of [rel, rel + ".js", rel.replace(/\.js$/, "")])
    if (cand in pkg.browser) {
      let m = pkg.browser[cand];
      return m === !1 ? !1 : join(root, m);
    }
  return abs2;
}
function matchExports(exp, sub, conditions) {
  if (typeof exp == "string" || Array.isArray(exp) || exp && typeof exp == "object" && !Object.keys(exp).some((k) => k.startsWith(".") || k.startsWith("#")))
    return sub === "." ? pickTarget(exp, conditions, "") : null;
  let map = exp;
  if (sub in map) return pickTarget(map[sub], conditions, "");
  let best = null;
  for (let key of Object.keys(map)) {
    let i = key.indexOf("*");
    if (i >= 0) {
      let pre = key.slice(0, i), post = key.slice(i + 1);
      sub.startsWith(pre) && sub.endsWith(post) && sub.length >= key.length - 1 && (!best || pre.length > best.key.indexOf("*")) && (best = { key, star: sub.slice(pre.length, sub.length - post.length) });
    } else key.endsWith("/") && sub.startsWith(key) && (best || (best = { key, star: sub.slice(key.length) }));
  }
  if (best) {
    let t = pickTarget(map[best.key], conditions, best.star);
    return t && best.key.endsWith("/") && !best.key.includes("*") ? t + best.star : t;
  }
  return null;
}
function pickTarget(t, conditions, star) {
  if (t == null) return null;
  if (typeof t == "string") return t.replace(/\*/g, star);
  if (Array.isArray(t)) {
    for (let x of t) {
      let r = pickTarget(x, conditions, star);
      if (r) return r;
    }
    return null;
  }
  if (typeof t == "object") {
    for (let [k, v] of Object.entries(t))
      if (k === "default" || conditions.includes(k)) {
        let r = pickTarget(v, conditions, star);
        if (r) return r;
      }
  }
  return null;
}
var BROWSER_OPTS, NODE_OPTS, ResolveError, pkgCache, init_resolve = __esm({
  "src/resolve.ts"() {
    "use strict";
    init_path();
    BROWSER_OPTS = {
      conditions: ["browser", "import", "module", "development", "default"],
      extensions: [".tsx", ".ts", ".jsx", ".mjs", ".js", ".cjs", ".json", ".css"],
      browser: !0,
      mainFields: ["browser", "module", "main"]
    }, NODE_OPTS = {
      conditions: ["node", "require", "default"],
      extensions: [".js", ".json", ".cjs", ".mjs", ".ts", ".tsx", ".mts", ".cts", ".jsx", ".node"],
      mainFields: ["main"]
    }, ResolveError = class extends Error {
      code = "MODULE_NOT_FOUND";
    }, pkgCache = /* @__PURE__ */ new WeakMap();
  }
});

// node_modules/.pnpm/esbuild-wasm@0.28.2/node_modules/esbuild-wasm/lib/browser.js
var require_browser = __commonJS({
  "node_modules/.pnpm/esbuild-wasm@0.28.2/node_modules/esbuild-wasm/lib/browser.js"(exports, module) {
    ((module2) => {
      "use strict";
      var __defProp2 = Object.defineProperty, __getOwnPropDesc2 = Object.getOwnPropertyDescriptor, __getOwnPropNames2 = Object.getOwnPropertyNames, __hasOwnProp2 = Object.prototype.hasOwnProperty, __export2 = (target, all) => {
        for (var name in all)
          __defProp2(target, name, { get: all[name], enumerable: !0 });
      }, __copyProps2 = (to, from, except, desc) => {
        if (from && typeof from == "object" || typeof from == "function")
          for (let key of __getOwnPropNames2(from))
            !__hasOwnProp2.call(to, key) && key !== except && __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
        return to;
      }, __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: !0 }), mod), __async = (__this, __arguments, generator) => new Promise((resolve2, reject) => {
        var fulfilled = (value) => {
          try {
            step(generator.next(value));
          } catch (e) {
            reject(e);
          }
        }, rejected = (value) => {
          try {
            step(generator.throw(value));
          } catch (e) {
            reject(e);
          }
        }, step = (x) => x.done ? resolve2(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
        step((generator = generator.apply(__this, __arguments)).next());
      }), browser_exports = {};
      __export2(browser_exports, {
        analyzeMetafile: () => analyzeMetafile,
        analyzeMetafileSync: () => analyzeMetafileSync,
        build: () => build2,
        buildSync: () => buildSync,
        context: () => context,
        default: () => browser_default,
        formatMessages: () => formatMessages,
        formatMessagesSync: () => formatMessagesSync,
        initialize: () => initialize2,
        stop: () => stop,
        transform: () => transform,
        transformSync: () => transformSync,
        version: () => version2
      }), module2.exports = __toCommonJS(browser_exports);
      function encodePacket(packet) {
        let visit = (value) => {
          if (value === null)
            bb.write8(0);
          else if (typeof value == "boolean")
            bb.write8(1), bb.write8(+value);
          else if (typeof value == "number")
            bb.write8(2), bb.write32(value | 0);
          else if (typeof value == "string")
            bb.write8(3), bb.write(encodeUTF8(value));
          else if (value instanceof Uint8Array)
            bb.write8(4), bb.write(value);
          else if (value instanceof Array) {
            bb.write8(5), bb.write32(value.length);
            for (let item of value)
              visit(item);
          } else {
            let keys = Object.keys(value);
            bb.write8(6), bb.write32(keys.length);
            for (let key of keys)
              bb.write(encodeUTF8(key)), visit(value[key]);
          }
        }, bb = new ByteBuffer();
        return bb.write32(0), bb.write32(packet.id << 1 | +!packet.isRequest), visit(packet.value), writeUInt32LE(bb.buf, bb.len - 4, 0), bb.buf.subarray(0, bb.len);
      }
      function decodePacket(bytes) {
        let visit = () => {
          switch (bb.read8()) {
            case 0:
              return null;
            case 1:
              return !!bb.read8();
            case 2:
              return bb.read32();
            case 3:
              return decodeUTF8(bb.read());
            case 4:
              return bb.read();
            case 5: {
              let count = bb.read32(), value2 = [];
              for (let i = 0; i < count; i++)
                value2.push(visit());
              return value2;
            }
            case 6: {
              let count = bb.read32(), value2 = {};
              for (let i = 0; i < count; i++)
                value2[decodeUTF8(bb.read())] = visit();
              return value2;
            }
            default:
              throw new Error("Invalid packet");
          }
        }, bb = new ByteBuffer(bytes), id = bb.read32(), isRequest = (id & 1) === 0;
        id >>>= 1;
        let value = visit();
        if (bb.ptr !== bytes.length)
          throw new Error("Invalid packet");
        return { id, isRequest, value };
      }
      var ByteBuffer = class {
        constructor(buf = new Uint8Array(1024)) {
          this.buf = buf, this.len = 0, this.ptr = 0;
        }
        _write(delta) {
          if (this.len + delta > this.buf.length) {
            let clone = new Uint8Array((this.len + delta) * 2);
            clone.set(this.buf), this.buf = clone;
          }
          return this.len += delta, this.len - delta;
        }
        write8(value) {
          let offset = this._write(1);
          this.buf[offset] = value;
        }
        write32(value) {
          let offset = this._write(4);
          writeUInt32LE(this.buf, value, offset);
        }
        write(bytes) {
          let offset = this._write(4 + bytes.length);
          writeUInt32LE(this.buf, bytes.length, offset), this.buf.set(bytes, offset + 4);
        }
        _read(delta) {
          if (this.ptr + delta > this.buf.length)
            throw new Error("Invalid packet");
          return this.ptr += delta, this.ptr - delta;
        }
        read8() {
          return this.buf[this._read(1)];
        }
        read32() {
          return readUInt32LE(this.buf, this._read(4));
        }
        read() {
          let length = this.read32(), bytes = new Uint8Array(length), ptr = this._read(bytes.length);
          return bytes.set(this.buf.subarray(ptr, ptr + length)), bytes;
        }
      }, encodeUTF8, decodeUTF8, encodeInvariant;
      if (typeof TextEncoder < "u" && typeof TextDecoder < "u") {
        let encoder = new TextEncoder(), decoder = new TextDecoder();
        encodeUTF8 = (text) => encoder.encode(text), decodeUTF8 = (bytes) => decoder.decode(bytes), encodeInvariant = 'new TextEncoder().encode("")';
      } else if (typeof Buffer < "u")
        encodeUTF8 = (text) => Buffer.from(text), decodeUTF8 = (bytes) => {
          let { buffer, byteOffset, byteLength } = bytes;
          return Buffer.from(buffer, byteOffset, byteLength).toString();
        }, encodeInvariant = 'Buffer.from("")';
      else
        throw new Error("No UTF-8 codec found");
      if (!(encodeUTF8("") instanceof Uint8Array))
        throw new Error(`Invariant violation: "${encodeInvariant} instanceof Uint8Array" is incorrectly false

This indicates that your JavaScript environment is broken. You cannot use
esbuild in this environment because esbuild relies on this invariant. This
is not a problem with esbuild. You need to fix your environment instead.
`);
      function readUInt32LE(buffer, offset) {
        return (buffer[offset++] | buffer[offset++] << 8 | buffer[offset++] << 16 | buffer[offset++] << 24) >>> 0;
      }
      function writeUInt32LE(buffer, value, offset) {
        buffer[offset++] = value, buffer[offset++] = value >> 8, buffer[offset++] = value >> 16, buffer[offset++] = value >> 24;
      }
      var fromCharCode = String.fromCharCode;
      function throwSyntaxError(bytes, index, message) {
        let c = bytes[index], line = 1, column = 0;
        for (let i = 0; i < index; i++)
          bytes[i] === 10 ? (line++, column = 0) : column++;
        throw new SyntaxError(
          message || (index === bytes.length ? "Unexpected end of input while parsing JSON" : c >= 32 && c <= 126 ? `Unexpected character ${fromCharCode(c)} in JSON at position ${index} (line ${line}, column ${column})` : `Unexpected byte 0x${c.toString(16)} in JSON at position ${index} (line ${line}, column ${column})`)
        );
      }
      function JSON_parse(bytes) {
        if (!(bytes instanceof Uint8Array))
          throw new Error("JSON input must be a Uint8Array");
        let propertyStack = [], objectStack = [], stateStack = [], length = bytes.length, property = null, state = 0, object, i = 0;
        for (; i < length; ) {
          let c = bytes[i++];
          if (c <= 32)
            continue;
          let value;
          switch (state === 2 && property === null && c !== 34 && c !== 125 && throwSyntaxError(bytes, --i), c) {
            // True
            case 116: {
              (bytes[i++] !== 114 || bytes[i++] !== 117 || bytes[i++] !== 101) && throwSyntaxError(bytes, --i), value = !0;
              break;
            }
            // False
            case 102: {
              (bytes[i++] !== 97 || bytes[i++] !== 108 || bytes[i++] !== 115 || bytes[i++] !== 101) && throwSyntaxError(bytes, --i), value = !1;
              break;
            }
            // Null
            case 110: {
              (bytes[i++] !== 117 || bytes[i++] !== 108 || bytes[i++] !== 108) && throwSyntaxError(bytes, --i), value = null;
              break;
            }
            // Number begin
            case 45:
            case 46:
            case 48:
            case 49:
            case 50:
            case 51:
            case 52:
            case 53:
            case 54:
            case 55:
            case 56:
            case 57: {
              let index = i;
              for (value = fromCharCode(c), c = bytes[i]; ; ) {
                switch (c) {
                  case 43:
                  case 45:
                  case 46:
                  case 48:
                  case 49:
                  case 50:
                  case 51:
                  case 52:
                  case 53:
                  case 54:
                  case 55:
                  case 56:
                  case 57:
                  case 101:
                  case 69: {
                    value += fromCharCode(c), c = bytes[++i];
                    continue;
                  }
                }
                break;
              }
              value = +value, isNaN(value) && throwSyntaxError(bytes, --index, "Invalid number");
              break;
            }
            // String begin
            case 34: {
              for (value = ""; i >= length && throwSyntaxError(bytes, length), c = bytes[i++], c !== 34; )
                if (c === 92)
                  switch (bytes[i++]) {
                    // Normal escape sequence
                    case 34:
                      value += '"';
                      break;
                    case 47:
                      value += "/";
                      break;
                    case 92:
                      value += "\\";
                      break;
                    case 98:
                      value += "\b";
                      break;
                    case 102:
                      value += "\f";
                      break;
                    case 110:
                      value += `
`;
                      break;
                    case 114:
                      value += "\r";
                      break;
                    case 116:
                      value += "	";
                      break;
                    // Unicode escape sequence
                    case 117: {
                      let code = 0;
                      for (let j = 0; j < 4; j++)
                        c = bytes[i++], code <<= 4, c >= 48 && c <= 57 ? code |= c - 48 : c >= 97 && c <= 102 ? code |= c + -87 : c >= 65 && c <= 70 ? code |= c + -55 : throwSyntaxError(bytes, --i);
                      value += fromCharCode(code);
                      break;
                    }
                    // Invalid escape sequence
                    default:
                      throwSyntaxError(bytes, --i);
                      break;
                  }
                else if (c <= 127)
                  value += fromCharCode(c);
                else if ((c & 224) === 192)
                  value += fromCharCode((c & 31) << 6 | bytes[i++] & 63);
                else if ((c & 240) === 224)
                  value += fromCharCode((c & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63);
                else if ((c & 248) == 240) {
                  let codePoint = (c & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
                  codePoint > 65535 && (codePoint -= 65536, value += fromCharCode(codePoint >> 10 & 1023 | 55296), codePoint = 56320 | codePoint & 1023), value += fromCharCode(codePoint);
                }
              value[0];
              break;
            }
            // Array begin
            case 91: {
              value = [], propertyStack.push(property), objectStack.push(object), stateStack.push(state), property = null, object = value, state = 1;
              continue;
            }
            // Object begin
            case 123: {
              value = {}, propertyStack.push(property), objectStack.push(object), stateStack.push(state), property = null, object = value, state = 2;
              continue;
            }
            // Array end
            case 93: {
              state !== 1 && throwSyntaxError(bytes, --i), value = object, property = propertyStack.pop(), object = objectStack.pop(), state = stateStack.pop();
              break;
            }
            // Object end
            case 125: {
              state !== 2 && throwSyntaxError(bytes, --i), value = object, property = propertyStack.pop(), object = objectStack.pop(), state = stateStack.pop();
              break;
            }
            default:
              throwSyntaxError(bytes, --i);
          }
          for (c = bytes[i]; c <= 32; )
            c = bytes[++i];
          switch (state) {
            case 0: {
              if (i === length)
                return value;
              break;
            }
            case 1: {
              if (object.push(value), c === 44) {
                i++;
                continue;
              }
              if (c === 93)
                continue;
              break;
            }
            case 2: {
              if (property === null) {
                if (property = value, c === 58) {
                  i++;
                  continue;
                }
              } else {
                if (object[property] = value, property = null, c === 44) {
                  i++;
                  continue;
                }
                if (c === 125)
                  continue;
              }
              break;
            }
          }
          break;
        }
        throwSyntaxError(bytes, i);
      }
      var quote2 = JSON.stringify, buildLogLevelDefault = "warning", transformLogLevelDefault = "silent";
      function validateAndJoinStringArray(values, what) {
        let toJoin = [];
        for (let value of values) {
          if (validateStringValue(value, what), value.indexOf(",") >= 0) throw new Error(`Invalid ${what}: ${value}`);
          toJoin.push(value);
        }
        return toJoin.join(",");
      }
      var canBeAnything = () => null, mustBeBoolean = (value) => typeof value == "boolean" ? null : "a boolean", mustBeString = (value) => typeof value == "string" ? null : "a string", mustBeRegExp = (value) => value instanceof RegExp ? null : "a RegExp object", mustBeInteger = (value) => typeof value == "number" && value === (value | 0) ? null : "an integer", mustBeValidPortNumber = (value) => typeof value == "number" && value === (value | 0) && value >= 0 && value <= 65535 ? null : "a valid port number", mustBeFunction = (value) => typeof value == "function" ? null : "a function", mustBeArray = (value) => Array.isArray(value) ? null : "an array", mustBeArrayOfStrings = (value) => Array.isArray(value) && value.every((x) => typeof x == "string") ? null : "an array of strings", mustBeObject = (value) => typeof value == "object" && value !== null && !Array.isArray(value) ? null : "an object", mustBeEntryPoints = (value) => typeof value == "object" && value !== null ? null : "an array or an object", mustBeWebAssemblyModule = (value) => value instanceof WebAssembly.Module ? null : "a WebAssembly.Module", mustBeObjectOrNull = (value) => typeof value == "object" && !Array.isArray(value) ? null : "an object or null", mustBeStringOrBoolean = (value) => typeof value == "string" || typeof value == "boolean" ? null : "a string or a boolean", mustBeStringOrObject = (value) => typeof value == "string" || typeof value == "object" && value !== null && !Array.isArray(value) ? null : "a string or an object", mustBeStringOrArrayOfStrings = (value) => typeof value == "string" || Array.isArray(value) && value.every((x) => typeof x == "string") ? null : "a string or an array of strings", mustBeStringOrUint8Array = (value) => typeof value == "string" || value instanceof Uint8Array ? null : "a string or a Uint8Array", mustBeStringOrURL = (value) => typeof value == "string" || value instanceof URL ? null : "a string or a URL";
      function getFlag(object, keys, key, mustBeFn) {
        let value = object[key];
        if (keys[key + ""] = !0, value === void 0) return;
        let mustBe = mustBeFn(value);
        if (mustBe !== null) throw new Error(`${quote2(key)} must be ${mustBe}`);
        return value;
      }
      function checkForInvalidFlags(object, keys, where) {
        for (let key in object)
          if (!(key in keys))
            throw new Error(`Invalid option ${where}: ${quote2(key)}`);
      }
      function validateInitializeOptions(options) {
        let keys = /* @__PURE__ */ Object.create(null), wasmURL = getFlag(options, keys, "wasmURL", mustBeStringOrURL), wasmModule = getFlag(options, keys, "wasmModule", mustBeWebAssemblyModule), worker = getFlag(options, keys, "worker", mustBeBoolean);
        return checkForInvalidFlags(options, keys, "in initialize() call"), {
          wasmURL,
          wasmModule,
          worker
        };
      }
      function validateMangleCache(mangleCache) {
        let validated;
        if (mangleCache !== void 0) {
          validated = /* @__PURE__ */ Object.create(null);
          for (let key in mangleCache) {
            let value = mangleCache[key];
            if (typeof value == "string" || value === !1)
              validated[key] = value;
            else
              throw new Error(`Expected ${quote2(key)} in mangle cache to map to either a string or false`);
          }
        }
        return validated;
      }
      function pushLogFlags(flags2, options, keys, isTTY, logLevelDefault) {
        let color2 = getFlag(options, keys, "color", mustBeBoolean), logLevel = getFlag(options, keys, "logLevel", mustBeString), logLimit = getFlag(options, keys, "logLimit", mustBeInteger), logStyle = getFlag(options, keys, "logStyle", mustBeString);
        color2 !== void 0 ? flags2.push(`--color=${color2}`) : isTTY && flags2.push("--color=true"), flags2.push(`--log-level=${logLevel || logLevelDefault}`), flags2.push(`--log-limit=${logLimit || 0}`), logStyle && flags2.push(`--log-style=${logStyle}`);
      }
      function validateStringValue(value, what, key) {
        if (typeof value != "string")
          throw new Error(`Expected value for ${what}${key !== void 0 ? " " + quote2(key) : ""} to be a string, got ${typeof value} instead`);
        return value;
      }
      function pushCommonFlags(flags2, options, keys) {
        let legalComments = getFlag(options, keys, "legalComments", mustBeString), sourceRoot = getFlag(options, keys, "sourceRoot", mustBeString), sourcesContent = getFlag(options, keys, "sourcesContent", mustBeBoolean), target = getFlag(options, keys, "target", mustBeStringOrArrayOfStrings), format2 = getFlag(options, keys, "format", mustBeString), globalName = getFlag(options, keys, "globalName", mustBeString), mangleProps = getFlag(options, keys, "mangleProps", mustBeRegExp), reserveProps = getFlag(options, keys, "reserveProps", mustBeRegExp), mangleQuoted = getFlag(options, keys, "mangleQuoted", mustBeBoolean), minify = getFlag(options, keys, "minify", mustBeBoolean), minifySyntax = getFlag(options, keys, "minifySyntax", mustBeBoolean), minifyWhitespace = getFlag(options, keys, "minifyWhitespace", mustBeBoolean), minifyIdentifiers = getFlag(options, keys, "minifyIdentifiers", mustBeBoolean), lineLimit = getFlag(options, keys, "lineLimit", mustBeInteger), drop = getFlag(options, keys, "drop", mustBeArrayOfStrings), dropLabels = getFlag(options, keys, "dropLabels", mustBeArrayOfStrings), charset = getFlag(options, keys, "charset", mustBeString), treeShaking = getFlag(options, keys, "treeShaking", mustBeBoolean), ignoreAnnotations = getFlag(options, keys, "ignoreAnnotations", mustBeBoolean), jsx = getFlag(options, keys, "jsx", mustBeString), jsxFactory = getFlag(options, keys, "jsxFactory", mustBeString), jsxFragment = getFlag(options, keys, "jsxFragment", mustBeString), jsxImportSource = getFlag(options, keys, "jsxImportSource", mustBeString), jsxDev = getFlag(options, keys, "jsxDev", mustBeBoolean), jsxSideEffects = getFlag(options, keys, "jsxSideEffects", mustBeBoolean), define = getFlag(options, keys, "define", mustBeObject), logOverride = getFlag(options, keys, "logOverride", mustBeObject), supported = getFlag(options, keys, "supported", mustBeObject), pure = getFlag(options, keys, "pure", mustBeArrayOfStrings), keepNames = getFlag(options, keys, "keepNames", mustBeBoolean), platform = getFlag(options, keys, "platform", mustBeString), tsconfigRaw = getFlag(options, keys, "tsconfigRaw", mustBeStringOrObject), absPaths = getFlag(options, keys, "absPaths", mustBeArrayOfStrings);
        if (legalComments && flags2.push(`--legal-comments=${legalComments}`), sourceRoot !== void 0 && flags2.push(`--source-root=${sourceRoot}`), sourcesContent !== void 0 && flags2.push(`--sources-content=${sourcesContent}`), target && flags2.push(`--target=${validateAndJoinStringArray(Array.isArray(target) ? target : [target], "target")}`), format2 && flags2.push(`--format=${format2}`), globalName && flags2.push(`--global-name=${globalName}`), platform && flags2.push(`--platform=${platform}`), tsconfigRaw && flags2.push(`--tsconfig-raw=${typeof tsconfigRaw == "string" ? tsconfigRaw : JSON.stringify(tsconfigRaw)}`), minify && flags2.push("--minify"), minifySyntax && flags2.push("--minify-syntax"), minifyWhitespace && flags2.push("--minify-whitespace"), minifyIdentifiers && flags2.push("--minify-identifiers"), lineLimit && flags2.push(`--line-limit=${lineLimit}`), charset && flags2.push(`--charset=${charset}`), treeShaking !== void 0 && flags2.push(`--tree-shaking=${treeShaking}`), ignoreAnnotations && flags2.push("--ignore-annotations"), drop) for (let what of drop) flags2.push(`--drop:${validateStringValue(what, "drop")}`);
        if (dropLabels && flags2.push(`--drop-labels=${validateAndJoinStringArray(dropLabels, "drop label")}`), absPaths && flags2.push(`--abs-paths=${validateAndJoinStringArray(absPaths, "abs paths")}`), mangleProps && flags2.push(`--mangle-props=${jsRegExpToGoRegExp(mangleProps)}`), reserveProps && flags2.push(`--reserve-props=${jsRegExpToGoRegExp(reserveProps)}`), mangleQuoted !== void 0 && flags2.push(`--mangle-quoted=${mangleQuoted}`), jsx && flags2.push(`--jsx=${jsx}`), jsxFactory && flags2.push(`--jsx-factory=${jsxFactory}`), jsxFragment && flags2.push(`--jsx-fragment=${jsxFragment}`), jsxImportSource && flags2.push(`--jsx-import-source=${jsxImportSource}`), jsxDev && flags2.push("--jsx-dev"), jsxSideEffects && flags2.push("--jsx-side-effects"), define)
          for (let key in define) {
            if (key.indexOf("=") >= 0) throw new Error(`Invalid define: ${key}`);
            flags2.push(`--define:${key}=${validateStringValue(define[key], "define", key)}`);
          }
        if (logOverride)
          for (let key in logOverride) {
            if (key.indexOf("=") >= 0) throw new Error(`Invalid log override: ${key}`);
            flags2.push(`--log-override:${key}=${validateStringValue(logOverride[key], "log override", key)}`);
          }
        if (supported)
          for (let key in supported) {
            if (key.indexOf("=") >= 0) throw new Error(`Invalid supported: ${key}`);
            let value = supported[key];
            if (typeof value != "boolean") throw new Error(`Expected value for supported ${quote2(key)} to be a boolean, got ${typeof value} instead`);
            flags2.push(`--supported:${key}=${value}`);
          }
        if (pure) for (let fn of pure) flags2.push(`--pure:${validateStringValue(fn, "pure")}`);
        keepNames && flags2.push("--keep-names");
      }
      function flagsForBuildOptions(callName, options, isTTY, logLevelDefault, writeDefault) {
        var _a;
        let flags2 = [], entries = [], keys = /* @__PURE__ */ Object.create(null), stdinContents = null, stdinResolveDir = null;
        pushLogFlags(flags2, options, keys, isTTY, logLevelDefault), pushCommonFlags(flags2, options, keys);
        let sourcemap = getFlag(options, keys, "sourcemap", mustBeStringOrBoolean), bundle = getFlag(options, keys, "bundle", mustBeBoolean), splitting = getFlag(options, keys, "splitting", mustBeBoolean), preserveSymlinks = getFlag(options, keys, "preserveSymlinks", mustBeBoolean), metafile = getFlag(options, keys, "metafile", mustBeBoolean), outfile = getFlag(options, keys, "outfile", mustBeString), outdir = getFlag(options, keys, "outdir", mustBeString), outbase = getFlag(options, keys, "outbase", mustBeString), tsconfig = getFlag(options, keys, "tsconfig", mustBeString), resolveExtensions = getFlag(options, keys, "resolveExtensions", mustBeArrayOfStrings), nodePathsInput = getFlag(options, keys, "nodePaths", mustBeArrayOfStrings), mainFields = getFlag(options, keys, "mainFields", mustBeArrayOfStrings), conditions = getFlag(options, keys, "conditions", mustBeArrayOfStrings), external = getFlag(options, keys, "external", mustBeArrayOfStrings), packages = getFlag(options, keys, "packages", mustBeString), alias = getFlag(options, keys, "alias", mustBeObject), loader = getFlag(options, keys, "loader", mustBeObject), outExtension = getFlag(options, keys, "outExtension", mustBeObject), publicPath = getFlag(options, keys, "publicPath", mustBeString), entryNames = getFlag(options, keys, "entryNames", mustBeString), chunkNames = getFlag(options, keys, "chunkNames", mustBeString), assetNames = getFlag(options, keys, "assetNames", mustBeString), inject = getFlag(options, keys, "inject", mustBeArrayOfStrings), banner = getFlag(options, keys, "banner", mustBeObject), footer = getFlag(options, keys, "footer", mustBeObject), entryPoints = getFlag(options, keys, "entryPoints", mustBeEntryPoints), absWorkingDir = getFlag(options, keys, "absWorkingDir", mustBeString), stdin = getFlag(options, keys, "stdin", mustBeObject), write = (_a = getFlag(options, keys, "write", mustBeBoolean)) != null ? _a : writeDefault, allowOverwrite = getFlag(options, keys, "allowOverwrite", mustBeBoolean), mangleCache = getFlag(options, keys, "mangleCache", mustBeObject);
        if (keys.plugins = !0, checkForInvalidFlags(options, keys, `in ${callName}() call`), sourcemap && flags2.push(`--sourcemap${sourcemap === !0 ? "" : `=${sourcemap}`}`), bundle && flags2.push("--bundle"), allowOverwrite && flags2.push("--allow-overwrite"), splitting && flags2.push("--splitting"), preserveSymlinks && flags2.push("--preserve-symlinks"), metafile && flags2.push("--metafile"), outfile && flags2.push(`--outfile=${outfile}`), outdir && flags2.push(`--outdir=${outdir}`), outbase && flags2.push(`--outbase=${outbase}`), tsconfig && flags2.push(`--tsconfig=${tsconfig}`), packages && flags2.push(`--packages=${packages}`), resolveExtensions && flags2.push(`--resolve-extensions=${validateAndJoinStringArray(resolveExtensions, "resolve extension")}`), publicPath && flags2.push(`--public-path=${publicPath}`), entryNames && flags2.push(`--entry-names=${entryNames}`), chunkNames && flags2.push(`--chunk-names=${chunkNames}`), assetNames && flags2.push(`--asset-names=${assetNames}`), mainFields && flags2.push(`--main-fields=${validateAndJoinStringArray(mainFields, "main field")}`), conditions && flags2.push(`--conditions=${validateAndJoinStringArray(conditions, "condition")}`), external) for (let name of external) flags2.push(`--external:${validateStringValue(name, "external")}`);
        if (alias)
          for (let old in alias) {
            if (old.indexOf("=") >= 0) throw new Error(`Invalid package name in alias: ${old}`);
            flags2.push(`--alias:${old}=${validateStringValue(alias[old], "alias", old)}`);
          }
        if (banner)
          for (let type in banner) {
            if (type.indexOf("=") >= 0) throw new Error(`Invalid banner file type: ${type}`);
            flags2.push(`--banner:${type}=${validateStringValue(banner[type], "banner", type)}`);
          }
        if (footer)
          for (let type in footer) {
            if (type.indexOf("=") >= 0) throw new Error(`Invalid footer file type: ${type}`);
            flags2.push(`--footer:${type}=${validateStringValue(footer[type], "footer", type)}`);
          }
        if (inject) for (let path2 of inject) flags2.push(`--inject:${validateStringValue(path2, "inject")}`);
        if (loader)
          for (let ext in loader) {
            if (ext.indexOf("=") >= 0) throw new Error(`Invalid loader extension: ${ext}`);
            flags2.push(`--loader:${ext}=${validateStringValue(loader[ext], "loader", ext)}`);
          }
        if (outExtension)
          for (let ext in outExtension) {
            if (ext.indexOf("=") >= 0) throw new Error(`Invalid out extension: ${ext}`);
            flags2.push(`--out-extension:${ext}=${validateStringValue(outExtension[ext], "out extension", ext)}`);
          }
        if (entryPoints)
          if (Array.isArray(entryPoints))
            for (let i = 0, n = entryPoints.length; i < n; i++) {
              let entryPoint = entryPoints[i];
              if (typeof entryPoint == "object" && entryPoint !== null) {
                let entryPointKeys = /* @__PURE__ */ Object.create(null), input = getFlag(entryPoint, entryPointKeys, "in", mustBeString), output = getFlag(entryPoint, entryPointKeys, "out", mustBeString);
                if (checkForInvalidFlags(entryPoint, entryPointKeys, "in entry point at index " + i), input === void 0) throw new Error('Missing property "in" for entry point at index ' + i);
                if (output === void 0) throw new Error('Missing property "out" for entry point at index ' + i);
                entries.push([output, input]);
              } else
                entries.push(["", validateStringValue(entryPoint, "entry point at index " + i)]);
            }
          else
            for (let key in entryPoints)
              entries.push([key, validateStringValue(entryPoints[key], "entry point", key)]);
        if (stdin) {
          let stdinKeys = /* @__PURE__ */ Object.create(null), contents = getFlag(stdin, stdinKeys, "contents", mustBeStringOrUint8Array), resolveDir = getFlag(stdin, stdinKeys, "resolveDir", mustBeString), sourcefile = getFlag(stdin, stdinKeys, "sourcefile", mustBeString), loader2 = getFlag(stdin, stdinKeys, "loader", mustBeString);
          checkForInvalidFlags(stdin, stdinKeys, 'in "stdin" object'), sourcefile && flags2.push(`--sourcefile=${sourcefile}`), loader2 && flags2.push(`--loader=${loader2}`), resolveDir && (stdinResolveDir = resolveDir), typeof contents == "string" ? stdinContents = encodeUTF8(contents) : contents instanceof Uint8Array && (stdinContents = contents);
        }
        let nodePaths = [];
        if (nodePathsInput)
          for (let value of nodePathsInput)
            value += "", nodePaths.push(value);
        return {
          entries,
          flags: flags2,
          write,
          stdinContents,
          stdinResolveDir,
          absWorkingDir,
          nodePaths,
          mangleCache: validateMangleCache(mangleCache)
        };
      }
      function flagsForTransformOptions(callName, options, isTTY, logLevelDefault) {
        let flags2 = [], keys = /* @__PURE__ */ Object.create(null);
        pushLogFlags(flags2, options, keys, isTTY, logLevelDefault), pushCommonFlags(flags2, options, keys);
        let sourcemap = getFlag(options, keys, "sourcemap", mustBeStringOrBoolean), sourcefile = getFlag(options, keys, "sourcefile", mustBeString), loader = getFlag(options, keys, "loader", mustBeString), banner = getFlag(options, keys, "banner", mustBeString), footer = getFlag(options, keys, "footer", mustBeString), mangleCache = getFlag(options, keys, "mangleCache", mustBeObject);
        return checkForInvalidFlags(options, keys, `in ${callName}() call`), sourcemap && flags2.push(`--sourcemap=${sourcemap === !0 ? "external" : sourcemap}`), sourcefile && flags2.push(`--sourcefile=${sourcefile}`), loader && flags2.push(`--loader=${loader}`), banner && flags2.push(`--banner=${banner}`), footer && flags2.push(`--footer=${footer}`), {
          flags: flags2,
          mangleCache: validateMangleCache(mangleCache)
        };
      }
      function createChannel(streamIn) {
        let requestCallbacksByKey = {}, closeData = { didClose: !1, reason: "" }, responseCallbacks = {}, nextRequestID = 0, nextBuildKey = 0, stdout = new Uint8Array(16 * 1024), stdoutUsed = 0, readFromStdout = (chunk) => {
          let limit = stdoutUsed + chunk.length;
          if (limit > stdout.length) {
            let swap = new Uint8Array(limit * 2);
            swap.set(stdout), stdout = swap;
          }
          stdout.set(chunk, stdoutUsed), stdoutUsed += chunk.length;
          let offset = 0;
          for (; offset + 4 <= stdoutUsed; ) {
            let length = readUInt32LE(stdout, offset);
            if (offset + 4 + length > stdoutUsed)
              break;
            offset += 4, handleIncomingPacket(stdout.subarray(offset, offset + length)), offset += length;
          }
          offset > 0 && (stdout.copyWithin(0, offset, stdoutUsed), stdoutUsed -= offset);
        }, afterClose = (error) => {
          closeData.didClose = !0, error && (closeData.reason = ": " + (error.message || error));
          let text = "The service was stopped" + closeData.reason;
          for (let id in responseCallbacks)
            responseCallbacks[id](text, null);
          responseCallbacks = {};
        }, sendRequest = (refs, value, callback) => {
          if (closeData.didClose) return callback("The service is no longer running" + closeData.reason, null);
          let id = nextRequestID++;
          responseCallbacks[id] = (error, response) => {
            try {
              callback(error, response);
            } finally {
              refs && refs.unref();
            }
          }, refs && refs.ref(), streamIn.writeToStdin(encodePacket({ id, isRequest: !0, value }));
        }, sendResponse = (id, value) => {
          if (closeData.didClose) throw new Error("The service is no longer running" + closeData.reason);
          streamIn.writeToStdin(encodePacket({ id, isRequest: !1, value }));
        }, handleRequest = (id, request) => __async(null, null, function* () {
          try {
            if (request.command === "ping") {
              sendResponse(id, {});
              return;
            }
            if (typeof request.key == "number") {
              let requestCallbacks = requestCallbacksByKey[request.key];
              if (!requestCallbacks)
                return;
              let callback = requestCallbacks[request.command];
              if (callback) {
                yield callback(id, request);
                return;
              }
            }
            throw new Error("Invalid command: " + request.command);
          } catch (e) {
            let errors = [extractErrorMessageV8(e, streamIn, null, void 0, "")];
            try {
              sendResponse(id, { errors });
            } catch {
            }
          }
        }), isFirstPacket = !0, handleIncomingPacket = (bytes) => {
          if (isFirstPacket) {
            isFirstPacket = !1;
            let binaryVersion = String.fromCharCode(...bytes);
            if (binaryVersion !== "0.28.2")
              throw new Error(`Cannot start service: Host version "0.28.2" does not match binary version ${quote2(binaryVersion)}`);
            return;
          }
          let packet = decodePacket(bytes);
          if (packet.isRequest)
            handleRequest(packet.id, packet.value);
          else {
            let callback = responseCallbacks[packet.id];
            delete responseCallbacks[packet.id], packet.value.error ? callback(packet.value.error, {}) : callback(null, packet.value);
          }
        };
        return {
          readFromStdout,
          afterClose,
          service: {
            buildOrContext: ({ callName, refs, options, isTTY, defaultWD, callback }) => {
              let refCount = 0, buildKey = nextBuildKey++, requestCallbacks = {}, buildRefs = {
                ref() {
                  ++refCount === 1 && refs && refs.ref();
                },
                unref() {
                  --refCount === 0 && (delete requestCallbacksByKey[buildKey], refs && refs.unref());
                }
              };
              requestCallbacksByKey[buildKey] = requestCallbacks, buildRefs.ref(), buildOrContextImpl(
                callName,
                buildKey,
                sendRequest,
                sendResponse,
                buildRefs,
                streamIn,
                requestCallbacks,
                options,
                isTTY,
                defaultWD,
                (err2, res) => {
                  try {
                    callback(err2, res);
                  } finally {
                    buildRefs.unref();
                  }
                }
              );
            },
            transform: ({ callName, refs, input, options, isTTY, fs, callback }) => {
              let details = createObjectStash(), start = (inputPath) => {
                try {
                  if (typeof input != "string" && !(input instanceof Uint8Array))
                    throw new Error('The input to "transform" must be a string or a Uint8Array');
                  let {
                    flags: flags2,
                    mangleCache
                  } = flagsForTransformOptions(callName, options, isTTY, transformLogLevelDefault), request = {
                    command: "transform",
                    flags: flags2,
                    inputFS: inputPath !== null,
                    input: inputPath !== null ? encodeUTF8(inputPath) : typeof input == "string" ? encodeUTF8(input) : input
                  };
                  mangleCache && (request.mangleCache = mangleCache), sendRequest(refs, request, (error, response) => {
                    if (error) return callback(new Error(error), null);
                    let errors = replaceDetailsInMessages(response.errors, details), warnings = replaceDetailsInMessages(response.warnings, details), outstanding = 1, next = () => {
                      if (--outstanding === 0) {
                        let result = {
                          warnings,
                          code: response.code,
                          map: response.map,
                          mangleCache: void 0,
                          legalComments: void 0
                        };
                        "legalComments" in response && (result.legalComments = response?.legalComments), response.mangleCache && (result.mangleCache = response?.mangleCache), callback(null, result);
                      }
                    };
                    if (errors.length > 0) return callback(failureErrorWithLog("Transform failed", errors, warnings), null);
                    response.codeFS && (outstanding++, fs.readFile(response.code, (err2, contents) => {
                      err2 !== null ? callback(err2, null) : (response.code = contents, next());
                    })), response.mapFS && (outstanding++, fs.readFile(response.map, (err2, contents) => {
                      err2 !== null ? callback(err2, null) : (response.map = contents, next());
                    })), next();
                  });
                } catch (e) {
                  let flags2 = [];
                  try {
                    pushLogFlags(flags2, options, {}, isTTY, transformLogLevelDefault);
                  } catch {
                  }
                  let error = extractErrorMessageV8(e, streamIn, details, void 0, "");
                  sendRequest(refs, { command: "error", flags: flags2, error }, () => {
                    error.detail = details.load(error.detail), callback(failureErrorWithLog("Transform failed", [error], []), null);
                  });
                }
              };
              if ((typeof input == "string" || input instanceof Uint8Array) && input.length > 1024 * 1024) {
                let next = start;
                start = () => fs.writeFile(input, next);
              }
              start(null);
            },
            formatMessages: ({ callName, refs, messages, options, callback }) => {
              if (!options) throw new Error(`Missing second argument in ${callName}() call`);
              let keys = {}, kind = getFlag(options, keys, "kind", mustBeString), color2 = getFlag(options, keys, "color", mustBeBoolean), terminalWidth = getFlag(options, keys, "terminalWidth", mustBeInteger), logStyle = getFlag(options, keys, "logStyle", mustBeString);
              if (checkForInvalidFlags(options, keys, `in ${callName}() call`), kind === void 0) throw new Error(`Missing "kind" in ${callName}() call`);
              if (kind !== "error" && kind !== "warning") throw new Error(`Expected "kind" to be "error" or "warning" in ${callName}() call`);
              let request = {
                command: "format-msgs",
                messages: sanitizeMessages(messages, "messages", null, "", terminalWidth),
                isWarning: kind === "warning"
              };
              color2 !== void 0 && (request.color = color2), terminalWidth !== void 0 && (request.terminalWidth = terminalWidth), logStyle !== void 0 && (request.logStyle = logStyle), sendRequest(refs, request, (error, response) => {
                if (error) return callback(new Error(error), null);
                callback(null, response.messages);
              });
            },
            analyzeMetafile: ({ callName, refs, metafile, options, callback }) => {
              options === void 0 && (options = {});
              let keys = {}, color2 = getFlag(options, keys, "color", mustBeBoolean), verbose = getFlag(options, keys, "verbose", mustBeBoolean);
              checkForInvalidFlags(options, keys, `in ${callName}() call`);
              let request = {
                command: "analyze-metafile",
                metafile
              };
              color2 !== void 0 && (request.color = color2), verbose !== void 0 && (request.verbose = verbose), sendRequest(refs, request, (error, response) => {
                if (error) return callback(new Error(error), null);
                callback(null, response.result);
              });
            }
          }
        };
      }
      function buildOrContextImpl(callName, buildKey, sendRequest, sendResponse, refs, streamIn, requestCallbacks, options, isTTY, defaultWD, callback) {
        let details = createObjectStash(), isContext = callName === "context", handleError = (e, pluginName) => {
          let flags2 = [];
          try {
            pushLogFlags(flags2, options, {}, isTTY, buildLogLevelDefault);
          } catch {
          }
          let message = extractErrorMessageV8(e, streamIn, details, void 0, pluginName);
          sendRequest(refs, { command: "error", flags: flags2, error: message }, () => {
            message.detail = details.load(message.detail), callback(failureErrorWithLog(isContext ? "Context failed" : "Build failed", [message], []), null);
          });
        }, plugins;
        if (typeof options == "object") {
          let value = options.plugins;
          if (value !== void 0) {
            if (!Array.isArray(value)) return handleError(new Error('"plugins" must be an array'), "");
            plugins = value;
          }
        }
        if (plugins && plugins.length > 0) {
          if (streamIn.isSync) return handleError(new Error("Cannot use plugins in synchronous API calls"), "");
          handlePlugins(
            buildKey,
            sendRequest,
            sendResponse,
            refs,
            streamIn,
            requestCallbacks,
            options,
            plugins,
            details
          ).then(
            (result) => {
              if (!result.ok) return handleError(result.error, result.pluginName);
              try {
                buildOrContextContinue(result.requestPlugins, result.runOnEndCallbacks, result.scheduleOnDisposeCallbacks);
              } catch (e) {
                handleError(e, "");
              }
            },
            (e) => handleError(e, "")
          );
          return;
        }
        try {
          buildOrContextContinue(null, (result, done) => done([], []), () => {
          });
        } catch (e) {
          handleError(e, "");
        }
        function buildOrContextContinue(requestPlugins, runOnEndCallbacks, scheduleOnDisposeCallbacks) {
          let writeDefault = streamIn.hasFS, {
            entries,
            flags: flags2,
            write,
            stdinContents,
            stdinResolveDir,
            absWorkingDir,
            nodePaths,
            mangleCache
          } = flagsForBuildOptions(callName, options, isTTY, buildLogLevelDefault, writeDefault);
          if (write && !streamIn.hasFS) throw new Error('The "write" option is unavailable in this environment');
          let request = {
            command: "build",
            key: buildKey,
            entries,
            flags: flags2,
            write,
            stdinContents,
            stdinResolveDir,
            absWorkingDir: absWorkingDir || defaultWD,
            nodePaths,
            context: isContext
          };
          requestPlugins && (request.plugins = requestPlugins), mangleCache && (request.mangleCache = mangleCache);
          let buildResponseToResult = (response, callback2) => {
            let result = {
              errors: replaceDetailsInMessages(response.errors, details),
              warnings: replaceDetailsInMessages(response.warnings, details),
              outputFiles: void 0,
              metafile: void 0,
              mangleCache: void 0
            }, originalErrors = result.errors.slice(), originalWarnings = result.warnings.slice();
            response.outputFiles && (result.outputFiles = response.outputFiles.map(convertOutputFiles)), response.metafile && response.metafile.length && (result.metafile = parseJSON(response.metafile)), response.mangleCache && (result.mangleCache = response.mangleCache), response.writeToStdout !== void 0 && console.log(decodeUTF8(response.writeToStdout).replace(/\n$/, "")), runOnEndCallbacks(result, (onEndErrors, onEndWarnings) => {
              if (originalErrors.length > 0 || onEndErrors.length > 0) {
                let error = failureErrorWithLog("Build failed", originalErrors.concat(onEndErrors), originalWarnings.concat(onEndWarnings));
                return callback2(error, null, onEndErrors, onEndWarnings);
              }
              callback2(null, result, onEndErrors, onEndWarnings);
            });
          }, latestResultPromise, provideLatestResult;
          isContext && (requestCallbacks["on-end"] = (id, request2) => new Promise((resolve2) => {
            buildResponseToResult(request2, (err2, result, onEndErrors, onEndWarnings) => {
              let response = {
                errors: onEndErrors,
                warnings: onEndWarnings
              };
              provideLatestResult && provideLatestResult(err2, result), latestResultPromise = void 0, provideLatestResult = void 0, sendResponse(id, response), resolve2();
            });
          })), sendRequest(refs, request, (error, response) => {
            if (error) return callback(new Error(error), null);
            if (!isContext)
              return buildResponseToResult(response, (err2, res) => (scheduleOnDisposeCallbacks(), callback(err2, res)));
            if (response.errors.length > 0)
              return callback(failureErrorWithLog("Context failed", response.errors, response.warnings), null);
            let didDispose = !1, result = {
              rebuild: () => (latestResultPromise || (latestResultPromise = new Promise((resolve2, reject) => {
                let settlePromise;
                provideLatestResult = (err2, result2) => {
                  settlePromise || (settlePromise = () => err2 ? reject(err2) : resolve2(result2));
                };
                let triggerAnotherBuild = () => {
                  sendRequest(refs, {
                    command: "rebuild",
                    key: buildKey
                  }, (error2, response2) => {
                    error2 ? reject(new Error(error2)) : settlePromise ? settlePromise() : triggerAnotherBuild();
                  });
                };
                triggerAnotherBuild();
              })), latestResultPromise),
              watch: (options2 = {}) => new Promise((resolve2, reject) => {
                if (!streamIn.hasFS) throw new Error('Cannot use the "watch" API in this environment');
                let keys = {}, delay = getFlag(options2, keys, "delay", mustBeInteger);
                checkForInvalidFlags(options2, keys, "in watch() call");
                let request2 = {
                  command: "watch",
                  key: buildKey
                };
                delay && (request2.delay = delay), sendRequest(refs, request2, (error2) => {
                  error2 ? reject(new Error(error2)) : resolve2(void 0);
                });
              }),
              serve: (options2 = {}) => new Promise((resolve2, reject) => {
                if (!streamIn.hasFS) throw new Error('Cannot use the "serve" API in this environment');
                let keys = {}, port = getFlag(options2, keys, "port", mustBeValidPortNumber), host = getFlag(options2, keys, "host", mustBeString), servedir = getFlag(options2, keys, "servedir", mustBeString), keyfile = getFlag(options2, keys, "keyfile", mustBeString), certfile = getFlag(options2, keys, "certfile", mustBeString), fallback = getFlag(options2, keys, "fallback", mustBeString), cors = getFlag(options2, keys, "cors", mustBeObject), onRequest = getFlag(options2, keys, "onRequest", mustBeFunction);
                checkForInvalidFlags(options2, keys, "in serve() call");
                let request2 = {
                  command: "serve",
                  key: buildKey,
                  onRequest: !!onRequest
                };
                if (port !== void 0 && (request2.port = port), host !== void 0 && (request2.host = host), servedir !== void 0 && (request2.servedir = servedir), keyfile !== void 0 && (request2.keyfile = keyfile), certfile !== void 0 && (request2.certfile = certfile), fallback !== void 0 && (request2.fallback = fallback), cors) {
                  let corsKeys = {}, origin = getFlag(cors, corsKeys, "origin", mustBeStringOrArrayOfStrings);
                  checkForInvalidFlags(cors, corsKeys, 'on "cors" object'), Array.isArray(origin) ? request2.corsOrigin = origin : origin !== void 0 && (request2.corsOrigin = [origin]);
                }
                sendRequest(refs, request2, (error2, response2) => {
                  if (error2) return reject(new Error(error2));
                  onRequest && (requestCallbacks["serve-request"] = (id, request3) => {
                    onRequest(request3.args), sendResponse(id, {});
                  }), resolve2(response2);
                });
              }),
              cancel: () => new Promise((resolve2) => {
                if (didDispose) return resolve2();
                sendRequest(refs, {
                  command: "cancel",
                  key: buildKey
                }, () => {
                  resolve2();
                });
              }),
              dispose: () => new Promise((resolve2) => {
                if (didDispose) return resolve2();
                didDispose = !0, sendRequest(refs, {
                  command: "dispose",
                  key: buildKey
                }, () => {
                  resolve2(), scheduleOnDisposeCallbacks(), refs.unref();
                });
              })
            };
            refs.ref(), callback(null, result);
          });
        }
      }
      var handlePlugins = (buildKey, sendRequest, sendResponse, refs, streamIn, requestCallbacks, initialOptions, plugins, details) => __async(null, null, function* () {
        let onStartCallbacks = [], onEndCallbacks = [], onResolveCallbacks = {}, onLoadCallbacks = {}, onDisposeCallbacks = [], nextCallbackID = 0, i = 0, requestPlugins = [], isSetupDone = !1;
        plugins = [...plugins];
        for (let item of plugins) {
          let keys = {};
          if (typeof item != "object") throw new Error(`Plugin at index ${i} must be an object`);
          let name = getFlag(item, keys, "name", mustBeString);
          if (typeof name != "string" || name === "") throw new Error(`Plugin at index ${i} is missing a name`);
          try {
            let setup = getFlag(item, keys, "setup", mustBeFunction);
            if (typeof setup != "function") throw new Error("Plugin is missing a setup function");
            checkForInvalidFlags(item, keys, `on plugin ${quote2(name)}`);
            let plugin = {
              name,
              onStart: !1,
              onEnd: !1,
              onResolve: [],
              onLoad: []
            };
            i++;
            let promise = setup({
              initialOptions,
              resolve: (path2, options = {}) => {
                if (!isSetupDone) throw new Error('Cannot call "resolve" before plugin setup has completed');
                if (typeof path2 != "string") throw new Error("The path to resolve must be a string");
                let keys2 = /* @__PURE__ */ Object.create(null), pluginName = getFlag(options, keys2, "pluginName", mustBeString), importer = getFlag(options, keys2, "importer", mustBeString), namespace = getFlag(options, keys2, "namespace", mustBeString), resolveDir = getFlag(options, keys2, "resolveDir", mustBeString), kind = getFlag(options, keys2, "kind", mustBeString), pluginData = getFlag(options, keys2, "pluginData", canBeAnything), importAttributes = getFlag(options, keys2, "with", mustBeObject);
                return checkForInvalidFlags(options, keys2, "in resolve() call"), new Promise((resolve22, reject) => {
                  let request = {
                    command: "resolve",
                    path: path2,
                    key: buildKey,
                    pluginName: name
                  };
                  if (pluginName != null && (request.pluginName = pluginName), importer != null && (request.importer = importer), namespace != null && (request.namespace = namespace), resolveDir != null && (request.resolveDir = resolveDir), kind != null) request.kind = kind;
                  else throw new Error('Must specify "kind" when calling "resolve"');
                  pluginData != null && (request.pluginData = details.store(pluginData)), importAttributes != null && (request.with = sanitizeStringMap(importAttributes, "with")), sendRequest(refs, request, (error, response) => {
                    error !== null ? reject(new Error(error)) : resolve22({
                      errors: replaceDetailsInMessages(response.errors, details),
                      warnings: replaceDetailsInMessages(response.warnings, details),
                      path: response.path,
                      external: response.external,
                      sideEffects: response.sideEffects,
                      namespace: response.namespace,
                      suffix: response.suffix,
                      pluginData: details.load(response.pluginData)
                    });
                  });
                });
              },
              onStart(callback) {
                let registeredText = 'This error came from the "onStart" callback registered here:', registeredNote = extractCallerV8(new Error(registeredText), streamIn, "onStart");
                onStartCallbacks.push({ name, callback, note: registeredNote }), plugin.onStart = !0;
              },
              onEnd(callback) {
                let registeredText = 'This error came from the "onEnd" callback registered here:', registeredNote = extractCallerV8(new Error(registeredText), streamIn, "onEnd");
                onEndCallbacks.push({ name, callback, note: registeredNote }), plugin.onEnd = !0;
              },
              onResolve(options, callback) {
                let registeredText = 'This error came from the "onResolve" callback registered here:', registeredNote = extractCallerV8(new Error(registeredText), streamIn, "onResolve"), keys2 = {}, filter = getFlag(options, keys2, "filter", mustBeRegExp), namespace = getFlag(options, keys2, "namespace", mustBeString);
                if (checkForInvalidFlags(options, keys2, `in onResolve() call for plugin ${quote2(name)}`), filter == null) throw new Error("onResolve() call is missing a filter");
                let id = nextCallbackID++;
                onResolveCallbacks[id] = { name, callback, note: registeredNote }, plugin.onResolve.push({ id, filter: jsRegExpToGoRegExp(filter), namespace: namespace || "" });
              },
              onLoad(options, callback) {
                let registeredText = 'This error came from the "onLoad" callback registered here:', registeredNote = extractCallerV8(new Error(registeredText), streamIn, "onLoad"), keys2 = {}, filter = getFlag(options, keys2, "filter", mustBeRegExp), namespace = getFlag(options, keys2, "namespace", mustBeString);
                if (checkForInvalidFlags(options, keys2, `in onLoad() call for plugin ${quote2(name)}`), filter == null) throw new Error("onLoad() call is missing a filter");
                let id = nextCallbackID++;
                onLoadCallbacks[id] = { name, callback, note: registeredNote }, plugin.onLoad.push({ id, filter: jsRegExpToGoRegExp(filter), namespace: namespace || "" });
              },
              onDispose(callback) {
                onDisposeCallbacks.push(callback);
              },
              esbuild: streamIn.esbuild
            });
            promise && (yield promise), requestPlugins.push(plugin);
          } catch (e) {
            return { ok: !1, error: e, pluginName: name };
          }
        }
        requestCallbacks["on-start"] = (id, request) => __async(null, null, function* () {
          details.clear();
          let response = { errors: [], warnings: [] };
          yield Promise.all(onStartCallbacks.map((_0) => __async(null, [_0], function* ({ name, callback, note }) {
            try {
              let result = yield callback();
              if (result != null) {
                if (typeof result != "object") throw new Error(`Expected onStart() callback in plugin ${quote2(name)} to return an object`);
                let keys = {}, errors = getFlag(result, keys, "errors", mustBeArray), warnings = getFlag(result, keys, "warnings", mustBeArray);
                checkForInvalidFlags(result, keys, `from onStart() callback in plugin ${quote2(name)}`), errors != null && response.errors.push(...sanitizeMessages(errors, "errors", details, name, void 0)), warnings != null && response.warnings.push(...sanitizeMessages(warnings, "warnings", details, name, void 0));
              }
            } catch (e) {
              response.errors.push(extractErrorMessageV8(e, streamIn, details, note && note(), name));
            }
          }))), sendResponse(id, response);
        }), requestCallbacks["on-resolve"] = (id, request) => __async(null, null, function* () {
          let response = {}, name = "", callback, note;
          for (let id2 of request.ids)
            try {
              ({ name, callback, note } = onResolveCallbacks[id2]);
              let result = yield callback({
                path: request.path,
                importer: request.importer,
                namespace: request.namespace,
                resolveDir: request.resolveDir,
                kind: request.kind,
                pluginData: details.load(request.pluginData),
                with: request.with
              });
              if (result != null) {
                if (typeof result != "object") throw new Error(`Expected onResolve() callback in plugin ${quote2(name)} to return an object`);
                let keys = {}, pluginName = getFlag(result, keys, "pluginName", mustBeString), path2 = getFlag(result, keys, "path", mustBeString), namespace = getFlag(result, keys, "namespace", mustBeString), suffix = getFlag(result, keys, "suffix", mustBeString), external = getFlag(result, keys, "external", mustBeBoolean), sideEffects = getFlag(result, keys, "sideEffects", mustBeBoolean), pluginData = getFlag(result, keys, "pluginData", canBeAnything), errors = getFlag(result, keys, "errors", mustBeArray), warnings = getFlag(result, keys, "warnings", mustBeArray), watchFiles = getFlag(result, keys, "watchFiles", mustBeArrayOfStrings), watchDirs = getFlag(result, keys, "watchDirs", mustBeArrayOfStrings);
                checkForInvalidFlags(result, keys, `from onResolve() callback in plugin ${quote2(name)}`), response.id = id2, pluginName != null && (response.pluginName = pluginName), path2 != null && (response.path = path2), namespace != null && (response.namespace = namespace), suffix != null && (response.suffix = suffix), external != null && (response.external = external), sideEffects != null && (response.sideEffects = sideEffects), pluginData != null && (response.pluginData = details.store(pluginData)), errors != null && (response.errors = sanitizeMessages(errors, "errors", details, name, void 0)), warnings != null && (response.warnings = sanitizeMessages(warnings, "warnings", details, name, void 0)), watchFiles != null && (response.watchFiles = sanitizeStringArray(watchFiles, "watchFiles")), watchDirs != null && (response.watchDirs = sanitizeStringArray(watchDirs, "watchDirs"));
                break;
              }
            } catch (e) {
              response = { id: id2, errors: [extractErrorMessageV8(e, streamIn, details, note && note(), name)] };
              break;
            }
          sendResponse(id, response);
        }), requestCallbacks["on-load"] = (id, request) => __async(null, null, function* () {
          let response = {}, name = "", callback, note;
          for (let id2 of request.ids)
            try {
              ({ name, callback, note } = onLoadCallbacks[id2]);
              let result = yield callback({
                path: request.path,
                namespace: request.namespace,
                suffix: request.suffix,
                pluginData: details.load(request.pluginData),
                with: request.with
              });
              if (result != null) {
                if (typeof result != "object") throw new Error(`Expected onLoad() callback in plugin ${quote2(name)} to return an object`);
                let keys = {}, pluginName = getFlag(result, keys, "pluginName", mustBeString), contents = getFlag(result, keys, "contents", mustBeStringOrUint8Array), resolveDir = getFlag(result, keys, "resolveDir", mustBeString), pluginData = getFlag(result, keys, "pluginData", canBeAnything), loader = getFlag(result, keys, "loader", mustBeString), errors = getFlag(result, keys, "errors", mustBeArray), warnings = getFlag(result, keys, "warnings", mustBeArray), watchFiles = getFlag(result, keys, "watchFiles", mustBeArrayOfStrings), watchDirs = getFlag(result, keys, "watchDirs", mustBeArrayOfStrings);
                checkForInvalidFlags(result, keys, `from onLoad() callback in plugin ${quote2(name)}`), response.id = id2, pluginName != null && (response.pluginName = pluginName), contents instanceof Uint8Array ? response.contents = contents : contents != null && (response.contents = encodeUTF8(contents)), resolveDir != null && (response.resolveDir = resolveDir), pluginData != null && (response.pluginData = details.store(pluginData)), loader != null && (response.loader = loader), errors != null && (response.errors = sanitizeMessages(errors, "errors", details, name, void 0)), warnings != null && (response.warnings = sanitizeMessages(warnings, "warnings", details, name, void 0)), watchFiles != null && (response.watchFiles = sanitizeStringArray(watchFiles, "watchFiles")), watchDirs != null && (response.watchDirs = sanitizeStringArray(watchDirs, "watchDirs"));
                break;
              }
            } catch (e) {
              response = { id: id2, errors: [extractErrorMessageV8(e, streamIn, details, note && note(), name)] };
              break;
            }
          sendResponse(id, response);
        });
        let runOnEndCallbacks = (result, done) => done([], []);
        onEndCallbacks.length > 0 && (runOnEndCallbacks = (result, done) => {
          __async(null, null, function* () {
            let onEndErrors = [], onEndWarnings = [];
            for (let { name, callback, note } of onEndCallbacks) {
              let newErrors, newWarnings;
              try {
                let value = yield callback(result);
                if (value != null) {
                  if (typeof value != "object") throw new Error(`Expected onEnd() callback in plugin ${quote2(name)} to return an object`);
                  let keys = {}, errors = getFlag(value, keys, "errors", mustBeArray), warnings = getFlag(value, keys, "warnings", mustBeArray);
                  checkForInvalidFlags(value, keys, `from onEnd() callback in plugin ${quote2(name)}`), errors != null && (newErrors = sanitizeMessages(errors, "errors", details, name, void 0)), warnings != null && (newWarnings = sanitizeMessages(warnings, "warnings", details, name, void 0));
                }
              } catch (e) {
                newErrors = [extractErrorMessageV8(e, streamIn, details, note && note(), name)];
              }
              if (newErrors) {
                onEndErrors.push(...newErrors);
                try {
                  result.errors.push(...newErrors);
                } catch {
                }
              }
              if (newWarnings) {
                onEndWarnings.push(...newWarnings);
                try {
                  result.warnings.push(...newWarnings);
                } catch {
                }
              }
            }
            done(onEndErrors, onEndWarnings);
          });
        });
        let scheduleOnDisposeCallbacks = () => {
          for (let cb of onDisposeCallbacks)
            setTimeout(() => cb(), 0);
        };
        return isSetupDone = !0, {
          ok: !0,
          requestPlugins,
          runOnEndCallbacks,
          scheduleOnDisposeCallbacks
        };
      });
      function createObjectStash() {
        let map = /* @__PURE__ */ new Map(), nextID = 0;
        return {
          clear() {
            map.clear();
          },
          load(id) {
            return map.get(id);
          },
          store(value) {
            if (value === void 0) return -1;
            let id = nextID++;
            return map.set(id, value), id;
          }
        };
      }
      function extractCallerV8(e, streamIn, ident) {
        let note, tried = !1;
        return () => {
          if (tried) return note;
          tried = !0;
          try {
            let lines2 = (e.stack + "").split(`
`);
            lines2.splice(1, 1);
            let location2 = parseStackLinesV8(streamIn, lines2, ident);
            if (location2)
              return note = { text: e.message, location: location2 }, note;
          } catch {
          }
        };
      }
      function extractErrorMessageV8(e, streamIn, stash, note, pluginName) {
        let text = "Internal error", location2 = null;
        try {
          text = (e && e.message || e) + "";
        } catch {
        }
        try {
          location2 = parseStackLinesV8(streamIn, (e.stack + "").split(`
`), "");
        } catch {
        }
        return { id: "", pluginName, text, location: location2, notes: note ? [note] : [], detail: stash ? stash.store(e) : -1 };
      }
      function parseStackLinesV8(streamIn, lines2, ident) {
        let at = "    at ";
        if (streamIn.readFileSync && !lines2[0].startsWith(at) && lines2[1].startsWith(at))
          for (let i = 1; i < lines2.length; i++) {
            let line = lines2[i];
            if (line.startsWith(at))
              for (line = line.slice(at.length); ; ) {
                let match = /^(?:new |async )?\S+ \((.*)\)$/.exec(line);
                if (match) {
                  line = match[1];
                  continue;
                }
                if (match = /^eval at \S+ \((.*)\)(?:, \S+:\d+:\d+)?$/.exec(line), match) {
                  line = match[1];
                  continue;
                }
                if (match = /^(\S+):(\d+):(\d+)$/.exec(line), match) {
                  let contents;
                  try {
                    contents = streamIn.readFileSync(match[1], "utf8");
                  } catch {
                    break;
                  }
                  let lineText = contents.split(/\r\n|\r|\n|\u2028|\u2029/)[+match[2] - 1] || "", column = +match[3] - 1, length = lineText.slice(column, column + ident.length) === ident ? ident.length : 0;
                  return {
                    file: match[1],
                    namespace: "file",
                    line: +match[2],
                    column: encodeUTF8(lineText.slice(0, column)).length,
                    length: encodeUTF8(lineText.slice(column, column + length)).length,
                    lineText: lineText + `
` + lines2.slice(1).join(`
`),
                    suggestion: ""
                  };
                }
                break;
              }
          }
        return null;
      }
      function failureErrorWithLog(text, errors, warnings) {
        let limit = 5;
        text += errors.length < 1 ? "" : ` with ${errors.length} error${errors.length < 2 ? "" : "s"}:` + errors.slice(0, limit + 1).map((e, i) => {
          if (i === limit) return `
...`;
          if (!e.location) return `
error: ${e.text}`;
          let { file, line, column } = e.location, pluginText = e.pluginName ? `[plugin: ${e.pluginName}] ` : "";
          return `
${file}:${line}:${column}: ERROR: ${pluginText}${e.text}`;
        }).join("");
        let error = new Error(text);
        for (let [key, value] of [["errors", errors], ["warnings", warnings]])
          Object.defineProperty(error, key, {
            configurable: !0,
            enumerable: !0,
            get: () => value,
            set: (value2) => Object.defineProperty(error, key, {
              configurable: !0,
              enumerable: !0,
              value: value2
            })
          });
        return error;
      }
      function replaceDetailsInMessages(messages, stash) {
        for (let message of messages)
          message.detail = stash.load(message.detail);
        return messages;
      }
      function sanitizeLocation(location2, where, terminalWidth) {
        if (location2 == null) return null;
        let keys = {}, file = getFlag(location2, keys, "file", mustBeString), namespace = getFlag(location2, keys, "namespace", mustBeString), line = getFlag(location2, keys, "line", mustBeInteger), column = getFlag(location2, keys, "column", mustBeInteger), length = getFlag(location2, keys, "length", mustBeInteger), lineText = getFlag(location2, keys, "lineText", mustBeString), suggestion = getFlag(location2, keys, "suggestion", mustBeString);
        if (checkForInvalidFlags(location2, keys, where), lineText) {
          let relevantASCII = lineText.slice(
            0,
            (column && column > 0 ? column : 0) + (length && length > 0 ? length : 0) + (terminalWidth && terminalWidth > 0 ? terminalWidth : 80)
          );
          !/[\x7F-\uFFFF]/.test(relevantASCII) && !/\n/.test(lineText) && (lineText = relevantASCII);
        }
        return {
          file: file || "",
          namespace: namespace || "",
          line: line || 0,
          column: column || 0,
          length: length || 0,
          lineText: lineText || "",
          suggestion: suggestion || ""
        };
      }
      function sanitizeMessages(messages, property, stash, fallbackPluginName, terminalWidth) {
        let messagesClone = [], index = 0;
        for (let message of messages) {
          let keys = {}, id = getFlag(message, keys, "id", mustBeString), pluginName = getFlag(message, keys, "pluginName", mustBeString), text = getFlag(message, keys, "text", mustBeString), location2 = getFlag(message, keys, "location", mustBeObjectOrNull), notes = getFlag(message, keys, "notes", mustBeArray), detail = getFlag(message, keys, "detail", canBeAnything), where = `in element ${index} of "${property}"`;
          checkForInvalidFlags(message, keys, where);
          let notesClone = [];
          if (notes)
            for (let note of notes) {
              let noteKeys = {}, noteText = getFlag(note, noteKeys, "text", mustBeString), noteLocation = getFlag(note, noteKeys, "location", mustBeObjectOrNull);
              checkForInvalidFlags(note, noteKeys, where), notesClone.push({
                text: noteText || "",
                location: sanitizeLocation(noteLocation, where, terminalWidth)
              });
            }
          messagesClone.push({
            id: id || "",
            pluginName: pluginName || fallbackPluginName,
            text: text || "",
            location: sanitizeLocation(location2, where, terminalWidth),
            notes: notesClone,
            detail: stash ? stash.store(detail) : -1
          }), index++;
        }
        return messagesClone;
      }
      function sanitizeStringArray(values, property) {
        let result = [];
        for (let value of values) {
          if (typeof value != "string") throw new Error(`${quote2(property)} must be an array of strings`);
          result.push(value);
        }
        return result;
      }
      function sanitizeStringMap(map, property) {
        let result = /* @__PURE__ */ Object.create(null);
        for (let key in map) {
          let value = map[key];
          if (typeof value != "string") throw new Error(`key ${quote2(key)} in object ${quote2(property)} must be a string`);
          result[key] = value;
        }
        return result;
      }
      function convertOutputFiles({ path: path2, contents, hash }) {
        let text = null;
        return {
          path: path2,
          contents,
          hash,
          get text() {
            let binary = this.contents;
            return (text === null || binary !== contents) && (contents = binary, text = decodeUTF8(binary)), text;
          }
        };
      }
      function jsRegExpToGoRegExp(regexp) {
        let result = regexp.source;
        return regexp.flags && (result = `(?${regexp.flags})${result}`), result;
      }
      function parseJSON(bytes) {
        let text;
        try {
          text = decodeUTF8(bytes);
        } catch {
          return JSON_parse(bytes);
        }
        return JSON.parse(text);
      }
      var version2 = "0.28.2", build2 = (options) => ensureServiceIsRunning().build(options), context = (options) => ensureServiceIsRunning().context(options), transform = (input, options) => ensureServiceIsRunning().transform(input, options), formatMessages = (messages, options) => ensureServiceIsRunning().formatMessages(messages, options), analyzeMetafile = (metafile, options) => ensureServiceIsRunning().analyzeMetafile(metafile, options), buildSync = () => {
        throw new Error('The "buildSync" API only works in node');
      }, transformSync = () => {
        throw new Error('The "transformSync" API only works in node');
      }, formatMessagesSync = () => {
        throw new Error('The "formatMessagesSync" API only works in node');
      }, analyzeMetafileSync = () => {
        throw new Error('The "analyzeMetafileSync" API only works in node');
      }, stop = () => (stopService && stopService(), Promise.resolve()), initializePromise, stopService, longLivedService, ensureServiceIsRunning = () => {
        if (longLivedService) return longLivedService;
        throw initializePromise ? new Error('You need to wait for the promise returned from "initialize" to be resolved before calling this') : new Error('You need to call "initialize" before calling this');
      }, initialize2 = (options) => {
        options = validateInitializeOptions(options || {});
        let wasmURL = options.wasmURL, wasmModule = options.wasmModule, useWorker = options.worker !== !1;
        if (!wasmURL && !wasmModule) throw new Error('Must provide either the "wasmURL" option or the "wasmModule" option');
        if (initializePromise) throw new Error('Cannot call "initialize" more than once');
        return initializePromise = startRunningService(wasmURL || "", wasmModule, useWorker), initializePromise.catch(() => {
          initializePromise = void 0;
        }), initializePromise;
      }, startRunningService = (wasmURL, wasmModule, useWorker) => __async(null, null, function* () {
        let worker, rejectAllWith, rejectAllPromise = new Promise((resolve2) => rejectAllWith = resolve2);
        if (useWorker) {
          let blob = new Blob([`onmessage=((postMessage) => {
      // Copyright 2018 The Go Authors. All rights reserved.
      // Use of this source code is governed by a BSD-style
      // license that can be found in the LICENSE file.
      var __async = (__this, __arguments, generator) => {
        return new Promise((resolve, reject) => {
          var fulfilled = (value) => {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          };
          var rejected = (value) => {
            try {
              step(generator.throw(value));
            } catch (e) {
              reject(e);
            }
          };
          var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
          step((generator = generator.apply(__this, __arguments)).next());
        });
      };
      let onmessage;
      let globalThis = {};
      for (let o = self; o; o = Object.getPrototypeOf(o))
        for (let k of Object.getOwnPropertyNames(o))
          if (!(k in globalThis))
            Object.defineProperty(globalThis, k, { get: () => self[k] });
      "use strict";
      (() => {
        const enosys = () => {
          const err = new Error("not implemented");
          err.code = "ENOSYS";
          return err;
        };
        if (!globalThis.fs) {
          let outputBuf = "";
          globalThis.fs = {
            constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 },
            // unused
            writeSync(fd, buf) {
              outputBuf += decoder.decode(buf);
              const nl = outputBuf.lastIndexOf("\\n");
              if (nl != -1) {
                console.log(outputBuf.substring(0, nl));
                outputBuf = outputBuf.substring(nl + 1);
              }
              return buf.length;
            },
            write(fd, buf, offset, length, position, callback) {
              if (offset !== 0 || length !== buf.length || position !== null) {
                callback(enosys());
                return;
              }
              const n = this.writeSync(fd, buf);
              callback(null, n);
            },
            chmod(path, mode, callback) {
              callback(enosys());
            },
            chown(path, uid, gid, callback) {
              callback(enosys());
            },
            close(fd, callback) {
              callback(enosys());
            },
            fchmod(fd, mode, callback) {
              callback(enosys());
            },
            fchown(fd, uid, gid, callback) {
              callback(enosys());
            },
            fstat(fd, callback) {
              callback(enosys());
            },
            fsync(fd, callback) {
              callback(null);
            },
            ftruncate(fd, length, callback) {
              callback(enosys());
            },
            lchown(path, uid, gid, callback) {
              callback(enosys());
            },
            link(path, link, callback) {
              callback(enosys());
            },
            lstat(path, callback) {
              callback(enosys());
            },
            mkdir(path, perm, callback) {
              callback(enosys());
            },
            open(path, flags, mode, callback) {
              callback(enosys());
            },
            read(fd, buffer, offset, length, position, callback) {
              callback(enosys());
            },
            readdir(path, callback) {
              callback(enosys());
            },
            readlink(path, callback) {
              callback(enosys());
            },
            rename(from, to, callback) {
              callback(enosys());
            },
            rmdir(path, callback) {
              callback(enosys());
            },
            stat(path, callback) {
              callback(enosys());
            },
            symlink(path, link, callback) {
              callback(enosys());
            },
            truncate(path, length, callback) {
              callback(enosys());
            },
            unlink(path, callback) {
              callback(enosys());
            },
            utimes(path, atime, mtime, callback) {
              callback(enosys());
            }
          };
        }
        if (!globalThis.process) {
          globalThis.process = {
            getuid() {
              return -1;
            },
            getgid() {
              return -1;
            },
            geteuid() {
              return -1;
            },
            getegid() {
              return -1;
            },
            getgroups() {
              throw enosys();
            },
            pid: -1,
            ppid: -1,
            umask() {
              throw enosys();
            },
            cwd() {
              throw enosys();
            },
            chdir() {
              throw enosys();
            }
          };
        }
        if (!globalThis.path) {
          globalThis.path = {
            resolve(...pathSegments) {
              return pathSegments.join("/");
            }
          };
        }
        if (!globalThis.crypto) {
          throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
        }
        if (!globalThis.performance) {
          throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
        }
        if (!globalThis.TextEncoder) {
          throw new Error("globalThis.TextEncoder is not available, polyfill required");
        }
        if (!globalThis.TextDecoder) {
          throw new Error("globalThis.TextDecoder is not available, polyfill required");
        }
        const encoder = new TextEncoder("utf-8");
        const decoder = new TextDecoder("utf-8");
        globalThis.Go = class {
          constructor() {
            this.argv = ["js"];
            this.env = {};
            this.exit = (code) => {
              if (code !== 0) {
                console.warn("exit code:", code);
              }
            };
            this._exitPromise = new Promise((resolve) => {
              this._resolveExitPromise = resolve;
            });
            this._pendingEvent = null;
            this._scheduledTimeouts = /* @__PURE__ */ new Map();
            this._nextCallbackTimeoutID = 1;
            const setInt64 = (addr, v) => {
              this.mem.setUint32(addr + 0, v, true);
              this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), true);
            };
            const setInt32 = (addr, v) => {
              this.mem.setUint32(addr + 0, v, true);
            };
            const getInt64 = (addr) => {
              const low = this.mem.getUint32(addr + 0, true);
              const high = this.mem.getInt32(addr + 4, true);
              return low + high * 4294967296;
            };
            const loadValue = (addr) => {
              const f = this.mem.getFloat64(addr, true);
              if (f === 0) {
                return void 0;
              }
              if (!isNaN(f)) {
                return f;
              }
              const id = this.mem.getUint32(addr, true);
              return this._values[id];
            };
            const storeValue = (addr, v) => {
              const nanHead = 2146959360;
              if (typeof v === "number" && v !== 0) {
                if (isNaN(v)) {
                  this.mem.setUint32(addr + 4, nanHead, true);
                  this.mem.setUint32(addr, 0, true);
                  return;
                }
                this.mem.setFloat64(addr, v, true);
                return;
              }
              if (v === void 0) {
                this.mem.setFloat64(addr, 0, true);
                return;
              }
              let id = this._ids.get(v);
              if (id === void 0) {
                id = this._idPool.pop();
                if (id === void 0) {
                  id = this._values.length;
                }
                this._values[id] = v;
                this._goRefCounts[id] = 0;
                this._ids.set(v, id);
              }
              this._goRefCounts[id]++;
              let typeFlag = 0;
              switch (typeof v) {
                case "object":
                  if (v !== null) {
                    typeFlag = 1;
                  }
                  break;
                case "string":
                  typeFlag = 2;
                  break;
                case "symbol":
                  typeFlag = 3;
                  break;
                case "function":
                  typeFlag = 4;
                  break;
              }
              this.mem.setUint32(addr + 4, nanHead | typeFlag, true);
              this.mem.setUint32(addr, id, true);
            };
            const loadSlice = (addr) => {
              const array = getInt64(addr + 0);
              const len = getInt64(addr + 8);
              return new Uint8Array(this._inst.exports.mem.buffer, array, len);
            };
            const loadSliceOfValues = (addr) => {
              const array = getInt64(addr + 0);
              const len = getInt64(addr + 8);
              const a = new Array(len);
              for (let i = 0; i < len; i++) {
                a[i] = loadValue(array + i * 8);
              }
              return a;
            };
            const loadString = (addr) => {
              const saddr = getInt64(addr + 0);
              const len = getInt64(addr + 8);
              return decoder.decode(new DataView(this._inst.exports.mem.buffer, saddr, len));
            };
            const testCallExport = (a, b) => {
              this._inst.exports.testExport0();
              return this._inst.exports.testExport(a, b);
            };
            const timeOrigin = Date.now() - performance.now();
            this.importObject = {
              _gotest: {
                add: (a, b) => a + b,
                callExport: testCallExport
              },
              gojs: {
                // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
                // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
                // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
                // This changes the SP, thus we have to update the SP used by the imported function.
                // func wasmExit(code int32)
                "runtime.wasmExit": (sp) => {
                  sp >>>= 0;
                  const code = this.mem.getInt32(sp + 8, true);
                  this.exited = true;
                  delete this._inst;
                  delete this._values;
                  delete this._goRefCounts;
                  delete this._ids;
                  delete this._idPool;
                  this.exit(code);
                },
                // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
                "runtime.wasmWrite": (sp) => {
                  sp >>>= 0;
                  const fd = getInt64(sp + 8);
                  const p = getInt64(sp + 16);
                  const n = this.mem.getInt32(sp + 24, true);
                  globalThis.fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n));
                },
                // func resetMemoryDataView()
                "runtime.resetMemoryDataView": (sp) => {
                  sp >>>= 0;
                  this.mem = new DataView(this._inst.exports.mem.buffer);
                },
                // func nanotime1() int64
                "runtime.nanotime1": (sp) => {
                  sp >>>= 0;
                  setInt64(sp + 8, (timeOrigin + performance.now()) * 1e6);
                },
                // func walltime() (sec int64, nsec int32)
                "runtime.walltime": (sp) => {
                  sp >>>= 0;
                  const msec = (/* @__PURE__ */ new Date()).getTime();
                  setInt64(sp + 8, msec / 1e3);
                  this.mem.setInt32(sp + 16, msec % 1e3 * 1e6, true);
                },
                // func scheduleTimeoutEvent(delay int64) int32
                "runtime.scheduleTimeoutEvent": (sp) => {
                  sp >>>= 0;
                  const id = this._nextCallbackTimeoutID;
                  this._nextCallbackTimeoutID++;
                  this._scheduledTimeouts.set(id, setTimeout(
                    () => {
                      this._resume();
                      while (this._scheduledTimeouts.has(id)) {
                        console.warn("scheduleTimeoutEvent: missed timeout event");
                        this._resume();
                      }
                    },
                    getInt64(sp + 8)
                  ));
                  this.mem.setInt32(sp + 16, id, true);
                },
                // func clearTimeoutEvent(id int32)
                "runtime.clearTimeoutEvent": (sp) => {
                  sp >>>= 0;
                  const id = this.mem.getInt32(sp + 8, true);
                  clearTimeout(this._scheduledTimeouts.get(id));
                  this._scheduledTimeouts.delete(id);
                },
                // func getRandomData(r []byte)
                "runtime.getRandomData": (sp) => {
                  sp >>>= 0;
                  crypto.getRandomValues(loadSlice(sp + 8));
                },
                // func finalizeRef(v ref)
                "syscall/js.finalizeRef": (sp) => {
                  sp >>>= 0;
                  const id = this.mem.getUint32(sp + 8, true);
                  this._goRefCounts[id]--;
                  if (this._goRefCounts[id] === 0) {
                    const v = this._values[id];
                    this._values[id] = null;
                    this._ids.delete(v);
                    this._idPool.push(id);
                  }
                },
                // func stringVal(value string) ref
                "syscall/js.stringVal": (sp) => {
                  sp >>>= 0;
                  storeValue(sp + 24, loadString(sp + 8));
                },
                // func valueGet(v ref, p string) ref
                "syscall/js.valueGet": (sp) => {
                  sp >>>= 0;
                  const result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
                  sp = this._inst.exports.getsp() >>> 0;
                  storeValue(sp + 32, result);
                },
                // func valueSet(v ref, p string, x ref)
                "syscall/js.valueSet": (sp) => {
                  sp >>>= 0;
                  Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
                },
                // func valueDelete(v ref, p string)
                "syscall/js.valueDelete": (sp) => {
                  sp >>>= 0;
                  Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
                },
                // func valueIndex(v ref, i int) ref
                "syscall/js.valueIndex": (sp) => {
                  sp >>>= 0;
                  storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
                },
                // valueSetIndex(v ref, i int, x ref)
                "syscall/js.valueSetIndex": (sp) => {
                  sp >>>= 0;
                  Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
                },
                // func valueCall(v ref, m string, args []ref) (ref, bool)
                "syscall/js.valueCall": (sp) => {
                  sp >>>= 0;
                  try {
                    const v = loadValue(sp + 8);
                    const m = Reflect.get(v, loadString(sp + 16));
                    const args = loadSliceOfValues(sp + 32);
                    const result = Reflect.apply(m, v, args);
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 56, result);
                    this.mem.setUint8(sp + 64, 1);
                  } catch (err) {
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 56, err);
                    this.mem.setUint8(sp + 64, 0);
                  }
                },
                // func valueInvoke(v ref, args []ref) (ref, bool)
                "syscall/js.valueInvoke": (sp) => {
                  sp >>>= 0;
                  try {
                    const v = loadValue(sp + 8);
                    const args = loadSliceOfValues(sp + 16);
                    const result = Reflect.apply(v, void 0, args);
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                  } catch (err) {
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                  }
                },
                // func valueNew(v ref, args []ref) (ref, bool)
                "syscall/js.valueNew": (sp) => {
                  sp >>>= 0;
                  try {
                    const v = loadValue(sp + 8);
                    const args = loadSliceOfValues(sp + 16);
                    const result = Reflect.construct(v, args);
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 40, result);
                    this.mem.setUint8(sp + 48, 1);
                  } catch (err) {
                    sp = this._inst.exports.getsp() >>> 0;
                    storeValue(sp + 40, err);
                    this.mem.setUint8(sp + 48, 0);
                  }
                },
                // func valueLength(v ref) int
                "syscall/js.valueLength": (sp) => {
                  sp >>>= 0;
                  setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
                },
                // valuePrepareString(v ref) (ref, int)
                "syscall/js.valuePrepareString": (sp) => {
                  sp >>>= 0;
                  const str = encoder.encode(String(loadValue(sp + 8)));
                  storeValue(sp + 16, str);
                  setInt64(sp + 24, str.length);
                },
                // valueLoadString(v ref, b []byte)
                "syscall/js.valueLoadString": (sp) => {
                  sp >>>= 0;
                  const str = loadValue(sp + 8);
                  loadSlice(sp + 16).set(str);
                },
                // func valueInstanceOf(v ref, t ref) bool
                "syscall/js.valueInstanceOf": (sp) => {
                  sp >>>= 0;
                  this.mem.setUint8(sp + 24, loadValue(sp + 8) instanceof loadValue(sp + 16) ? 1 : 0);
                },
                // func copyBytesToGo(dst []byte, src ref) (int, bool)
                "syscall/js.copyBytesToGo": (sp) => {
                  sp >>>= 0;
                  const dst = loadSlice(sp + 8);
                  const src = loadValue(sp + 32);
                  if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
                    this.mem.setUint8(sp + 48, 0);
                    return;
                  }
                  const toCopy = src.subarray(0, dst.length);
                  dst.set(toCopy);
                  setInt64(sp + 40, toCopy.length);
                  this.mem.setUint8(sp + 48, 1);
                },
                // func copyBytesToJS(dst ref, src []byte) (int, bool)
                "syscall/js.copyBytesToJS": (sp) => {
                  sp >>>= 0;
                  const dst = loadValue(sp + 8);
                  const src = loadSlice(sp + 16);
                  if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
                    this.mem.setUint8(sp + 48, 0);
                    return;
                  }
                  const toCopy = src.subarray(0, dst.length);
                  dst.set(toCopy);
                  setInt64(sp + 40, toCopy.length);
                  this.mem.setUint8(sp + 48, 1);
                },
                "debug": (value) => {
                  console.log(value);
                }
              }
            };
          }
          run(instance) {
            return __async(this, null, function* () {
              if (!(instance instanceof WebAssembly.Instance)) {
                throw new Error("Go.run: WebAssembly.Instance expected");
              }
              this._inst = instance;
              this.mem = new DataView(this._inst.exports.mem.buffer);
              this._values = [
                // JS values that Go currently has references to, indexed by reference id
                NaN,
                0,
                null,
                true,
                false,
                globalThis,
                this
              ];
              this._goRefCounts = new Array(this._values.length).fill(Infinity);
              this._ids = /* @__PURE__ */ new Map([
                // mapping from JS values to reference ids
                [0, 1],
                [null, 2],
                [true, 3],
                [false, 4],
                [globalThis, 5],
                [this, 6]
              ]);
              this._idPool = [];
              this.exited = false;
              let offset = 4096;
              const strPtr = (str) => {
                const ptr = offset;
                const bytes = encoder.encode(str + "\\0");
                new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes);
                offset += bytes.length;
                if (offset % 8 !== 0) {
                  offset += 8 - offset % 8;
                }
                return ptr;
              };
              const argc = this.argv.length;
              const argvPtrs = [];
              this.argv.forEach((arg) => {
                argvPtrs.push(strPtr(arg));
              });
              argvPtrs.push(0);
              const keys = Object.keys(this.env).sort();
              keys.forEach((key) => {
                argvPtrs.push(strPtr(\`\${key}=\${this.env[key]}\`));
              });
              argvPtrs.push(0);
              const argv = offset;
              argvPtrs.forEach((ptr) => {
                this.mem.setUint32(offset, ptr, true);
                this.mem.setUint32(offset + 4, 0, true);
                offset += 8;
              });
              const wasmMinDataAddr = 4096 + 8192;
              if (offset >= wasmMinDataAddr) {
                throw new Error("total length of command line and environment variables exceeds limit");
              }
              this._inst.exports.run(argc, argv);
              if (this.exited) {
                this._resolveExitPromise();
              }
              yield this._exitPromise;
            });
          }
          _resume() {
            if (this.exited) {
              throw new Error("Go program has already exited");
            }
            this._inst.exports.resume();
            if (this.exited) {
              this._resolveExitPromise();
            }
          }
          _makeFuncWrapper(id) {
            const go = this;
            return function() {
              const event = { id, this: this, args: arguments };
              go._pendingEvent = event;
              go._resume();
              return event.result;
            };
          }
        };
      })();
      onmessage = ({ data: wasm }) => {
        let decoder = new TextDecoder();
        let fs = globalThis.fs;
        let stderr = "";
        fs.writeSync = (fd, buffer) => {
          if (fd === 1) {
            postMessage(buffer);
          } else if (fd === 2) {
            stderr += decoder.decode(buffer);
            let parts = stderr.split("\\n");
            if (parts.length > 1) console.log(parts.slice(0, -1).join("\\n"));
            stderr = parts[parts.length - 1];
          } else {
            throw new Error("Bad write");
          }
          return buffer.length;
        };
        let stdin = [];
        let resumeStdin;
        let stdinPos = 0;
        onmessage = ({ data }) => {
          if (data.length > 0) {
            stdin.push(data);
            if (resumeStdin) resumeStdin();
          }
          return go;
        };
        fs.read = (fd, buffer, offset, length, position, callback) => {
          if (fd !== 0 || offset !== 0 || length !== buffer.length || position !== null) {
            throw new Error("Bad read");
          }
          if (stdin.length === 0) {
            resumeStdin = () => fs.read(fd, buffer, offset, length, position, callback);
            return;
          }
          let first = stdin[0];
          let count = Math.max(0, Math.min(length, first.length - stdinPos));
          buffer.set(first.subarray(stdinPos, stdinPos + count), offset);
          stdinPos += count;
          if (stdinPos === first.length) {
            stdin.shift();
            stdinPos = 0;
          }
          callback(null, count);
        };
        let go = new globalThis.Go();
        go.argv = ["", \`--service=\${"0.28.2"}\`];
        tryToInstantiateModule(wasm, go).then(
          (instance) => {
            postMessage(null);
            go.run(instance);
          },
          (error) => {
            postMessage(error);
          }
        );
        return go;
      };
      function tryToInstantiateModule(wasm, go) {
        return __async(this, null, function* () {
          if (wasm instanceof WebAssembly.Module) {
            return WebAssembly.instantiate(wasm, go.importObject);
          }
          const res = yield fetch(wasm);
          if (!res.ok) throw new Error(\`Failed to download \${JSON.stringify(wasm)}\`);
          if ("instantiateStreaming" in WebAssembly && /^application\\/wasm($|;)/i.test(res.headers.get("Content-Type") || "")) {
            const result2 = yield WebAssembly.instantiateStreaming(res, go.importObject);
            return result2.instance;
          }
          const bytes = yield res.arrayBuffer();
          const result = yield WebAssembly.instantiate(bytes, go.importObject);
          return result.instance;
        });
      }
      return (m) => onmessage(m);
    })(postMessage)`], { type: "text/javascript" });
          worker = new Worker(URL.createObjectURL(blob));
        } else {
          let onmessage = ((postMessage) => {
            var __async2 = (__this, __arguments, generator) => new Promise((resolve2, reject) => {
              var fulfilled = (value) => {
                try {
                  step(generator.next(value));
                } catch (e) {
                  reject(e);
                }
              }, rejected = (value) => {
                try {
                  step(generator.throw(value));
                } catch (e) {
                  reject(e);
                }
              }, step = (x) => x.done ? resolve2(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
              step((generator = generator.apply(__this, __arguments)).next());
            });
            let onmessage2, globalThis2 = {};
            for (let o = self; o; o = Object.getPrototypeOf(o))
              for (let k of Object.getOwnPropertyNames(o))
                k in globalThis2 || Object.defineProperty(globalThis2, k, { get: () => self[k] });
            (() => {
              let enosys = () => {
                let err2 = new Error("not implemented");
                return err2.code = "ENOSYS", err2;
              };
              if (!globalThis2.fs) {
                let outputBuf = "";
                globalThis2.fs = {
                  constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 },
                  // unused
                  writeSync(fd, buf) {
                    outputBuf += decoder.decode(buf);
                    let nl = outputBuf.lastIndexOf(`
`);
                    return nl != -1 && (console.log(outputBuf.substring(0, nl)), outputBuf = outputBuf.substring(nl + 1)), buf.length;
                  },
                  write(fd, buf, offset, length, position, callback) {
                    if (offset !== 0 || length !== buf.length || position !== null) {
                      callback(enosys());
                      return;
                    }
                    let n = this.writeSync(fd, buf);
                    callback(null, n);
                  },
                  chmod(path2, mode, callback) {
                    callback(enosys());
                  },
                  chown(path2, uid, gid, callback) {
                    callback(enosys());
                  },
                  close(fd, callback) {
                    callback(enosys());
                  },
                  fchmod(fd, mode, callback) {
                    callback(enosys());
                  },
                  fchown(fd, uid, gid, callback) {
                    callback(enosys());
                  },
                  fstat(fd, callback) {
                    callback(enosys());
                  },
                  fsync(fd, callback) {
                    callback(null);
                  },
                  ftruncate(fd, length, callback) {
                    callback(enosys());
                  },
                  lchown(path2, uid, gid, callback) {
                    callback(enosys());
                  },
                  link(path2, link, callback) {
                    callback(enosys());
                  },
                  lstat(path2, callback) {
                    callback(enosys());
                  },
                  mkdir(path2, perm, callback) {
                    callback(enosys());
                  },
                  open(path2, flags2, mode, callback) {
                    callback(enosys());
                  },
                  read(fd, buffer, offset, length, position, callback) {
                    callback(enosys());
                  },
                  readdir(path2, callback) {
                    callback(enosys());
                  },
                  readlink(path2, callback) {
                    callback(enosys());
                  },
                  rename(from, to, callback) {
                    callback(enosys());
                  },
                  rmdir(path2, callback) {
                    callback(enosys());
                  },
                  stat(path2, callback) {
                    callback(enosys());
                  },
                  symlink(path2, link, callback) {
                    callback(enosys());
                  },
                  truncate(path2, length, callback) {
                    callback(enosys());
                  },
                  unlink(path2, callback) {
                    callback(enosys());
                  },
                  utimes(path2, atime, mtime, callback) {
                    callback(enosys());
                  }
                };
              }
              if (globalThis2.process || (globalThis2.process = {
                getuid() {
                  return -1;
                },
                getgid() {
                  return -1;
                },
                geteuid() {
                  return -1;
                },
                getegid() {
                  return -1;
                },
                getgroups() {
                  throw enosys();
                },
                pid: -1,
                ppid: -1,
                umask() {
                  throw enosys();
                },
                cwd() {
                  throw enosys();
                },
                chdir() {
                  throw enosys();
                }
              }), globalThis2.path || (globalThis2.path = {
                resolve(...pathSegments) {
                  return pathSegments.join("/");
                }
              }), !globalThis2.crypto)
                throw new Error("globalThis.crypto is not available, polyfill required (crypto.getRandomValues only)");
              if (!globalThis2.performance)
                throw new Error("globalThis.performance is not available, polyfill required (performance.now only)");
              if (!globalThis2.TextEncoder)
                throw new Error("globalThis.TextEncoder is not available, polyfill required");
              if (!globalThis2.TextDecoder)
                throw new Error("globalThis.TextDecoder is not available, polyfill required");
              let encoder = new TextEncoder("utf-8"), decoder = new TextDecoder("utf-8");
              globalThis2.Go = class {
                constructor() {
                  this.argv = ["js"], this.env = {}, this.exit = (code) => {
                    code !== 0 && console.warn("exit code:", code);
                  }, this._exitPromise = new Promise((resolve2) => {
                    this._resolveExitPromise = resolve2;
                  }), this._pendingEvent = null, this._scheduledTimeouts = /* @__PURE__ */ new Map(), this._nextCallbackTimeoutID = 1;
                  let setInt64 = (addr, v) => {
                    this.mem.setUint32(addr + 0, v, !0), this.mem.setUint32(addr + 4, Math.floor(v / 4294967296), !0);
                  }, setInt32 = (addr, v) => {
                    this.mem.setUint32(addr + 0, v, !0);
                  }, getInt64 = (addr) => {
                    let low = this.mem.getUint32(addr + 0, !0), high = this.mem.getInt32(addr + 4, !0);
                    return low + high * 4294967296;
                  }, loadValue = (addr) => {
                    let f = this.mem.getFloat64(addr, !0);
                    if (f === 0)
                      return;
                    if (!isNaN(f))
                      return f;
                    let id = this.mem.getUint32(addr, !0);
                    return this._values[id];
                  }, storeValue = (addr, v) => {
                    if (typeof v == "number" && v !== 0) {
                      if (isNaN(v)) {
                        this.mem.setUint32(addr + 4, 2146959360, !0), this.mem.setUint32(addr, 0, !0);
                        return;
                      }
                      this.mem.setFloat64(addr, v, !0);
                      return;
                    }
                    if (v === void 0) {
                      this.mem.setFloat64(addr, 0, !0);
                      return;
                    }
                    let id = this._ids.get(v);
                    id === void 0 && (id = this._idPool.pop(), id === void 0 && (id = this._values.length), this._values[id] = v, this._goRefCounts[id] = 0, this._ids.set(v, id)), this._goRefCounts[id]++;
                    let typeFlag = 0;
                    switch (typeof v) {
                      case "object":
                        v !== null && (typeFlag = 1);
                        break;
                      case "string":
                        typeFlag = 2;
                        break;
                      case "symbol":
                        typeFlag = 3;
                        break;
                      case "function":
                        typeFlag = 4;
                        break;
                    }
                    this.mem.setUint32(addr + 4, 2146959360 | typeFlag, !0), this.mem.setUint32(addr, id, !0);
                  }, loadSlice = (addr) => {
                    let array = getInt64(addr + 0), len = getInt64(addr + 8);
                    return new Uint8Array(this._inst.exports.mem.buffer, array, len);
                  }, loadSliceOfValues = (addr) => {
                    let array = getInt64(addr + 0), len = getInt64(addr + 8), a = new Array(len);
                    for (let i = 0; i < len; i++)
                      a[i] = loadValue(array + i * 8);
                    return a;
                  }, loadString = (addr) => {
                    let saddr = getInt64(addr + 0), len = getInt64(addr + 8);
                    return decoder.decode(new DataView(this._inst.exports.mem.buffer, saddr, len));
                  }, testCallExport = (a, b) => (this._inst.exports.testExport0(), this._inst.exports.testExport(a, b)), timeOrigin = Date.now() - performance.now();
                  this.importObject = {
                    _gotest: {
                      add: (a, b) => a + b,
                      callExport: testCallExport
                    },
                    gojs: {
                      // Go's SP does not change as long as no Go code is running. Some operations (e.g. calls, getters and setters)
                      // may synchronously trigger a Go event handler. This makes Go code get executed in the middle of the imported
                      // function. A goroutine can switch to a new stack if the current stack is too small (see morestack function).
                      // This changes the SP, thus we have to update the SP used by the imported function.
                      // func wasmExit(code int32)
                      "runtime.wasmExit": (sp) => {
                        sp >>>= 0;
                        let code = this.mem.getInt32(sp + 8, !0);
                        this.exited = !0, delete this._inst, delete this._values, delete this._goRefCounts, delete this._ids, delete this._idPool, this.exit(code);
                      },
                      // func wasmWrite(fd uintptr, p unsafe.Pointer, n int32)
                      "runtime.wasmWrite": (sp) => {
                        sp >>>= 0;
                        let fd = getInt64(sp + 8), p = getInt64(sp + 16), n = this.mem.getInt32(sp + 24, !0);
                        globalThis2.fs.writeSync(fd, new Uint8Array(this._inst.exports.mem.buffer, p, n));
                      },
                      // func resetMemoryDataView()
                      "runtime.resetMemoryDataView": (sp) => {
                        sp >>>= 0, this.mem = new DataView(this._inst.exports.mem.buffer);
                      },
                      // func nanotime1() int64
                      "runtime.nanotime1": (sp) => {
                        sp >>>= 0, setInt64(sp + 8, (timeOrigin + performance.now()) * 1e6);
                      },
                      // func walltime() (sec int64, nsec int32)
                      "runtime.walltime": (sp) => {
                        sp >>>= 0;
                        let msec = (/* @__PURE__ */ new Date()).getTime();
                        setInt64(sp + 8, msec / 1e3), this.mem.setInt32(sp + 16, msec % 1e3 * 1e6, !0);
                      },
                      // func scheduleTimeoutEvent(delay int64) int32
                      "runtime.scheduleTimeoutEvent": (sp) => {
                        sp >>>= 0;
                        let id = this._nextCallbackTimeoutID;
                        this._nextCallbackTimeoutID++, this._scheduledTimeouts.set(id, setTimeout(
                          () => {
                            for (this._resume(); this._scheduledTimeouts.has(id); )
                              console.warn("scheduleTimeoutEvent: missed timeout event"), this._resume();
                          },
                          getInt64(sp + 8)
                        )), this.mem.setInt32(sp + 16, id, !0);
                      },
                      // func clearTimeoutEvent(id int32)
                      "runtime.clearTimeoutEvent": (sp) => {
                        sp >>>= 0;
                        let id = this.mem.getInt32(sp + 8, !0);
                        clearTimeout(this._scheduledTimeouts.get(id)), this._scheduledTimeouts.delete(id);
                      },
                      // func getRandomData(r []byte)
                      "runtime.getRandomData": (sp) => {
                        sp >>>= 0, crypto.getRandomValues(loadSlice(sp + 8));
                      },
                      // func finalizeRef(v ref)
                      "syscall/js.finalizeRef": (sp) => {
                        sp >>>= 0;
                        let id = this.mem.getUint32(sp + 8, !0);
                        if (this._goRefCounts[id]--, this._goRefCounts[id] === 0) {
                          let v = this._values[id];
                          this._values[id] = null, this._ids.delete(v), this._idPool.push(id);
                        }
                      },
                      // func stringVal(value string) ref
                      "syscall/js.stringVal": (sp) => {
                        sp >>>= 0, storeValue(sp + 24, loadString(sp + 8));
                      },
                      // func valueGet(v ref, p string) ref
                      "syscall/js.valueGet": (sp) => {
                        sp >>>= 0;
                        let result = Reflect.get(loadValue(sp + 8), loadString(sp + 16));
                        sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 32, result);
                      },
                      // func valueSet(v ref, p string, x ref)
                      "syscall/js.valueSet": (sp) => {
                        sp >>>= 0, Reflect.set(loadValue(sp + 8), loadString(sp + 16), loadValue(sp + 32));
                      },
                      // func valueDelete(v ref, p string)
                      "syscall/js.valueDelete": (sp) => {
                        sp >>>= 0, Reflect.deleteProperty(loadValue(sp + 8), loadString(sp + 16));
                      },
                      // func valueIndex(v ref, i int) ref
                      "syscall/js.valueIndex": (sp) => {
                        sp >>>= 0, storeValue(sp + 24, Reflect.get(loadValue(sp + 8), getInt64(sp + 16)));
                      },
                      // valueSetIndex(v ref, i int, x ref)
                      "syscall/js.valueSetIndex": (sp) => {
                        sp >>>= 0, Reflect.set(loadValue(sp + 8), getInt64(sp + 16), loadValue(sp + 24));
                      },
                      // func valueCall(v ref, m string, args []ref) (ref, bool)
                      "syscall/js.valueCall": (sp) => {
                        sp >>>= 0;
                        try {
                          let v = loadValue(sp + 8), m = Reflect.get(v, loadString(sp + 16)), args = loadSliceOfValues(sp + 32), result = Reflect.apply(m, v, args);
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 56, result), this.mem.setUint8(sp + 64, 1);
                        } catch (err2) {
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 56, err2), this.mem.setUint8(sp + 64, 0);
                        }
                      },
                      // func valueInvoke(v ref, args []ref) (ref, bool)
                      "syscall/js.valueInvoke": (sp) => {
                        sp >>>= 0;
                        try {
                          let v = loadValue(sp + 8), args = loadSliceOfValues(sp + 16), result = Reflect.apply(v, void 0, args);
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 40, result), this.mem.setUint8(sp + 48, 1);
                        } catch (err2) {
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 40, err2), this.mem.setUint8(sp + 48, 0);
                        }
                      },
                      // func valueNew(v ref, args []ref) (ref, bool)
                      "syscall/js.valueNew": (sp) => {
                        sp >>>= 0;
                        try {
                          let v = loadValue(sp + 8), args = loadSliceOfValues(sp + 16), result = Reflect.construct(v, args);
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 40, result), this.mem.setUint8(sp + 48, 1);
                        } catch (err2) {
                          sp = this._inst.exports.getsp() >>> 0, storeValue(sp + 40, err2), this.mem.setUint8(sp + 48, 0);
                        }
                      },
                      // func valueLength(v ref) int
                      "syscall/js.valueLength": (sp) => {
                        sp >>>= 0, setInt64(sp + 16, parseInt(loadValue(sp + 8).length));
                      },
                      // valuePrepareString(v ref) (ref, int)
                      "syscall/js.valuePrepareString": (sp) => {
                        sp >>>= 0;
                        let str2 = encoder.encode(String(loadValue(sp + 8)));
                        storeValue(sp + 16, str2), setInt64(sp + 24, str2.length);
                      },
                      // valueLoadString(v ref, b []byte)
                      "syscall/js.valueLoadString": (sp) => {
                        sp >>>= 0;
                        let str2 = loadValue(sp + 8);
                        loadSlice(sp + 16).set(str2);
                      },
                      // func valueInstanceOf(v ref, t ref) bool
                      "syscall/js.valueInstanceOf": (sp) => {
                        sp >>>= 0, this.mem.setUint8(sp + 24, loadValue(sp + 8) instanceof loadValue(sp + 16) ? 1 : 0);
                      },
                      // func copyBytesToGo(dst []byte, src ref) (int, bool)
                      "syscall/js.copyBytesToGo": (sp) => {
                        sp >>>= 0;
                        let dst = loadSlice(sp + 8), src = loadValue(sp + 32);
                        if (!(src instanceof Uint8Array || src instanceof Uint8ClampedArray)) {
                          this.mem.setUint8(sp + 48, 0);
                          return;
                        }
                        let toCopy = src.subarray(0, dst.length);
                        dst.set(toCopy), setInt64(sp + 40, toCopy.length), this.mem.setUint8(sp + 48, 1);
                      },
                      // func copyBytesToJS(dst ref, src []byte) (int, bool)
                      "syscall/js.copyBytesToJS": (sp) => {
                        sp >>>= 0;
                        let dst = loadValue(sp + 8), src = loadSlice(sp + 16);
                        if (!(dst instanceof Uint8Array || dst instanceof Uint8ClampedArray)) {
                          this.mem.setUint8(sp + 48, 0);
                          return;
                        }
                        let toCopy = src.subarray(0, dst.length);
                        dst.set(toCopy), setInt64(sp + 40, toCopy.length), this.mem.setUint8(sp + 48, 1);
                      },
                      debug: (value) => {
                        console.log(value);
                      }
                    }
                  };
                }
                run(instance) {
                  return __async2(this, null, function* () {
                    if (!(instance instanceof WebAssembly.Instance))
                      throw new Error("Go.run: WebAssembly.Instance expected");
                    this._inst = instance, this.mem = new DataView(this._inst.exports.mem.buffer), this._values = [
                      // JS values that Go currently has references to, indexed by reference id
                      NaN,
                      0,
                      null,
                      !0,
                      !1,
                      globalThis2,
                      this
                    ], this._goRefCounts = new Array(this._values.length).fill(1 / 0), this._ids = /* @__PURE__ */ new Map([
                      // mapping from JS values to reference ids
                      [0, 1],
                      [null, 2],
                      [!0, 3],
                      [!1, 4],
                      [globalThis2, 5],
                      [this, 6]
                    ]), this._idPool = [], this.exited = !1;
                    let offset = 4096, strPtr = (str2) => {
                      let ptr = offset, bytes = encoder.encode(str2 + "\0");
                      return new Uint8Array(this.mem.buffer, offset, bytes.length).set(bytes), offset += bytes.length, offset % 8 !== 0 && (offset += 8 - offset % 8), ptr;
                    }, argc = this.argv.length, argvPtrs = [];
                    this.argv.forEach((arg) => {
                      argvPtrs.push(strPtr(arg));
                    }), argvPtrs.push(0), Object.keys(this.env).sort().forEach((key) => {
                      argvPtrs.push(strPtr(`${key}=${this.env[key]}`));
                    }), argvPtrs.push(0);
                    let argv = offset;
                    if (argvPtrs.forEach((ptr) => {
                      this.mem.setUint32(offset, ptr, !0), this.mem.setUint32(offset + 4, 0, !0), offset += 8;
                    }), offset >= 12288)
                      throw new Error("total length of command line and environment variables exceeds limit");
                    this._inst.exports.run(argc, argv), this.exited && this._resolveExitPromise(), yield this._exitPromise;
                  });
                }
                _resume() {
                  if (this.exited)
                    throw new Error("Go program has already exited");
                  this._inst.exports.resume(), this.exited && this._resolveExitPromise();
                }
                _makeFuncWrapper(id) {
                  let go2 = this;
                  return function() {
                    let event = { id, this: this, args: arguments };
                    return go2._pendingEvent = event, go2._resume(), event.result;
                  };
                }
              };
            })(), onmessage2 = ({ data: wasm }) => {
              let decoder = new TextDecoder(), fs = globalThis2.fs, stderr = "";
              fs.writeSync = (fd, buffer) => {
                if (fd === 1)
                  postMessage(buffer);
                else if (fd === 2) {
                  stderr += decoder.decode(buffer);
                  let parts = stderr.split(`
`);
                  parts.length > 1 && console.log(parts.slice(0, -1).join(`
`)), stderr = parts[parts.length - 1];
                } else
                  throw new Error("Bad write");
                return buffer.length;
              };
              let stdin = [], resumeStdin, stdinPos = 0;
              onmessage2 = ({ data }) => (data.length > 0 && (stdin.push(data), resumeStdin && resumeStdin()), go2), fs.read = (fd, buffer, offset, length, position, callback) => {
                if (fd !== 0 || offset !== 0 || length !== buffer.length || position !== null)
                  throw new Error("Bad read");
                if (stdin.length === 0) {
                  resumeStdin = () => fs.read(fd, buffer, offset, length, position, callback);
                  return;
                }
                let first = stdin[0], count = Math.max(0, Math.min(length, first.length - stdinPos));
                buffer.set(first.subarray(stdinPos, stdinPos + count), offset), stdinPos += count, stdinPos === first.length && (stdin.shift(), stdinPos = 0), callback(null, count);
              };
              let go2 = new globalThis2.Go();
              return go2.argv = ["", "--service=0.28.2"], tryToInstantiateModule(wasm, go2).then(
                (instance) => {
                  postMessage(null), go2.run(instance);
                },
                (error) => {
                  postMessage(error);
                }
              ), go2;
            };
            function tryToInstantiateModule(wasm, go2) {
              return __async2(this, null, function* () {
                if (wasm instanceof WebAssembly.Module)
                  return WebAssembly.instantiate(wasm, go2.importObject);
                let res = yield fetch(wasm);
                if (!res.ok) throw new Error(`Failed to download ${JSON.stringify(wasm)}`);
                if ("instantiateStreaming" in WebAssembly && /^application\/wasm($|;)/i.test(res.headers.get("Content-Type") || ""))
                  return (yield WebAssembly.instantiateStreaming(res, go2.importObject)).instance;
                let bytes = yield res.arrayBuffer();
                return (yield WebAssembly.instantiate(bytes, go2.importObject)).instance;
              });
            }
            return (m) => onmessage2(m);
          })((data) => worker.onmessage({ data })), go;
          worker = {
            onmessage: null,
            postMessage: (data) => setTimeout(() => {
              try {
                go = onmessage({ data });
              } catch (error) {
                rejectAllWith(error);
              }
            }),
            terminate() {
              if (go)
                for (let timeout of go._scheduledTimeouts.values())
                  clearTimeout(timeout);
            }
          };
        }
        let firstMessageResolve, firstMessageReject, firstMessagePromise = new Promise((resolve2, reject) => {
          firstMessageResolve = resolve2, firstMessageReject = reject;
        });
        worker.onmessage = ({ data: error }) => {
          worker.onmessage = ({ data }) => readFromStdout(data), error ? firstMessageReject(error) : firstMessageResolve();
        }, worker.postMessage(wasmModule || new URL(wasmURL, location.href).toString());
        let { readFromStdout, service } = createChannel({
          writeToStdin(bytes) {
            worker.postMessage(bytes);
          },
          isSync: !1,
          hasFS: !1,
          esbuild: browser_exports
        });
        yield firstMessagePromise, stopService = () => {
          worker.terminate(), initializePromise = void 0, stopService = void 0, longLivedService = void 0;
        }, longLivedService = {
          build: (options) => new Promise((resolve2, reject) => {
            rejectAllPromise.then(reject), service.buildOrContext({
              callName: "build",
              refs: null,
              options,
              isTTY: !1,
              defaultWD: "/",
              callback: (err2, res) => err2 ? reject(err2) : resolve2(res)
            });
          }),
          context: (options) => new Promise((resolve2, reject) => {
            rejectAllPromise.then(reject), service.buildOrContext({
              callName: "context",
              refs: null,
              options,
              isTTY: !1,
              defaultWD: "/",
              callback: (err2, res) => err2 ? reject(err2) : resolve2(res)
            });
          }),
          transform: (input, options) => new Promise((resolve2, reject) => {
            rejectAllPromise.then(reject), service.transform({
              callName: "transform",
              refs: null,
              input,
              options: options || {},
              isTTY: !1,
              fs: {
                readFile(_, callback) {
                  callback(new Error("Internal error"), null);
                },
                writeFile(_, callback) {
                  callback(null);
                }
              },
              callback: (err2, res) => err2 ? reject(err2) : resolve2(res)
            });
          }),
          formatMessages: (messages, options) => new Promise((resolve2, reject) => {
            rejectAllPromise.then(reject), service.formatMessages({
              callName: "formatMessages",
              refs: null,
              messages,
              options,
              callback: (err2, res) => err2 ? reject(err2) : resolve2(res)
            });
          }),
          analyzeMetafile: (metafile, options) => new Promise((resolve2, reject) => {
            rejectAllPromise.then(reject), service.analyzeMetafile({
              callName: "analyzeMetafile",
              refs: null,
              metafile: typeof metafile == "string" ? metafile : JSON.stringify(metafile),
              options,
              callback: (err2, res) => err2 ? reject(err2) : resolve2(res)
            });
          })
        };
      }), browser_default = browser_exports;
    })(typeof module == "object" ? module : { set exports(x) {
      (typeof self < "u" ? self : this).esbuild = x;
    } });
  }
});

// src/esbuild.ts
var esbuild_exports = {};
__export(esbuild_exports, {
  DEFAULT_WASM_URL: () => DEFAULT_WASM_URL,
  ESBUILD_VERSION: () => ESBUILD_VERSION,
  LOADERS: () => LOADERS,
  bundleVfs: () => bundleVfs,
  formatErrors: () => formatErrors,
  isNodeBuiltin: () => isNodeBuiltin,
  loadEsbuild: () => loadEsbuild,
  loaderFor: () => loaderFor,
  splitQuery: () => splitQuery,
  vfsPlugin: () => vfsPlugin
});
function loadEsbuild(wasmURL = DEFAULT_WASM_URL) {
  return init || (init = esbuild.initialize({ wasmURL, worker: typeof Worker < "u" }).then(() => esbuild).catch((e) => {
    if (String(e).includes("more than once")) return esbuild;
    throw init = null, e;
  })), init;
}
function loaderFor(path2) {
  return LOADERS[extname(path2).toLowerCase()] ?? "js";
}
function vfsPlugin(vfs, opts = {}) {
  let ropts = opts.resolve ?? BROWSER_OPTS, fsAdapter = { isFile: (p) => vfs.isFile(p), isDir: (p) => vfs.isDir(p), readText: (p) => vfs.tryReadText(p) };
  return {
    name: "clover-vfs",
    setup(build2) {
      build2.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === "clover-empty") return;
        let spec = args.path;
        if (/^(https?:|data:)/.test(spec) || spec.startsWith("//")) return { path: spec, external: !0 };
        let importer = args.importer || "", ext = opts.external?.(spec, importer, args.kind);
        if (typeof ext == "string") return { path: ext, external: !0 };
        if (isBare(spec) && isNodeBuiltin(spec))
          return opts.builtins === "external" ? { path: spec, external: !0 } : { path: spec, namespace: "clover-empty" };
        let fromDir = args.resolveDir || (importer ? dirname(importer) : "/"), [clean, query] = splitQuery(spec);
        try {
          let r = resolveModule(fsAdapter, clean, fromDir, ropts);
          return r === !1 ? { path: spec, namespace: "clover-empty" } : { path: r, namespace: "clover-vfs", suffix: query };
        } catch (e) {
          if (e instanceof ResolveError) return { errors: [{ text: e.message }] };
          throw e;
        }
      }), build2.onLoad({ filter: /.*/, namespace: "clover-empty" }, () => ({ contents: "module.exports = {}", loader: "js" })), build2.onLoad({ filter: /.*/, namespace: "clover-vfs" }, (args) => {
        let loader = build2.initialOptions.loader?.[extname(args.path)] ?? loaderFor(args.path), data = vfs.readFile(args.path);
        return {
          contents: loader === "file" || loader === "binary" || loader === "dataurl" || loader === "base64" ? data : toText(data),
          loader,
          resolveDir: dirname(args.path)
        };
      });
    }
  };
}
function splitQuery(p) {
  let i = p.search(/[?#]/);
  return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i)];
}
async function bundleVfs(vfs, options) {
  let { cwd = "/", wasmURL, vfsPlugin: vopts, ...rest } = options, es = await loadEsbuild(wasmURL), fix = (p) => p.startsWith("/") || /^[\w-]{2,}:/.test(p) ? p : normalize(`${cwd}/${p}`), entryPoints = rest.entryPoints;
  return Array.isArray(entryPoints) ? entryPoints = entryPoints.map((e) => typeof e == "string" ? fix(e) : { ...e, in: fix(e.in) }) : entryPoints && typeof entryPoints == "object" && (entryPoints = Object.fromEntries(Object.entries(entryPoints).map(([k, v]) => [k, fix(v)]))), await es.build({
    bundle: !0,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    ...rest,
    entryPoints,
    absWorkingDir: cwd,
    outdir: rest.outdir ? fix(rest.outdir) : rest.outfile ? void 0 : "/__out__",
    outfile: rest.outfile ? fix(rest.outfile) : void 0,
    write: !1,
    plugins: [...rest.plugins ?? [], vfsPlugin(vfs, vopts)]
  });
}
function formatErrors(e) {
  let errs = e.errors;
  return Array.isArray(errs) && errs.length ? errs.map((m) => {
    let loc = m.location ? `${m.location.file}:${m.location.line}:${m.location.column}: ` : "", snippet = m.location?.lineText ? `
    ${m.location.lineText}
    ${" ".repeat(m.location.column)}^` : "";
    return `${loc}${m.text}${snippet}`;
  }).join(`
`) : e instanceof Error ? e.message : String(e);
}
var esbuild, ESBUILD_VERSION, DEFAULT_WASM_URL, init, LOADERS, NODE_BUILTINS, isNodeBuiltin, init_esbuild = __esm({
  "src/esbuild.ts"() {
    "use strict";
    esbuild = __toESM(require_browser(), 1);
    init_vfs();
    init_path();
    init_resolve();
    ESBUILD_VERSION = esbuild.version, DEFAULT_WASM_URL = `https://cdn.jsdelivr.net/npm/esbuild-wasm@${esbuild.version}/esbuild.wasm`, init = null;
    LOADERS = {
      ".ts": "ts",
      ".mts": "ts",
      ".cts": "ts",
      ".tsx": "tsx",
      ".jsx": "jsx",
      ".js": "js",
      ".mjs": "js",
      ".cjs": "js",
      ".json": "json",
      ".css": "css",
      ".txt": "text",
      ".svg": "file",
      ".png": "file",
      ".jpg": "file",
      ".jpeg": "file",
      ".gif": "file",
      ".webp": "file",
      ".avif": "file",
      ".ico": "file",
      ".woff": "file",
      ".woff2": "file",
      ".ttf": "file",
      ".otf": "file",
      ".eot": "file",
      ".mp4": "file",
      ".webm": "file",
      ".mp3": "file",
      ".wav": "file",
      ".wasm": "file"
    };
    NODE_BUILTINS = new Set(
      "assert buffer child_process cluster console constants crypto dgram dns domain events fs fs/promises http http2 https module net os path path/posix process punycode querystring readline repl stream stream/promises string_decoder sys timers timers/promises tls tty url util util/types v8 vm worker_threads zlib async_hooks perf_hooks inspector diagnostics_channel".split(
        " "
      )
    ), isNodeBuiltin = (s) => s.startsWith("node:") || NODE_BUILTINS.has(s);
  }
});

// node_modules/cjs-module-lexer/lexer.js
var require_lexer = __commonJS({
  "node_modules/cjs-module-lexer/lexer.js"(exports, module) {
    var source, pos, end, openTokenDepth, templateDepth, lastTokenPos, lastSlashWasDivision, templateStack, templateStackDepth, openTokenPosStack, openClassPosStack, nextBraceIsClass, starExportMap, lastStarExportSpecifier, _exports, unsafeGetters, reexports;
    function resetState() {
      openTokenDepth = 0, templateDepth = -1, lastTokenPos = -1, lastSlashWasDivision = !1, templateStack = new Array(1024), templateStackDepth = 0, openTokenPosStack = new Array(1024), openClassPosStack = new Array(1024), nextBraceIsClass = !1, starExportMap = /* @__PURE__ */ Object.create(null), lastStarExportSpecifier = null, _exports = /* @__PURE__ */ new Set(), unsafeGetters = /* @__PURE__ */ new Set(), reexports = /* @__PURE__ */ new Set();
    }
    var Import = 0, ExportAssign = 1, ExportStar = 2;
    function pushOpenToken(tokenPos) {
      if (openTokenDepth === 2048)
        throw new Error("Maximum nesting depth exceeded.");
      openTokenPosStack[openTokenDepth++] = tokenPos;
    }
    function pushTemplate() {
      if (templateStackDepth === 2048 || openTokenDepth === 2048)
        throw new Error("Maximum nesting depth exceeded.");
      templateStack[templateStackDepth++] = templateDepth, templateDepth = ++openTokenDepth;
    }
    function parseCJS(source2, name = "@") {
      resetState();
      try {
        parseSource(source2);
      } catch (e) {
        throw e.message += `
  at ${name}:${source2.slice(0, pos).split(`
`).length}:${pos - source2.lastIndexOf(`
`, pos - 1)}`, e.loc = pos, e;
      }
      let result = { exports: [..._exports].filter((expt) => expt !== void 0 && !unsafeGetters.has(expt)), reexports: [...reexports].filter((reexpt) => reexpt !== void 0) };
      return resetState(), result;
    }
    function decode(str2) {
      if (str2[0] === '"' || str2[0] === "'")
        try {
          let decoded = scanStringLiteral(str2);
          for (let i = 0; i < decoded.length; i++) {
            let surrogatePrefix = decoded.charCodeAt(i) & 64512;
            if (!(surrogatePrefix < 55296))
              if (surrogatePrefix === 55296) {
                if ((decoded.charCodeAt(++i) & 64512) !== 56320)
                  return;
              } else
                return;
          }
          return decoded;
        } catch {
        }
      else
        return str2;
    }
    function parseSource(cjsSource) {
      source = cjsSource, pos = -1, end = source.length - 1;
      let ch = 0;
      if (source.charCodeAt(0) === 35 && source.charCodeAt(1) === 33) {
        if (source.length === 2)
          return !0;
        for (pos += 2; pos++ < end && (ch = source.charCodeAt(pos), !(ch === 10 || ch === 13)); )
          ;
      }
      for (; pos++ < end; )
        if (ch = source.charCodeAt(pos), !(ch === 32 || ch < 14 && ch > 8)) {
          if (openTokenDepth === 0)
            switch (ch) {
              case 105:
                source.startsWith("mport", pos + 1) && keywordStart(pos) && throwIfImportStatement(), skipTokenRun(), lastTokenPos = pos;
                continue;
              case 114:
                let startPos = pos;
                tryParseRequire(Import) && keywordStart(startPos) && tryBacktrackAddStarExportBinding(startPos - 1), skipTokenRun(), lastTokenPos = pos;
                continue;
              case 95:
                if (source.startsWith("interopRequireWildcard", pos + 1) && (keywordStart(pos) || source.charCodeAt(pos - 1) === 46)) {
                  let startPos2 = pos;
                  pos += 23, source.charCodeAt(pos) === 40 && (pos++, pushOpenToken(lastTokenPos), tryParseRequire(Import) && keywordStart(startPos2) && tryBacktrackAddStarExportBinding(startPos2 - 1));
                } else source.startsWith("_export", pos + 1) && (keywordStart(pos) || source.charCodeAt(pos - 1) === 46) && (pos += 8, source.startsWith("Star", pos) && (pos += 4), source.charCodeAt(pos) === 40 && (pushOpenToken(lastTokenPos), source.charCodeAt(pos + 1) === 114 && (pos++, tryParseRequire(ExportStar))));
                skipTokenRun(), lastTokenPos = pos;
                continue;
            }
          switch (ch) {
            case 101:
              source.startsWith("xport", pos + 1) && keywordStart(pos) && (source.charCodeAt(pos + 6) === 115 ? tryParseExportsDotAssign(!1) : openTokenDepth === 0 && throwIfExportStatement()), skipTokenRun();
              break;
            case 99:
              source.charCodeAt(pos + 1) === 108 && keywordStart(pos) && source.startsWith("ass", pos + 2) && isBrOrWs(source.charCodeAt(pos + 5)) && (nextBraceIsClass = !0), skipTokenRun();
              break;
            case 109:
              source.startsWith("odule", pos + 1) && keywordStart(pos) && tryParseModuleExportsDotAssign(), skipTokenRun();
              break;
            case 79:
              source.startsWith("bject", pos + 1) && keywordStart(pos) && tryParseObjectDefineOrKeys(openTokenDepth === 0), skipTokenRun();
              break;
            case 40:
              pushOpenToken(lastTokenPos);
              break;
            case 41:
              if (openTokenDepth === 0)
                throw new Error("Unexpected closing bracket.");
              openTokenDepth--;
              break;
            case 123:
              pushOpenToken(lastTokenPos), openClassPosStack[openTokenDepth - 1] = nextBraceIsClass, nextBraceIsClass = !1;
              break;
            case 125:
              if (openTokenDepth === 0)
                throw new Error("Unexpected closing brace.");
              if (openTokenDepth-- === templateDepth)
                templateDepth = templateStack[--templateStackDepth], templateString();
              else if (templateDepth !== -1 && openTokenDepth < templateDepth)
                throw new Error("Unexpected closing brace.");
              break;
            case 60:
              break;
            case 39:
            case 34:
              stringLiteral(ch);
              break;
            case 47: {
              let next_ch = source.charCodeAt(pos + 1);
              if (next_ch === 47) {
                lineComment();
                continue;
              } else if (next_ch === 42) {
                blockComment();
                continue;
              } else {
                let lastToken = source.charCodeAt(lastTokenPos);
                isExpressionPunctuator(lastToken) && !(lastToken === 46 && source.charCodeAt(lastTokenPos - 1) >= 48 && source.charCodeAt(lastTokenPos - 1) <= 57) && !(lastToken === 43 && source.charCodeAt(lastTokenPos - 1) === 43) && !(lastToken === 45 && source.charCodeAt(lastTokenPos - 1) === 45) || lastToken === 41 && isParenKeyword(openTokenPosStack[openTokenDepth]) || lastToken === 125 && (isExpressionTerminator(openTokenPosStack[openTokenDepth]) || openClassPosStack[openTokenDepth]) || lastToken === 47 && lastSlashWasDivision || isExpressionKeyword(lastTokenPos) || !lastToken ? (regularExpression(), lastSlashWasDivision = !1) : lastSlashWasDivision = !0;
              }
              break;
            }
            case 96:
              templateString();
              break;
            default:
              isTokenRunChar(ch) && skipTokenRun();
          }
          lastTokenPos = pos;
        }
      if (templateDepth !== -1)
        throw new Error("Unterminated template.");
      if (openTokenDepth)
        throw new Error("Unterminated braces.");
    }
    function tryBacktrackAddStarExportBinding(bPos) {
      for (; source.charCodeAt(bPos) === 32 && bPos >= 0; )
        bPos--;
      if (source.charCodeAt(bPos) === 61) {
        for (bPos--; source.charCodeAt(bPos) === 32 && bPos >= 0; )
          bPos--;
        let codePoint, id_end = bPos, identifierStart = !1;
        for (; (codePoint = codePointAtLast(bPos)) && bPos >= 0; ) {
          if (codePoint === 92)
            return;
          if (!isIdentifierChar(codePoint, !0))
            break;
          identifierStart = isIdentifierStart(codePoint, !0), bPos -= codePointLen(codePoint);
        }
        if (identifierStart && source.charCodeAt(bPos) === 32) {
          let starExportId = source.slice(bPos + 1, id_end + 1);
          for (; source.charCodeAt(bPos) === 32 && bPos >= 0; )
            bPos--;
          switch (source.charCodeAt(bPos)) {
            case 114:
              if (!source.startsWith("va", bPos - 2))
                return;
              break;
            case 116:
              if (!source.startsWith("le", bPos - 2) && !source.startsWith("cons", bPos - 4))
                return;
              break;
            default:
              return;
          }
          starExportMap[starExportId] = lastStarExportSpecifier;
        }
      }
    }
    function tryParseObjectHasOwnProperty(it_id) {
      let ch = commentWhitespace();
      if (ch !== 79 || !source.startsWith("bject", pos + 1) || (pos += 6, ch = commentWhitespace(), ch !== 46)) return !1;
      if (pos++, ch = commentWhitespace(), ch === 112) {
        if (!source.startsWith("rototype", pos + 1) || (pos += 9, ch = commentWhitespace(), ch !== 46)) return !1;
        pos++, ch = commentWhitespace();
      }
      return ch !== 104 || !source.startsWith("asOwnProperty", pos + 1) || (pos += 14, ch = commentWhitespace(), ch !== 46) || (pos++, ch = commentWhitespace(), ch !== 99 || !source.startsWith("all", pos + 1)) || (pos += 4, ch = commentWhitespace(), ch !== 40) || (pos++, ch = commentWhitespace(), !identifier()) || (ch = commentWhitespace(), ch !== 44) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 41) ? !1 : (pos++, !0);
    }
    function tryParseObjectDefineOrKeys(keys) {
      pos += 6;
      let revertPos = pos - 1, ch = commentWhitespace();
      if (ch === 46) {
        if (pos++, ch = commentWhitespace(), ch === 100 && source.startsWith("efineProperty", pos + 1)) {
          let expt;
          for (; pos += 14, revertPos = pos - 1, ch = commentWhitespace(), !(ch !== 40 || (pos++, ch = commentWhitespace(), !readExportsOrModuleDotExports(ch)) || (ch = commentWhitespace(), ch !== 44) || (pos++, ch = commentWhitespace(), ch !== 39 && ch !== 34)); ) {
            let exportPos = pos;
            if (stringLiteral(ch), expt = source.slice(exportPos, ++pos), ch = commentWhitespace(), ch !== 44 || (pos++, ch = commentWhitespace(), ch !== 123)) break;
            if (pos++, ch = commentWhitespace(), ch === 101) {
              if (!source.startsWith("numerable", pos + 1) || (pos += 10, ch = commentWhitespace(), ch !== 58) || (pos++, ch = commentWhitespace(), ch !== 116 || !source.startsWith("rue", pos + 1)) || (pos += 4, ch = commentWhitespace(), ch !== 44)) break;
              pos++, ch = commentWhitespace();
            }
            if (ch === 118) {
              if (!source.startsWith("alue", pos + 1) || (pos += 5, ch = commentWhitespace(), ch !== 58)) break;
              _exports.add(decode(expt)), pos = revertPos;
              return;
            } else if (ch === 103) {
              if (!source.startsWith("et", pos + 1)) break;
              if (pos += 3, ch = commentWhitespace(), ch === 58) {
                if (pos++, ch = commentWhitespace(), ch !== 102 || !source.startsWith("unction", pos + 1)) break;
                pos += 8;
                let lastPos = pos;
                if (ch = commentWhitespace(), ch !== 40 && (lastPos === pos || !identifier())) break;
                ch = commentWhitespace();
              }
              if (ch !== 40 || (pos++, ch = commentWhitespace(), ch !== 41) || (pos++, ch = commentWhitespace(), ch !== 123) || (pos++, ch = commentWhitespace(), ch !== 114) || !source.startsWith("eturn", pos + 1) || (pos += 6, ch = commentWhitespace(), !identifier())) break;
              if (ch = commentWhitespace(), ch === 46) {
                if (pos++, commentWhitespace(), !identifier()) break;
                ch = commentWhitespace();
              } else if (ch === 91) {
                if (pos++, ch = commentWhitespace(), ch === 39 || ch === 34) stringLiteral(ch);
                else break;
                if (pos++, ch = commentWhitespace(), ch !== 93) break;
                pos++, ch = commentWhitespace();
              }
              if (ch === 59 && (pos++, ch = commentWhitespace()), ch !== 125 || (pos++, ch = commentWhitespace(), ch === 44 && (pos++, ch = commentWhitespace()), ch !== 125) || (pos++, ch = commentWhitespace(), ch !== 41)) break;
              _exports.add(decode(expt));
              return;
            }
            break;
          }
          expt && unsafeGetters.add(decode(expt));
        } else if (keys && ch === 107 && source.startsWith("eys", pos + 1))
          for (; pos += 4, revertPos = pos - 1, ch = commentWhitespace(), ch === 40; ) {
            pos++, ch = commentWhitespace();
            let id_start = pos;
            if (!identifier()) break;
            let id = source.slice(id_start, pos);
            if (ch = commentWhitespace(), ch !== 41 || (revertPos = pos++, ch = commentWhitespace(), ch !== 46) || (pos++, ch = commentWhitespace(), ch !== 102 || !source.startsWith("orEach", pos + 1)) || (pos += 7, ch = commentWhitespace(), revertPos = pos - 1, ch !== 40) || (pos++, ch = commentWhitespace(), ch !== 102 || !source.startsWith("unction", pos + 1)) || (pos += 8, ch = commentWhitespace(), ch !== 40)) break;
            pos++, ch = commentWhitespace();
            let it_id_start = pos;
            if (!identifier()) break;
            let it_id = source.slice(it_id_start, pos);
            if (ch = commentWhitespace(), ch !== 41 || (pos++, ch = commentWhitespace(), ch !== 123) || (pos++, ch = commentWhitespace(), ch !== 105 || source.charCodeAt(pos + 1) !== 102) || (pos += 2, ch = commentWhitespace(), ch !== 40) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos))) break;
            if (pos += it_id.length, ch = commentWhitespace(), ch === 61) {
              if (!source.startsWith("==", pos + 1) || (pos += 3, ch = commentWhitespace(), ch !== 34 && ch !== 39)) break;
              let quot = ch;
              if (!source.startsWith("default", pos + 1) || (pos += 8, ch = commentWhitespace(), ch !== quot) || (pos += 1, ch = commentWhitespace(), ch !== 124 || source.charCodeAt(pos + 1) !== 124) || (pos += 2, ch = commentWhitespace(), source.slice(pos, pos + it_id.length) !== it_id) || (pos += it_id.length, ch = commentWhitespace(), ch !== 61 || source.slice(pos + 1, pos + 3) !== "==") || (pos += 3, ch = commentWhitespace(), ch !== 34 && ch !== 39) || (quot = ch, !source.startsWith("__esModule", pos + 1)) || (pos += 11, ch = commentWhitespace(), ch !== quot) || (pos += 1, ch = commentWhitespace(), ch !== 41) || (pos += 1, ch = commentWhitespace(), ch !== 114 || !source.startsWith("eturn", pos + 1))) break;
              if (pos += 6, ch = commentWhitespace(), ch === 59 && pos++, ch = commentWhitespace(), ch === 105 && source.charCodeAt(pos + 1) === 102) {
                let inIf = !0;
                if (pos += 2, ch = commentWhitespace(), ch !== 40) break;
                pos++;
                let ifInnerPos = pos;
                if (tryParseObjectHasOwnProperty(it_id)) {
                  if (ch = commentWhitespace(), ch !== 41 || (pos++, ch = commentWhitespace(), ch !== 114 || !source.startsWith("eturn", pos + 1))) break;
                  if (pos += 6, ch = commentWhitespace(), ch === 59 && pos++, ch = commentWhitespace(), ch === 105 && source.charCodeAt(pos + 1) === 102) {
                    if (pos += 2, ch = commentWhitespace(), ch !== 40) break;
                    pos++;
                  } else
                    inIf = !1;
                } else
                  pos = ifInnerPos;
                if (inIf) {
                  if (!source.startsWith(it_id, pos) || (pos += it_id.length, ch = commentWhitespace(), ch !== 105 || !source.startsWith("n ", pos + 1)) || (pos += 3, ch = commentWhitespace(), !readExportsOrModuleDotExports(ch)) || (ch = commentWhitespace(), ch !== 38 || source.charCodeAt(pos + 1) !== 38) || (pos += 2, ch = commentWhitespace(), !readExportsOrModuleDotExports(ch)) || (ch = commentWhitespace(), ch !== 91) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 93) || (pos++, ch = commentWhitespace(), ch !== 61 || !source.startsWith("==", pos + 1)) || (pos += 3, ch = commentWhitespace(), !source.startsWith(id, pos)) || (pos += id.length, ch = commentWhitespace(), ch !== 91) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 93) || (pos++, ch = commentWhitespace(), ch !== 41) || (pos++, ch = commentWhitespace(), ch !== 114 || !source.startsWith("eturn", pos + 1))) break;
                  pos += 6, ch = commentWhitespace(), ch === 59 && pos++, ch = commentWhitespace();
                }
              }
            } else if (ch === 33) {
              if (!source.startsWith("==", pos + 1) || (pos += 3, ch = commentWhitespace(), ch !== 34 && ch !== 39)) break;
              let quot = ch;
              if (!source.startsWith("default", pos + 1) || (pos += 8, ch = commentWhitespace(), ch !== quot)) break;
              if (pos += 1, ch = commentWhitespace(), ch === 38) {
                if (source.charCodeAt(pos + 1) !== 38 || (pos += 2, ch = commentWhitespace(), ch !== 33)) break;
                if (pos += 1, ch = commentWhitespace(), ch === 79 && source.startsWith("bject", pos + 1) && source[pos + 6] === ".") {
                  if (!tryParseObjectHasOwnProperty(it_id)) break;
                } else if (identifier()) {
                  if (ch = commentWhitespace(), ch !== 46 || (pos++, ch = commentWhitespace(), ch !== 104 || !source.startsWith("asOwnProperty", pos + 1)) || (pos += 14, ch = commentWhitespace(), ch !== 40) || (pos += 1, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 41)) break;
                  pos += 1;
                } else break;
                ch = commentWhitespace();
              }
              if (ch !== 41) break;
              pos += 1, ch = commentWhitespace();
            } else break;
            if (readExportsOrModuleDotExports(ch)) {
              if (ch = commentWhitespace(), ch !== 91 || (pos++, ch = commentWhitespace(), source.slice(pos, pos + it_id.length) !== it_id) || (pos += it_id.length, ch = commentWhitespace(), ch !== 93) || (pos++, ch = commentWhitespace(), ch !== 61) || (pos++, ch = commentWhitespace(), source.slice(pos, pos + id.length) !== id) || (pos += id.length, ch = commentWhitespace(), ch !== 91) || (pos++, ch = commentWhitespace(), source.slice(pos, pos + it_id.length) !== it_id) || (pos += it_id.length, ch = commentWhitespace(), ch !== 93)) break;
              pos++, ch = commentWhitespace(), ch === 59 && (pos++, ch = commentWhitespace());
            } else if (ch === 79) {
              if (source.slice(pos + 1, pos + 6) !== "bject" || (pos += 6, ch = commentWhitespace(), ch !== 46) || (pos++, ch = commentWhitespace(), ch !== 100 || !source.startsWith("efineProperty", pos + 1)) || (pos += 14, ch = commentWhitespace(), ch !== 40) || (pos++, ch = commentWhitespace(), !readExportsOrModuleDotExports(ch)) || (ch = commentWhitespace(), ch !== 44) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 44) || (pos++, ch = commentWhitespace(), ch !== 123) || (pos++, ch = commentWhitespace(), ch !== 101 || !source.startsWith("numerable", pos + 1)) || (pos += 10, ch = commentWhitespace(), ch !== 58) || (pos++, ch = commentWhitespace(), ch !== 116 && !source.startsWith("rue", pos + 1)) || (pos += 4, ch = commentWhitespace(), ch !== 44) || (pos++, ch = commentWhitespace(), ch !== 103 || !source.startsWith("et", pos + 1))) break;
              if (pos += 3, ch = commentWhitespace(), ch === 58) {
                if (pos++, ch = commentWhitespace(), ch !== 102 || !source.startsWith("unction", pos + 1)) break;
                pos += 8;
                let lastPos = pos;
                if (ch = commentWhitespace(), ch !== 40 && (lastPos === pos || !identifier())) break;
                ch = commentWhitespace();
              }
              if (ch !== 40 || (pos++, ch = commentWhitespace(), ch !== 41) || (pos++, ch = commentWhitespace(), ch !== 123) || (pos++, ch = commentWhitespace(), ch !== 114 || !source.startsWith("eturn", pos + 1)) || (pos += 6, ch = commentWhitespace(), !source.startsWith(id, pos)) || (pos += id.length, ch = commentWhitespace(), ch !== 91) || (pos++, ch = commentWhitespace(), !source.startsWith(it_id, pos)) || (pos += it_id.length, ch = commentWhitespace(), ch !== 93) || (pos++, ch = commentWhitespace(), ch === 59 && (pos++, ch = commentWhitespace()), ch !== 125) || (pos++, ch = commentWhitespace(), ch === 44 && (pos++, ch = commentWhitespace()), ch !== 125) || (pos++, ch = commentWhitespace(), ch !== 41)) break;
              pos++, ch = commentWhitespace(), ch === 59 && (pos++, ch = commentWhitespace());
            } else break;
            if (ch !== 125 || (pos++, ch = commentWhitespace(), ch !== 41)) break;
            let starExportSpecifier = starExportMap[id];
            if (starExportSpecifier) {
              reexports.add(decode(starExportSpecifier)), pos = revertPos;
              return;
            }
            return;
          }
      }
      pos = revertPos;
    }
    function readExportsOrModuleDotExports(ch) {
      let revertPos = pos;
      if (ch === 109 && source.startsWith("odule", pos + 1)) {
        if (pos += 6, ch = commentWhitespace(), ch !== 46)
          return pos = revertPos, !1;
        pos++, ch = commentWhitespace();
      }
      return ch === 101 && source.startsWith("xports", pos + 1) ? (pos += 7, !0) : (pos = revertPos, !1);
    }
    function tryParseModuleExportsDotAssign() {
      pos += 6;
      let revertPos = pos - 1, ch = commentWhitespace();
      if (ch === 46 && (pos++, ch = commentWhitespace(), ch === 101 && source.startsWith("xports", pos + 1))) {
        tryParseExportsDotAssign(!0);
        return;
      }
      pos = revertPos;
    }
    function tryParseExportsDotAssign(assign) {
      pos += 7;
      let revertPos = pos - 1, ch = commentWhitespace();
      switch (ch) {
        // exports.asdf
        case 46: {
          pos++, ch = commentWhitespace();
          let startPos = pos;
          if (identifier()) {
            let endPos = pos;
            if (ch = commentWhitespace(), ch === 61) {
              _exports.add(decode(source.slice(startPos, endPos)));
              return;
            }
          }
          break;
        }
        // exports['asdf']
        case 91: {
          if (pos++, ch = commentWhitespace(), ch === 39 || ch === 34) {
            let startPos = pos;
            stringLiteral(ch);
            let endPos = ++pos;
            if (ch = commentWhitespace(), ch !== 93 || (pos++, ch = commentWhitespace(), ch !== 61)) break;
            _exports.add(decode(source.slice(startPos, endPos)));
          }
          break;
        }
        // module.exports =
        case 61:
          if (assign) {
            if (reexports.size && (reexports = /* @__PURE__ */ new Set()), pos++, ch = commentWhitespace(), ch === 123) {
              tryParseLiteralExports();
              return;
            }
            ch === 114 && tryParseRequire(ExportAssign);
          }
      }
      pos = revertPos;
    }
    function tryParseRequire(requireType) {
      let revertPos = pos;
      if (source.startsWith("equire", pos + 1)) {
        pos += 7;
        let ch = commentWhitespace();
        if (ch === 40) {
          pos++, ch = commentWhitespace();
          let reexportStart = pos;
          if (ch === 39 || ch === 34) {
            stringLiteral(ch);
            let reexportEnd = ++pos;
            if (ch = commentWhitespace(), ch === 41)
              switch (requireType) {
                case ExportAssign:
                  return reexports.add(decode(source.slice(reexportStart, reexportEnd))), !0;
                case ExportStar:
                  return reexports.add(decode(source.slice(reexportStart, reexportEnd))), !0;
                default:
                  return lastStarExportSpecifier = decode(source.slice(reexportStart, reexportEnd)), !0;
              }
          }
        }
        pos = revertPos;
      }
      return !1;
    }
    function tryParseLiteralExports() {
      let revertPos = pos - 1;
      for (; pos++ < end; ) {
        let ch = commentWhitespace(), startPos = pos;
        if (identifier()) {
          let endPos = pos;
          if (ch = commentWhitespace(), ch === 58) {
            if (pos++, ch = commentWhitespace(), !identifier()) {
              pos = revertPos;
              return;
            }
            ch = source.charCodeAt(pos);
          }
          _exports.add(decode(source.slice(startPos, endPos)));
        } else if (ch === 46 && source.startsWith("..", pos + 1)) {
          if (pos += 3, source.charCodeAt(pos) === 114 && tryParseRequire(ExportAssign))
            pos++;
          else if (!identifier()) {
            pos = revertPos;
            return;
          }
          ch = commentWhitespace();
        } else if (ch === 39 || ch === 34) {
          let startPos2 = pos;
          stringLiteral(ch);
          let endPos = ++pos;
          if (ch = commentWhitespace(), ch === 58) {
            if (pos++, ch = commentWhitespace(), !identifier()) {
              pos = revertPos;
              return;
            }
            ch = source.charCodeAt(pos), _exports.add(decode(source.slice(startPos2, endPos)));
          }
        } else {
          pos = revertPos;
          return;
        }
        if (ch === 125)
          return;
        if (ch !== 44) {
          pos = revertPos;
          return;
        }
      }
    }
    function scanStringLiteral(source2) {
      let quote2 = source2[0];
      if (quote2 === '"')
        try {
          return JSON.parse(source2);
        } catch {
        }
      else if (quote2 === "'" && source2.length > 1 && source2[source2.length - 1] === "'" && source2.indexOf('"') === -1)
        try {
          return JSON.parse('"' + source2.slice(1, -1) + '"');
        } catch {
        }
      let parsed = "", index = { v: 1 };
      for (; index.v < source2.length; ) {
        let char = source2[index.v];
        switch (char) {
          case quote2:
            return parsed;
          case "\\": {
            ++index.v, parsed += scanEscapeSequence(source2, index);
            break;
          }
          case "\r":
          case `
`:
            throw new SyntaxError();
          default:
            ++index.v, parsed += char;
        }
      }
      throw new SyntaxError();
    }
    function scanEscapeSequence(source2, index) {
      if (index.v === source2.length)
        throw new SyntaxError();
      let char = source2[index.v];
      switch (++index.v, char) {
        case "\r":
          source2[index.v] === `
` && ++index.v;
        case `
`:
        case "\u2028":
        case "\u2029":
          return "";
        case "r":
          return "\r";
        case "n":
          return `
`;
        case "t":
          return "	";
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "v":
          return "\v";
        case "x":
          return scanHexEscapeSequence(source2, index);
        case "u":
          return scanUnicodeEscapeSequence(source2, index);
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
          return scanOctalEscapeSequence(char, source2, index);
        default:
          return char;
      }
    }
    function scanHexEscapeSequence(source2, index) {
      let a = readHex(source2[index.v]);
      ++index.v;
      let b = readHex(source2[index.v]);
      return ++index.v, String.fromCodePoint(a * 16 + b);
    }
    function scanUnicodeEscapeSequence(source2, index) {
      let result = 0;
      if (source2[index.v] === "{") {
        ++index.v;
        do {
          if (result = result * 16 + readHex(source2[index.v]), result > 1114111)
            throw new SyntaxError();
          ++index.v;
        } while (source2[index.v] !== "}");
        ++index.v;
      } else
        for (let i = 0; i < 4; ++i)
          result = result * 16 + readHex(source2[index.v]), ++index.v;
      return String.fromCodePoint(result);
    }
    function scanOctalEscapeSequence(char, source2, index) {
      let toRead = char <= "3" ? 2 : 1, result = +char;
      do {
        if (char = source2[index.v], char < "0" || char > "7")
          break;
        result = result * 8 + +char, ++index.v, --toRead;
      } while (toRead > 0);
      return String.fromCodePoint(result);
    }
    function readHex(char) {
      if (char >= "0" && char <= "9")
        return +char;
      if (char >= "a" && char <= "f")
        return char.charCodeAt(0) - 87;
      if (char >= "A" && char <= "F")
        return char.charCodeAt(0) - 55;
      throw new SyntaxError();
    }
    var nonASCIIidentifierStartChars = "\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u037F\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u052F\u0531-\u0556\u0559\u0560-\u0588\u05D0-\u05EA\u05EF-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u0860-\u086A\u08A0-\u08B4\u08B6-\u08C7\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u09FC\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0AF9\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C39\u0C3D\u0C58-\u0C5A\u0C60\u0C61\u0C80\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D04-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D54-\u0D56\u0D5F-\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E86-\u0E8A\u0E8C-\u0EA3\u0EA5\u0EA7-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F5\u13F8-\u13FD\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F8\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1878\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191E\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1C80-\u1C88\u1C90-\u1CBA\u1CBD-\u1CBF\u1CE9-\u1CEC\u1CEE-\u1CF3\u1CF5\u1CF6\u1CFA\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2118-\u211D\u2124\u2126\u2128\u212A-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309B-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312F\u3131-\u318E\u31A0-\u31BF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA69D\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA7BF\uA7C2-\uA7CA\uA7F5-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA8FD\uA8FE\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uA9E0-\uA9E4\uA9E6-\uA9EF\uA9FA-\uA9FE\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA7E-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uAB30-\uAB5A\uAB5C-\uAB69\uAB70-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC", nonASCIIidentifierChars = "\u200C\u200D\xB7\u0300-\u036F\u0387\u0483-\u0487\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u0669\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u06F0-\u06F9\u0711\u0730-\u074A\u07A6-\u07B0\u07C0-\u07C9\u07EB-\u07F3\u07FD\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u0903\u093A-\u093C\u093E-\u094F\u0951-\u0957\u0962\u0963\u0966-\u096F\u0981-\u0983\u09BC\u09BE-\u09C4\u09C7\u09C8\u09CB-\u09CD\u09D7\u09E2\u09E3\u09E6-\u09EF\u09FE\u0A01-\u0A03\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A66-\u0A71\u0A75\u0A81-\u0A83\u0ABC\u0ABE-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AE2\u0AE3\u0AE6-\u0AEF\u0AFA-\u0AFF\u0B01-\u0B03\u0B3C\u0B3E-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B55-\u0B57\u0B62\u0B63\u0B66-\u0B6F\u0B82\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD7\u0BE6-\u0BEF\u0C00-\u0C04\u0C3E-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C66-\u0C6F\u0C81-\u0C83\u0CBC\u0CBE-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CE2\u0CE3\u0CE6-\u0CEF\u0D00-\u0D03\u0D3B\u0D3C\u0D3E-\u0D44\u0D46-\u0D48\u0D4A-\u0D4D\u0D57\u0D62\u0D63\u0D66-\u0D6F\u0D81-\u0D83\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DE6-\u0DEF\u0DF2\u0DF3\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0E50-\u0E59\u0EB1\u0EB4-\u0EBC\u0EC8-\u0ECD\u0ED0-\u0ED9\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E\u0F3F\u0F71-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102B-\u103E\u1040-\u1049\u1056-\u1059\u105E-\u1060\u1062-\u1064\u1067-\u106D\u1071-\u1074\u1082-\u108D\u108F-\u109D\u135D-\u135F\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4-\u17D3\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u18A9\u1920-\u192B\u1930-\u193B\u1946-\u194F\u19D0-\u19DA\u1A17-\u1A1B\u1A55-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AB0-\u1ABD\u1ABF\u1AC0\u1B00-\u1B04\u1B34-\u1B44\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1B82\u1BA1-\u1BAD\u1BB0-\u1BB9\u1BE6-\u1BF3\u1C24-\u1C37\u1C40-\u1C49\u1C50-\u1C59\u1CD0-\u1CD2\u1CD4-\u1CE8\u1CED\u1CF4\u1CF7-\u1CF9\u1DC0-\u1DF9\u1DFB-\u1DFF\u203F\u2040\u2054\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302F\u3099\u309A\uA620-\uA629\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA823-\uA827\uA82C\uA880\uA881\uA8B4-\uA8C5\uA8D0-\uA8D9\uA8E0-\uA8F1\uA8FF-\uA909\uA926-\uA92D\uA947-\uA953\uA980-\uA983\uA9B3-\uA9C0\uA9D0-\uA9D9\uA9E5\uA9F0-\uA9F9\uAA29-\uAA36\uAA43\uAA4C\uAA4D\uAA50-\uAA59\uAA7B-\uAA7D\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEB-\uAAEF\uAAF5\uAAF6\uABE3-\uABEA\uABEC\uABED\uABF0-\uABF9\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFE33\uFE34\uFE4D-\uFE4F\uFF10-\uFF19\uFF3F", nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]"), nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");
    nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;
    var astralIdentifierStartCodes = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 157, 310, 10, 21, 11, 7, 153, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 349, 41, 7, 1, 79, 28, 11, 0, 9, 21, 107, 20, 28, 22, 13, 52, 76, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 85, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 159, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 230, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 35, 56, 264, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 328, 18, 190, 0, 80, 921, 103, 110, 18, 195, 2749, 1070, 4050, 582, 8634, 568, 8, 30, 114, 29, 19, 47, 17, 3, 32, 20, 6, 18, 689, 63, 129, 74, 6, 0, 67, 12, 65, 1, 2, 0, 29, 6135, 9, 1237, 43, 8, 8952, 286, 50, 2, 18, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 2357, 44, 11, 6, 17, 0, 370, 43, 1301, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42717, 35, 4148, 12, 221, 3, 5761, 15, 7472, 3104, 541, 1507, 4938], astralIdentifierCodes = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 370, 1, 154, 10, 176, 2, 54, 14, 32, 9, 16, 3, 46, 10, 54, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 161, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 193, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 84, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 406, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 330, 3, 19306, 9, 135, 4, 60, 6, 26, 9, 1014, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 5319, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 262, 6, 10, 9, 419, 13, 1495, 6, 110, 6, 6, 9, 4759, 9, 787719, 239];
    function isInAstralSet(code, set) {
      let pos2 = 65536;
      for (let i = 0; i < set.length; i += 2) {
        if (pos2 += set[i], pos2 > code) return !1;
        if (pos2 += set[i + 1], pos2 >= code) return !0;
      }
    }
    function isIdentifierStart(code, astral) {
      return code < 65 ? code === 36 : code < 91 ? !0 : code < 97 ? code === 95 : code < 123 ? !0 : code <= 65535 ? code >= 170 && nonASCIIidentifierStart.test(String.fromCharCode(code)) : astral === !1 ? !1 : isInAstralSet(code, astralIdentifierStartCodes);
    }
    function isIdentifierChar(code, astral) {
      return code < 48 ? code === 36 : code < 58 ? !0 : code < 65 ? !1 : code < 91 ? !0 : code < 97 ? code === 95 : code < 123 ? !0 : code <= 65535 ? code >= 170 && nonASCIIidentifier.test(String.fromCharCode(code)) : astral === !1 ? !1 : isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes);
    }
    function identifier() {
      let ch = source.codePointAt(pos);
      if (!isIdentifierStart(ch, !0) || ch === "\\")
        return !1;
      for (pos += codePointLen(ch); ch = source.codePointAt(pos); )
        if (isIdentifierChar(ch, !0))
          pos += codePointLen(ch);
        else {
          if (ch === "\\")
            return !1;
          break;
        }
      return !0;
    }
    function codePointLen(ch) {
      return ch < 65536 ? 1 : 2;
    }
    function codePointAtLast(bPos) {
      let ch = source.charCodeAt(bPos);
      return (ch & 64512) === 56320 ? ((source.charCodeAt(bPos - 1) & 1023) << 10 | ch & 1023) + 65536 : ch;
    }
    function esmSyntaxErr(msg) {
      return Object.assign(new Error(msg), { code: "ERR_LEXER_ESM_SYNTAX" });
    }
    function throwIfImportStatement() {
      let startPos = pos;
      switch (pos += 6, commentWhitespace()) {
        // dynamic import
        case 40:
          pushOpenToken(startPos);
          return;
        // import.meta
        case 46:
          throw esmSyntaxErr("Unexpected import.meta in CJS module.");
        default:
          if (pos === startPos + 6)
            break;
        case 34:
        case 39:
        case 123:
        case 42:
          if (openTokenDepth !== 0) {
            pos--;
            return;
          }
          throw esmSyntaxErr("Unexpected import statement in CJS module.");
      }
    }
    function throwIfExportStatement() {
      pos += 6;
      let curPos = pos, ch = commentWhitespace();
      if (!(pos === curPos && !isPunctuator(ch)))
        throw esmSyntaxErr("Unexpected export statement in CJS module.");
    }
    function commentWhitespace() {
      let ch;
      do
        if (ch = source.charCodeAt(pos), ch === 47) {
          let next_ch = source.charCodeAt(pos + 1);
          if (next_ch === 47)
            lineComment();
          else if (next_ch === 42)
            blockComment();
          else
            return ch;
        } else if (!isBrOrWs(ch))
          return ch;
      while (pos++ < end);
      return ch;
    }
    function templateString() {
      for (; pos++ < end; ) {
        let ch = source.charCodeAt(pos);
        if (ch === 36 && source.charCodeAt(pos + 1) === 123) {
          pos++, pushTemplate();
          return;
        }
        if (ch === 96)
          return;
        ch === 92 && pos++;
      }
      syntaxError();
    }
    function blockComment() {
      for (pos++; pos++ < end; )
        if (source.charCodeAt(pos) === 42 && source.charCodeAt(pos + 1) === 47) {
          pos++;
          return;
        }
    }
    function lineComment() {
      for (; pos++ < end; ) {
        let ch = source.charCodeAt(pos);
        if (ch === 10 || ch === 13)
          return;
      }
    }
    function stringLiteral(quote2) {
      for (; pos++ < end; ) {
        let ch = source.charCodeAt(pos);
        if (ch === quote2)
          return;
        if (ch === 92)
          ch = source.charCodeAt(++pos), ch === 13 && source.charCodeAt(pos + 1) === 10 && pos++;
        else if (isBr(ch))
          break;
      }
      throw new Error("Unterminated string.");
    }
    function regexCharacterClass() {
      for (; pos++ < end; ) {
        let ch = source.charCodeAt(pos);
        if (ch === 93)
          return ch;
        if (ch === 92)
          pos++;
        else if (ch === 10 || ch === 13)
          break;
      }
      throw new Error("Syntax error reading regular expression class.");
    }
    function regularExpression() {
      for (; pos++ < end; ) {
        let ch = source.charCodeAt(pos);
        if (ch === 47)
          return;
        if (ch === 91)
          ch = regexCharacterClass();
        else if (ch === 92)
          pos++;
        else if (ch === 10 || ch === 13)
          break;
      }
      throw new Error("Syntax error reading regular expression.");
    }
    function isBr(c) {
      return c === 13 || c === 10;
    }
    function isBrOrWs(c) {
      return c > 8 && c < 14 || c === 32 || c === 160;
    }
    function isBrOrWsOrPunctuatorNotDot(c) {
      return c > 8 && c < 14 || c === 32 || c === 160 || isPunctuator(c) && c !== 46;
    }
    function isTokenRunChar(ch) {
      let lower = ch | 32;
      return lower >= 97 && lower <= 122 || ch >= 48 && ch <= 57 || ch === 36 || ch === 95 || ch === 92 || ch > 127 && ch !== 160;
    }
    function skipTokenRun() {
      if (isTokenRunChar(source.charCodeAt(pos)))
        for (; isTokenRunChar(source.charCodeAt(pos + 1)); )
          pos++;
    }
    function keywordStart(pos2) {
      return pos2 === 0 || isBrOrWsOrPunctuatorNotDot(source.charCodeAt(pos2 - 1));
    }
    function readPrecedingKeyword(pos2, match) {
      return pos2 < match.length - 1 ? !1 : source.startsWith(match, pos2 - match.length + 1) && (pos2 === 0 || isBrOrWsOrPunctuatorNotDot(source.charCodeAt(pos2 - match.length)));
    }
    function readPrecedingKeyword1(pos2, ch) {
      return source.charCodeAt(pos2) === ch && (pos2 === 0 || isBrOrWsOrPunctuatorNotDot(source.charCodeAt(pos2 - 1)));
    }
    function isExpressionKeyword(pos2) {
      switch (source.charCodeAt(pos2)) {
        case 100:
          switch (source.charCodeAt(pos2 - 1)) {
            case 105:
              return readPrecedingKeyword(pos2 - 2, "vo");
            case 108:
              return readPrecedingKeyword(pos2 - 2, "yie");
            default:
              return !1;
          }
        case 101:
          switch (source.charCodeAt(pos2 - 1)) {
            case 115:
              switch (source.charCodeAt(pos2 - 2)) {
                case 108:
                  return readPrecedingKeyword1(
                    pos2 - 3,
                    101
                    /*e*/
                  );
                case 97:
                  return readPrecedingKeyword1(
                    pos2 - 3,
                    99
                    /*c*/
                  );
                default:
                  return !1;
              }
            case 116:
              return readPrecedingKeyword(pos2 - 2, "dele");
            default:
              return !1;
          }
        case 102:
          if (source.charCodeAt(pos2 - 1) !== 111 || source.charCodeAt(pos2 - 2) !== 101)
            return !1;
          switch (source.charCodeAt(pos2 - 3)) {
            case 99:
              return readPrecedingKeyword(pos2 - 4, "instan");
            case 112:
              return readPrecedingKeyword(pos2 - 4, "ty");
            default:
              return !1;
          }
        case 110:
          return readPrecedingKeyword1(
            pos2 - 1,
            105
            /*i*/
          ) || readPrecedingKeyword(pos2 - 1, "retur");
        case 111:
          return readPrecedingKeyword1(
            pos2 - 1,
            100
            /*d*/
          );
        case 114:
          return readPrecedingKeyword(pos2 - 1, "debugge");
        case 116:
          return readPrecedingKeyword(pos2 - 1, "awai");
        case 119:
          switch (source.charCodeAt(pos2 - 1)) {
            case 101:
              return readPrecedingKeyword1(
                pos2 - 2,
                110
                /*n*/
              );
            case 111:
              return readPrecedingKeyword(pos2 - 2, "thr");
            default:
              return !1;
          }
      }
      return !1;
    }
    function isParenKeyword(curPos) {
      return source.charCodeAt(curPos) === 101 && source.startsWith("whil", curPos - 4) || source.charCodeAt(curPos) === 114 && source.startsWith("fo", curPos - 2) || source.charCodeAt(curPos - 1) === 105 && source.charCodeAt(curPos) === 102;
    }
    function isPunctuator(ch) {
      return ch === 33 || ch === 37 || ch === 38 || ch > 39 && ch < 48 || ch > 57 && ch < 64 || ch === 91 || ch === 93 || ch === 94 || ch > 122 && ch < 127;
    }
    function isExpressionPunctuator(ch) {
      return ch === 33 || ch === 37 || ch === 38 || ch > 39 && ch < 47 && ch !== 41 || ch > 57 && ch < 64 || ch === 91 || ch === 94 || ch > 122 && ch < 127 && ch !== 125;
    }
    function isExpressionTerminator(curPos) {
      switch (source.charCodeAt(curPos)) {
        case 62:
          return source.charCodeAt(curPos - 1) === 61;
        case 59:
        case 41:
          return !0;
        case 104:
          return source.startsWith("catc", curPos - 4);
        case 121:
          return source.startsWith("finall", curPos - 6);
        case 101:
          return source.startsWith("els", curPos - 3);
      }
      return !1;
    }
    var initPromise = Promise.resolve();
    module.exports.init = () => initPromise;
    module.exports.initSync = () => {
    };
    module.exports.parse = parseCJS;
  }
});

// src/container.ts
init_vfs();

// src/tree.ts
init_vfs();
function mountTree(fs, tree, at) {
  fs.mkdir(at, { recursive: !0 });
  for (let [name, node] of Object.entries(tree)) {
    let p = at === "/" ? `/${name}` : `${at}/${name}`;
    "directory" in node ? mountTree(fs, node.directory, p) : "symlink" in node.file ? (fs.rm(p, { force: !0 }), fs.symlink(node.file.symlink, p)) : fs.writeFile(p, toBytes(node.file.contents));
  }
}
function exportTree(fs, dir, excludes = [], rel = "") {
  let out = {};
  for (let d of fs.readdirEntries(dir)) {
    let r = rel ? `${rel}/${d.name}` : d.name;
    if (excludes.some((re) => re.test(r) || d.isDirectory() && re.test(r + "/"))) continue;
    let p = `${dir === "/" ? "" : dir}/${d.name}`;
    d.isSymbolicLink() ? out[d.name] = { file: { symlink: fs.readlink(p) } } : d.isDirectory() ? out[d.name] = { directory: exportTree(fs, p, excludes, r) } : out[d.name] = { file: { contents: fs.readFile(p).slice() } };
  }
  return out;
}
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    let c = glob[i];
    if (c === "*")
      if (glob[i + 1] === "*") {
        let slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*", i += slash ? 2 : 1;
      } else re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      let end = glob.indexOf("}", i);
      re += "(?:" + glob.slice(i + 1, end).split(",").map(escape).join("|") + ")", i = end;
    } else re += escape(c);
  }
  return new RegExp(`^${re}$`);
}
var escape = (s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&");

// src/ports.ts
var PREVIEW_PREFIX = "/__clover__/", PortTable = class {
  constructor(instanceId, events) {
    this.instanceId = instanceId;
    this.events = events;
  }
  instanceId;
  events;
  ports = /* @__PURE__ */ new Map();
  url(port) {
    return `${typeof location < "u" ? location.origin : "http://localhost"}${PREVIEW_PREFIX}${this.instanceId}/${port}/`;
  }
  open(port, handler, owner = "user") {
    let existed = this.ports.has(port);
    this.ports.set(port, { handler, owner });
    let u = this.url(port);
    return existed || this.events.open(port, u), u;
  }
  close(port) {
    this.ports.delete(port) && this.events.close(port, this.url(port));
  }
  has(port) {
    return this.ports.has(port);
  }
  list() {
    return [...this.ports.keys()];
  }
  /** Lowest free port >= start. */
  free(start) {
    let p = start;
    for (; this.ports.has(p); ) p++;
    return p;
  }
  async dispatch(port, req) {
    let e = this.ports.get(port);
    if (!e) return new Response(`No server listening on port ${port}`, { status: 502, headers: { "content-type": "text/plain" } });
    try {
      return await e.handler(req);
    } catch (err2) {
      let msg = err2 instanceof Error ? err2.stack || err2.message : String(err2);
      return new Response(`Internal error on port ${port}:
${msg}`, { status: 500, headers: { "content-type": "text/plain" } });
    }
  }
  /** Answer a request bridged from the service worker. Streams the body back over `reply`. */
  async answer(m, reply) {
    let url = `http://localhost:${m.port}${m.path.startsWith("/") ? m.path : "/" + m.path}`, init2 = { method: m.method, headers: m.headers };
    m.body && m.method !== "GET" && m.method !== "HEAD" && (init2.body = m.body);
    let res;
    try {
      res = await this.dispatch(m.port, new Request(url, init2));
    } catch (e) {
      res = new Response(String(e), { status: 500 });
    }
    if (reply.postMessage({ type: "head", status: res.status, statusText: res.statusText, headers: [...res.headers] }), !res.body) {
      reply.postMessage({ type: "end" });
      return;
    }
    let reader = res.body.getReader(), cancelled = !1;
    reply.onmessage = (ev) => {
      ev.data?.type === "cancel" && (cancelled = !0, reader.cancel().catch(() => {
      }));
    };
    try {
      for (; ; ) {
        let { done, value } = await reader.read();
        if (done || cancelled) break;
        let copy = (value instanceof Uint8Array ? value : new TextEncoder().encode(String(value))).slice();
        reply.postMessage({ type: "chunk", data: copy }, [copy.buffer]);
      }
      reply.postMessage({ type: "end" });
    } catch (e) {
      reply.postMessage({ type: "error", message: String(e) });
    }
  }
};

// src/process.ts
var Channel = class {
  buf = [];
  waiters = [];
  closed = !1;
  push(s) {
    if (this.closed) return;
    let w = this.waiters.shift();
    w ? w({ value: s, done: !1 }) : this.buf.push(s);
  }
  close() {
    this.closed = !0;
    for (let w of this.waiters.splice(0)) w({ value: void 0, done: !0 });
  }
  /** Drain without awaiting. */
  takeAll() {
    return this.buf.splice(0);
  }
  next() {
    return this.buf.length ? Promise.resolve({ value: this.buf.shift(), done: !1 }) : this.closed ? Promise.resolve({ value: void 0, done: !0 }) : new Promise((r) => this.waiters.push(r));
  }
  [Symbol.asyncIterator]() {
    return { next: () => this.next(), return: async () => ({ value: void 0, done: !0 }) };
  }
}, EMPTY_STDIN = {
  [Symbol.asyncIterator]: () => ({ next: async () => ({ value: void 0, done: !0 }) })
};
async function readAll(it) {
  let s = "";
  for await (let c of it) s += c;
  return s;
}
function crlf(w) {
  return { write: (s) => w.write(s.replace(/\r?\n/g, `\r
`)) };
}
function createProcess(run, opts = {}) {
  let abort = new AbortController(), stdin = new Channel(), ctrl, closed = !1, output = new ReadableStream({
    start: (c) => {
      ctrl = c;
    },
    cancel: () => {
      closed = !0;
    }
  }), raw = {
    write: (s) => {
      if (!closed && s)
        try {
          ctrl.enqueue(s);
        } catch {
          closed = !0;
        }
    }
  }, out = opts.terminal ? crlf(raw) : raw, input = new WritableStream({
    write: (s) => stdin.push(String(s)),
    close: () => stdin.close()
  }), exit = (async () => {
    await Promise.resolve();
    try {
      return await run({ stdout: out, stderr: out, stdin, signal: abort.signal });
    } catch (e) {
      return out.write(`${errorMessage(e)}
`), 1;
    }
  })().then((code) => {
    if (stdin.close(), !closed) {
      closed = !0;
      try {
        ctrl.close();
      } catch {
      }
    }
    return code;
  });
  return { output, input, exit, kill: () => abort.abort() };
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function aborted(signal) {
  return new Promise((r) => signal.aborted ? r() : signal.addEventListener("abort", () => r(), { once: !0 }));
}

// src/shell/builtins.ts
init_path();
var abs = (ctx, p) => resolve(ctx.cwd, p);
function flags(args) {
  let f = /* @__PURE__ */ new Set(), rest = [], done = !1;
  for (let a of args)
    if (!done && a === "--") done = !0;
    else if (!done && a.startsWith("-") && a.length > 1 && !/^-\d+$/.test(a)) for (let c of a.slice(1)) f.add(c);
    else rest.push(a);
  return { flags: f, rest };
}
function err(ctx, cmd, e) {
  return ctx.stderr.write(`${cmd}: ${e instanceof Error ? e.message : String(e)}
`), 1;
}
var BLUE = "\x1B[1;34m", CYAN = "\x1B[1;36m", RESET = "\x1B[0m";
async function lines(ctx, files) {
  if (!files.length) return readAll(ctx.stdin);
  let vfs = ctx.container.vfs;
  return files.map((f) => vfs.readText(abs(ctx, f))).join("");
}
function headTail(ctx, tail) {
  return (async () => {
    let n = 10, files = [];
    for (let i = 0; i < ctx.args.length; i++) {
      let a = ctx.args[i];
      a === "-n" ? n = parseInt(ctx.args[++i], 10) : /^-n\d+$/.test(a) ? n = parseInt(a.slice(2), 10) : /^-\d+$/.test(a) ? n = parseInt(a.slice(1), 10) : files.push(a);
    }
    try {
      let ls = (await lines(ctx, files)).split(`
`);
      ls[ls.length - 1] === "" && ls.pop();
      let sel = tail ? ls.slice(Math.max(0, ls.length - n)) : ls.slice(0, n);
      return sel.length && ctx.stdout.write(sel.join(`
`) + `
`), 0;
    } catch (e) {
      return err(ctx, tail ? "tail" : "head", e);
    }
  })();
}
var builtins = {
  cd(ctx, sh) {
    let target = ctx.args[0] === void 0 || ctx.args[0] === "~" ? ctx.env.HOME || "/" : ctx.args[0] === "-" ? ctx.env.OLDPWD || ctx.cwd : ctx.args[0], p = abs(ctx, target);
    return ctx.container.vfs.isDir(p) ? (sh && (sh.env.OLDPWD = sh.cwd, sh.cwd = p, sh.env.PWD = p), 0) : (ctx.stderr.write(`cd: no such file or directory: ${target}
`), 1);
  },
  pwd(ctx) {
    return ctx.stdout.write(ctx.cwd + `
`), 0;
  },
  echo(ctx) {
    let args = ctx.args, nl = !0;
    return args[0] === "-n" && (nl = !1, args = args.slice(1)), ctx.stdout.write(args.join(" ") + (nl ? `
` : "")), 0;
  },
  true: () => 0,
  false: () => 1,
  async sleep(ctx) {
    let ms = parseFloat(ctx.args[0] ?? "0") * 1e3;
    return await new Promise((r) => {
      let t = setTimeout(r, ms);
      ctx.signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: !0 });
    }), ctx.signal.aborted ? 130 : 0;
  },
  ls(ctx) {
    let { flags: f, rest } = flags(ctx.args), vfs = ctx.container.vfs, targets = rest.length ? rest : ["."], code = 0;
    for (let t of targets) {
      let p = abs(ctx, t);
      try {
        if (!vfs.stat(p).isDirectory()) {
          ctx.stdout.write(t + `
`);
          continue;
        }
        targets.length > 1 && ctx.stdout.write(`${t}:
`);
        let ents = vfs.readdirEntries(p);
        if (f.has("a") || (ents = ents.filter((e) => !e.name.startsWith("."))), f.has("l"))
          for (let e of ents) {
            let s = vfs.lstat(join(p, e.name)), kind = e.isDirectory() ? "d" : e.isSymbolicLink() ? "l" : "-", date = new Date(s.mtimeMs).toISOString().slice(0, 16).replace("T", " ");
            ctx.stdout.write(`${kind}rw-r--r--  ${String(s.size).padStart(8)}  ${date}  ${color(e, ctx)}
`);
          }
        else if (ents.length) {
          let names = ents.map((e) => color(e, ctx));
          ctx.stdout.write((ctx.isTTY ? names.join("  ") : names.join(`
`)) + `
`);
        }
      } catch (e) {
        code = err(ctx, "ls", e);
      }
    }
    return code;
  },
  async cat(ctx) {
    try {
      return ctx.stdout.write(await lines(ctx, ctx.args)), 0;
    } catch (e) {
      return err(ctx, "cat", e);
    }
  },
  head: (ctx) => headTail(ctx, !1),
  tail: (ctx) => headTail(ctx, !0),
  mkdir(ctx) {
    let { flags: f, rest } = flags(ctx.args);
    try {
      for (let d of rest) ctx.container.vfs.mkdir(abs(ctx, d), { recursive: f.has("p") });
      return 0;
    } catch (e) {
      return err(ctx, "mkdir", e);
    }
  },
  rm(ctx) {
    let { flags: f, rest } = flags(ctx.args);
    try {
      for (let d of rest) {
        let p = abs(ctx, d);
        if (!f.has("r") && !f.has("R") && ctx.container.vfs.isDir(p)) throw new Error(`${d}: is a directory`);
        ctx.container.vfs.rm(p, { recursive: f.has("r") || f.has("R"), force: f.has("f") });
      }
      return 0;
    } catch (e) {
      return err(ctx, "rm", e);
    }
  },
  rmdir(ctx) {
    try {
      for (let d of ctx.args) ctx.container.vfs.rmdir(abs(ctx, d));
      return 0;
    } catch (e) {
      return err(ctx, "rmdir", e);
    }
  },
  mv(ctx) {
    let { rest } = flags(ctx.args);
    if (rest.length < 2) return err(ctx, "mv", "missing operand");
    let vfs = ctx.container.vfs;
    try {
      let dest = abs(ctx, rest[rest.length - 1]), srcs = rest.slice(0, -1);
      for (let s of srcs) {
        let from = abs(ctx, s);
        vfs.rename(from, vfs.isDir(dest) ? join(dest, basename(from)) : dest);
      }
      return 0;
    } catch (e) {
      return err(ctx, "mv", e);
    }
  },
  cp(ctx) {
    let { flags: f, rest } = flags(ctx.args);
    if (rest.length < 2) return err(ctx, "cp", "missing operand");
    let vfs = ctx.container.vfs;
    try {
      let dest = abs(ctx, rest[rest.length - 1]);
      for (let s of rest.slice(0, -1)) {
        let from = abs(ctx, s);
        if (vfs.isDir(from) && !f.has("r") && !f.has("R")) throw new Error(`-r not specified; omitting directory '${s}'`);
        vfs.cp(from, vfs.isDir(dest) ? join(dest, basename(from)) : dest);
      }
      return 0;
    } catch (e) {
      return err(ctx, "cp", e);
    }
  },
  touch(ctx) {
    let vfs = ctx.container.vfs;
    try {
      for (let f of ctx.args) {
        let p = abs(ctx, f);
        vfs.exists(p) ? vfs.utimes(p, Date.now()) : vfs.writeFile(p, "");
      }
      return 0;
    } catch (e) {
      return err(ctx, "touch", e);
    }
  },
  env(ctx) {
    return ctx.stdout.write(
      Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`).join(`
`) + `
`
    ), 0;
  },
  export(ctx, sh) {
    for (let a of ctx.args) {
      let i = a.indexOf("=");
      i > 0 && sh && (sh.env[a.slice(0, i)] = a.slice(i + 1));
    }
    return ctx.args.length ? 0 : builtins.env(ctx, sh);
  },
  unset(ctx, sh) {
    for (let a of ctx.args) sh && delete sh.env[a];
    return 0;
  },
  which(ctx) {
    let code = 0;
    for (let name of ctx.args) {
      let where = ctx.container.which(name, ctx.cwd, ctx.env);
      where ? ctx.stdout.write(where + `
`) : (ctx.stderr.write(`${name} not found
`), code = 1);
    }
    return code;
  },
  clear(ctx) {
    return ctx.stdout.write("\x1B[2J\x1B[3J\x1B[H"), 0;
  },
  exit(ctx, sh) {
    let code = parseInt(ctx.args[0] ?? "0", 10) || 0;
    return sh && (sh.exitRequested = code), code;
  },
  help(ctx) {
    return ctx.stdout.write(
      `jsh builtins: ${Object.keys(builtins).sort().join(" ")}
commands: npm npx node vite serve tsc + node_modules/.bin + registered
`
    ), 0;
  }
};
function color(e, ctx) {
  return ctx.isTTY ? e.isDirectory() ? `${BLUE}${e.name}${RESET}` : e.isSymbolicLink() ? `${CYAN}${e.name}${RESET}` : e.name : e.name;
}

// src/commands.ts
init_path();

// src/npm/install.ts
var import_semver2 = __toESM(require_semver2(), 1);
init_path();

// src/npm/resolver.ts
var import_semver = __toESM(require_semver2(), 1), NON_REGISTRY = /^(github:|gitlab:|bitbucket:|gist:|git\+|git:|file:|link:|workspace:|portal:|patch:|https?:|\.{0,2}\/|~\/)/;
function parseSpec(name, spec) {
  if (spec = (spec ?? "").trim(), spec.startsWith("npm:")) {
    let rest = spec.slice(4), at = rest.lastIndexOf("@");
    return at > 0 ? { pkg: rest.slice(0, at), range: rest.slice(at + 1) || "latest" } : { pkg: rest, range: "latest" };
  }
  return NON_REGISTRY.test(spec) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec) ? { skip: `${name}@${spec}` } : { pkg: name, range: spec || "latest" };
}
function pickVersion(p, range) {
  let tags = p["dist-tags"] ?? {};
  if (tags[range]) return tags[range];
  let versions = Object.keys(p.versions ?? {}), latest = tags.latest;
  return (range === "" || range === "*" || range === "x") && latest && p.versions[latest] ? latest : import_semver.default.validRange(range, { loose: !0 }) ? latest && p.versions[latest] && import_semver.default.satisfies(latest, range, { loose: !0 }) ? latest : import_semver.default.maxSatisfying(versions, range, { loose: !0 }) : null;
}
function depsOf(m, includePeers) {
  let out = [], optional = m.optionalDependencies ?? {};
  for (let [n, s] of Object.entries(m.dependencies ?? {})) n in optional || out.push({ name: n, spec: s, kind: "prod" });
  for (let [n, s] of Object.entries(optional)) out.push({ name: n, spec: s, kind: "optional" });
  if (includePeers) {
    let meta = m.peerDependenciesMeta ?? {};
    for (let [n, s] of Object.entries(m.peerDependencies ?? {}))
      n in (m.dependencies ?? {}) || out.push({ name: n, spec: s, kind: meta[n]?.optional ? "peerOptional" : "peer" });
  }
  return out;
}
function platformBound(m) {
  return !!(m.os?.length || m.cpu?.length);
}
async function resolveTree(rootDeps, registry, opts = {}) {
  let warnings = [], root = { name: "", pkg: "", version: "", parent: null, children: /* @__PURE__ */ new Map(), depth: 0 }, fetched = /* @__PURE__ */ new Map(), level = [{ node: root, deps: rootDeps }], peerQueue = [], fetchAll = async (names) => {
    await Promise.all(
      names.filter((n) => !fetched.has(n)).map(async (n) => {
        try {
          fetched.set(n, await registry.packument(n));
        } catch (e) {
          fetched.set(n, e);
        }
      })
    );
  }, place = (node, dep) => {
    let parsed = parseSpec(dep.name, dep.spec);
    if ("skip" in parsed)
      return warnings.push(`skipping non-registry dependency ${parsed.skip}`), null;
    let isPeer = dep.kind === "peer" || dep.kind === "peerOptional", found;
    for (let a = node; a && (found = a.children.get(dep.name), !found); a = a.parent)
      ;
    if (found && ((n) => n.pkg === parsed.pkg && (import_semver.default.satisfies(n.version, parsed.range, { loose: !0, includePrerelease: !0 }) || n.version === parsed.range))(found)) return null;
    if (isPeer && found)
      return warnings.push(`peer dependency ${dep.name}@${dep.spec} (required by ${node.name || "root"}) conflicts with installed ${found.version}`), null;
    if (dep.kind === "peerOptional" && !found) return null;
    let pk = fetched.get(parsed.pkg);
    if (!pk || pk instanceof Error) {
      if (dep.kind === "optional" || isPeer)
        return warnings.push(`optional dependency ${dep.name} failed: ${pk instanceof Error ? pk.message : "not fetched"}`), null;
      throw pk ?? new Error(`failed to fetch ${parsed.pkg}`);
    }
    let version2 = pickVersion(pk, parsed.range), manifest = version2 ? pk.versions[version2] : void 0;
    if (!version2 || !manifest) {
      if (dep.kind === "optional" || isPeer) return null;
      throw new Error(`No matching version found for ${parsed.pkg}@${parsed.range}${node.name ? ` (required by ${node.name}@${node.version})` : ""}`);
    }
    if (dep.kind === "optional" && platformBound(manifest)) return null;
    let target = found ? node : root, child = { name: dep.name, pkg: parsed.pkg, version: version2, manifest, parent: target, children: /* @__PURE__ */ new Map(), depth: target.depth + 1 };
    return target.children.set(dep.name, child), manifest.deprecated && node === root && warnings.push(`deprecated ${parsed.pkg}@${version2}: ${manifest.deprecated}`), child;
  };
  for (; level.length; ) {
    let names = /* @__PURE__ */ new Set();
    for (let { deps } of level)
      for (let d of deps) {
        let p = parseSpec(d.name, d.spec);
        "skip" in p || names.add(p.pkg);
      }
    opts.onProgress?.(`resolving ${names.size} packages`), await fetchAll([...names]);
    let next = [];
    for (let { node, deps } of level)
      for (let dep of deps) {
        if (dep.kind === "peer" || dep.kind === "peerOptional") {
          peerQueue.push({ node, dep });
          continue;
        }
        let child = place(node, dep);
        child && next.push({ node: child, deps: depsOf(child.manifest, opts.peers !== !1) });
      }
    if (!next.length && peerQueue.length) {
      let peers = peerQueue.splice(0), pnames = /* @__PURE__ */ new Set();
      for (let { dep } of peers) {
        let p = parseSpec(dep.name, dep.spec);
        "skip" in p || pnames.add(p.pkg);
      }
      await fetchAll([...pnames]);
      for (let { node, dep } of peers) {
        let child = place(node, dep);
        child && next.push({ node: child, deps: depsOf(child.manifest, opts.peers !== !1) });
      }
    }
    level = next;
  }
  let placements = [], walk = (n, base) => {
    for (let c of [...n.children.values()].sort((a, b) => a.name < b.name ? -1 : 1)) {
      let path2 = `${base}node_modules/${c.name}`;
      placements.push({ path: path2, name: c.name, pkg: c.pkg, version: c.version, manifest: c.manifest, depth: c.depth }), walk(c, path2 + "/");
    }
  };
  return walk(root, ""), { placements, warnings };
}

// src/npm/tar.ts
var dec2 = new TextDecoder();
function str(buf, off, len) {
  let end = off;
  for (; end < off + len && buf[end] !== 0; ) end++;
  return dec2.decode(buf.subarray(off, end));
}
function octal(buf, off, len) {
  if (buf[off] & 128) {
    let v = 0;
    for (let i = off + 1; i < off + len; i++) v = v * 256 + buf[i];
    return v;
  }
  let s = str(buf, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}
function parsePax(data) {
  let out = {}, text = dec2.decode(data), i = 0;
  for (; i < text.length; ) {
    let sp = text.indexOf(" ", i);
    if (sp < 0) break;
    let len = parseInt(text.slice(i, sp), 10);
    if (!len) break;
    let rec = text.slice(sp + 1, i + len - 1), eq = rec.indexOf("=");
    eq > 0 && (out[rec.slice(0, eq)] = rec.slice(eq + 1)), i += len;
  }
  return out;
}
function untar(buf, strip = 0) {
  let out = [], off = 0, paxPath, longName, globalPax = {};
  for (; off + 512 <= buf.length; ) {
    let h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let size = octal(h, 124, 12), flag = String.fromCharCode(h[156] || 48), dataStart = off + 512, data = buf.subarray(dataStart, dataStart + size);
    if (off = dataStart + Math.ceil(size / 512) * 512, flag === "x") {
      paxPath = parsePax(data).path;
      continue;
    }
    if (flag === "g") {
      globalPax = { ...globalPax, ...parsePax(data) };
      continue;
    }
    if (flag === "L") {
      longName = str(data, 0, data.length);
      continue;
    }
    let name = paxPath ?? longName ?? globalPax.path;
    if (!name) {
      let prefix2 = str(h, 345, 155);
      name = str(h, 0, 100), prefix2 && dec2.decode(h.subarray(257, 262)) === "ustar" && (name = `${prefix2}/${name}`);
    }
    paxPath = longName = void 0;
    let parts = name.split("/").filter((p) => p && p !== ".");
    if (parts.some((p) => p === "..")) continue;
    let rel = parts.slice(strip).join("/");
    if (!rel) continue;
    let mode = octal(h, 100, 8);
    flag === "0" || flag === "\0" || flag === "7" ? out.push({ path: rel, type: "file", data, mode }) : flag === "5" ? out.push({ path: rel, type: "dir", data: new Uint8Array(0), mode }) : flag === "2" && out.push({ path: rel, type: "symlink", data: new Uint8Array(0), linkname: str(h, 157, 100), mode });
  }
  return out;
}
async function gunzip(data) {
  if (data[0] !== 31 || data[1] !== 139) return data;
  let stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// src/npm/install.ts
var DIM = "\x1B[2m", YELLOW = "\x1B[33m", RESET2 = "\x1B[0m";
function readPkg(vfs, cwd) {
  let t = vfs.tryReadText(join(cwd, "package.json"));
  return t == null ? null : JSON.parse(t);
}
function writePkg(vfs, cwd, pkg) {
  vfs.writeFile(join(cwd, "package.json"), JSON.stringify(pkg, null, 2) + `
`);
}
function splitPkgSpec(s) {
  let at = s.indexOf("@", s.startsWith("@") ? 1 : 0);
  return at < 0 ? { name: s, spec: "" } : { name: s.slice(0, at), spec: s.slice(at + 1) };
}
async function install(vfs, registry, o) {
  let t0 = Date.now(), pkg = readPkg(vfs, o.cwd) ?? (o.add?.length ? { name: "project", version: "1.0.0" } : null);
  if (!pkg) throw new Error(`ENOENT: no package.json in ${o.cwd} (run \`npm init -y\`)`);
  let warn = (m) => o.out.write(`${YELLOW}npm warn${RESET2} ${m}
`);
  for (let name of o.remove ?? []) for (let f of ["dependencies", "devDependencies", "optionalDependencies"]) pkg[f] && delete pkg[f][name];
  if (o.add?.length) {
    let field = o.dev ? "devDependencies" : "dependencies";
    pkg[field] ??= {};
    for (let raw of o.add) {
      let { name, spec } = splitPkgSpec(raw), parsed = parseSpec(name, spec);
      if ("skip" in parsed) {
        warn(`skipping non-registry dependency ${raw}`), pkg[field][name] = spec;
        continue;
      }
      let p = await registry.packument(parsed.pkg), v = pickVersion(p, parsed.range);
      if (!v) throw new Error(`No matching version found for ${raw}`);
      let saved = spec && import_semver2.default.validRange(spec) && !p["dist-tags"][spec] ? spec : o.exact ? v : `^${v}`;
      pkg[field][name] = spec.startsWith("npm:") ? `npm:${parsed.pkg}@${saved}` : saved;
      let other = o.dev ? "dependencies" : "devDependencies";
      pkg[other] && delete pkg[other][name];
    }
    for (let f of ["dependencies", "devDependencies"]) pkg[f] && (pkg[f] = sortKeys(pkg[f]));
  }
  (o.add?.length || o.remove?.length) && writePkg(vfs, o.cwd, pkg);
  let deps = [], seen = /* @__PURE__ */ new Set(), push = (rec, kind) => {
    for (let [name, spec] of Object.entries(rec ?? {})) seen.has(name) || (seen.add(name), deps.push({ name, spec, kind }));
  };
  push(pkg.dependencies, "prod"), push(pkg.devDependencies, "dev"), push(pkg.optionalDependencies, "optional");
  let { placements, warnings } = await resolveTree(deps, registry);
  for (let w of warnings) warn(w);
  if (o.signal?.aborted) throw new Error("aborted");
  let nm = join(o.cwd, "node_modules"), want = new Map(placements.map((p) => [p.path, p])), installed = listInstalled(vfs, o.cwd), removed = 0;
  for (let [path2, version2] of installed) {
    let p = want.get(path2);
    (!p || p.version !== version2) && (vfs.rm(join(o.cwd, path2), { recursive: !0, force: !0 }), p || removed++);
  }
  let todo = placements.filter((p) => readVersion(vfs, join(o.cwd, p.path)) !== p.version);
  todo.length && o.out.write(`${DIM}fetching ${todo.length} package${todo.length === 1 ? "" : "s"}\u2026${RESET2}
`), await pool(todo, 16, async (p) => {
    if (o.signal?.aborted) throw new Error("aborted");
    let tgz = await registry.tarball(p.manifest.dist.tarball, p.manifest.dist.integrity), entries = untar(await gunzip(tgz), 1), dir = join(o.cwd, p.path);
    vfs.mkdir(dir, { recursive: !0 });
    for (let e of entries) {
      let fp = join(dir, e.path);
      e.type === "dir" ? vfs.mkdir(fp, { recursive: !0 }) : e.type === "file" ? vfs.writeFile(fp, e.data.slice(), { mkdirp: !0 }) : e.type === "symlink" && e.linkname && (vfs.mkdir(join(fp, ".."), { recursive: !0 }), vfs.rm(fp, { force: !0 }), vfs.symlink(e.linkname, fp));
    }
    vfs.isFile(join(dir, "package.json")) || vfs.writeFile(join(dir, "package.json"), JSON.stringify({ name: p.pkg, version: p.version })), p.manifest.hasInstallScript && warn(`skipped install scripts for ${p.pkg}@${p.version}`);
  }), linkBins(vfs, o.cwd, placements), writeLock(vfs, o.cwd, pkg, placements), vfs.isDir(nm) || vfs.mkdir(nm, { recursive: !0 });
  let secs = ((Date.now() - t0) / 1e3).toFixed(1), parts = [`added ${todo.length} package${todo.length === 1 ? "" : "s"}`];
  return removed && parts.push(`removed ${removed} package${removed === 1 ? "" : "s"}`), o.out.write(`
${parts.join(", ")}, and audited ${placements.length + 1} packages in ${secs}s
`), { added: todo.length, removed, warnings };
}
function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a < b ? -1 : 1));
}
function readVersion(vfs, dir) {
  let t = vfs.tryReadText(join(dir, "package.json"));
  if (!t) return null;
  try {
    return JSON.parse(t).version ?? null;
  } catch {
    return null;
  }
}
function listInstalled(vfs, cwd) {
  let out = /* @__PURE__ */ new Map(), scan = (rel) => {
    let abs2 = join(cwd, rel);
    if (vfs.isDir(abs2)) {
      for (let name of vfs.readdir(abs2))
        if (!name.startsWith("."))
          if (name.startsWith("@"))
            for (let sub of vfs.isDir(join(abs2, name)) ? vfs.readdir(join(abs2, name)) : []) visit(`${rel}/${name}/${sub}`);
          else visit(`${rel}/${name}`);
    }
  }, visit = (rel) => {
    let v = readVersion(vfs, join(cwd, rel));
    out.set(rel, v ?? ""), scan(`${rel}/node_modules`);
  };
  return scan("node_modules"), out;
}
function binEntries(name, bin) {
  return bin ? typeof bin == "string" ? [[name.startsWith("@") ? name.split("/")[1] : name, bin]] : Object.entries(bin) : [];
}
function linkBins(vfs, cwd, placements) {
  let binDir = join(cwd, "node_modules/.bin");
  vfs.rm(binDir, { recursive: !0, force: !0 });
  for (let p of placements) {
    if (p.depth !== 1) continue;
    let bin = p.manifest.bin;
    if (!bin) {
      let t = vfs.tryReadText(join(cwd, p.path, "package.json"));
      bin = t ? JSON.parse(t).bin : void 0;
    }
    for (let [name, rel] of binEntries(p.name, bin)) {
      let target = `../${p.name}/${rel.replace(/^\.\//, "")}`;
      vfs.writeFile(join(binDir, name), `#!/usr/bin/env node
// clover-bin -> ${target}
require(${JSON.stringify(target)})
`, { mkdirp: !0 });
    }
  }
}
function writeLock(vfs, cwd, pkg, placements) {
  let packages = {
    "": { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }
  };
  for (let p of placements)
    packages[p.path] = {
      ...p.pkg !== p.name ? { name: p.pkg } : {},
      version: p.version,
      resolved: p.manifest.dist.tarball,
      integrity: p.manifest.dist.integrity,
      ...p.manifest.dependencies ? { dependencies: p.manifest.dependencies } : {}
    };
  vfs.writeFile(join(cwd, "package-lock.json"), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: !0, packages }, null, 2) + `
`);
}
async function pool(items, n, fn) {
  let i = 0, failed = null, worker = async () => {
    for (; i < items.length && !failed; ) {
      let item = items[i++];
      try {
        await fn(item);
      } catch (e) {
        failed ??= e;
      }
    }
  };
  if (await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker)), failed) throw failed;
}

// src/dev/project.ts
init_path();
function parseJsonc(text) {
  let out = "", i = 0, inStr = !1;
  for (; i < text.length; ) {
    let c = text[i];
    if (inStr)
      out += c, c === "\\" ? out += text[++i] ?? "" : c === '"' && (inStr = !1), i++;
    else if (c === '"')
      inStr = !0, out += c, i++;
    else if (c === "/" && text[i + 1] === "/")
      for (; i < text.length && text[i] !== `
`; ) i++;
    else if (c === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else
      out += c, i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
function parseDotenv(text) {
  let out = {};
  for (let line of text.split(/\r?\n/)) {
    let m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m) continue;
    let v = (m[2] ?? "").trim(), q = v[0];
    (q === '"' || q === "'" || q === "`") && v.endsWith(q) ? (v = v.slice(1, -1), q === '"' && (v = v.replace(/\\n/g, `
`))) : v = v.replace(/\s+#.*$/, ""), out[m[1]] = v;
  }
  return out;
}
function loadEnv(vfs, root, mode, prefix2 = "VITE_") {
  let all = {};
  for (let f of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    let t = vfs.tryReadText(join(root, f));
    t != null && Object.assign(all, parseDotenv(t));
  }
  let env = { MODE: mode, DEV: mode !== "production", PROD: mode === "production", SSR: !1, BASE_URL: "/" };
  for (let [k, v] of Object.entries(all)) k.startsWith(prefix2) && (env[k] = v);
  return env;
}
function envDefines(env) {
  let d = { "import.meta.env": JSON.stringify(env), "import.meta.hot": "undefined" };
  for (let [k, v] of Object.entries(env)) d[`import.meta.env.${k}`] = JSON.stringify(v);
  return d;
}
function readProjectConfig(vfs, root) {
  let co = {}, baseDir = root, load = (file, depth = 0) => {
    let t = vfs.tryReadText(file);
    if (t == null || depth > 4) return;
    let j;
    try {
      j = parseJsonc(t);
    } catch {
      return;
    }
    if (typeof j.extends == "string" && j.extends.startsWith(".") && load(normalize(join(dirname(file), j.extends.endsWith(".json") ? j.extends : j.extends + ".json")), depth + 1), j.compilerOptions && (co = { ...co, ...j.compilerOptions }, (j.compilerOptions.baseUrl || j.compilerOptions.paths) && (baseDir = dirname(file))), !j.compilerOptions && j.references) for (let r of j.references) {
      let p = normalize(join(dirname(file), r.path));
      load(p.endsWith(".json") ? p : join(p, "tsconfig.json"), depth + 1);
    }
  };
  load(join(root, "tsconfig.json")), Object.keys(co).length || load(join(root, "jsconfig.json"));
  let pkg = vfs.tryReadText(join(root, "package.json")), deps = {};
  try {
    let j = pkg ? JSON.parse(pkg) : {};
    deps = { ...j.devDependencies, ...j.dependencies };
  } catch {
  }
  let jsxImportSource = co.jsxImportSource || (deps.react ? "react" : deps.preact ? "preact" : deps["solid-js"] ? "solid-js/h" : "react"), tsJsx = String(co.jsx ?? "").toLowerCase(), classic = tsJsx === "react" || !!co.jsxFactory && !co.jsxImportSource;
  tsJsx === "preserve" && deps.preact && (jsxImportSource = "preact");
  let baseUrl = co.baseUrl ? normalize(join(baseDir, co.baseUrl)) : baseDir, paths = Object.entries(co.paths ?? {}).map(([pattern, targets]) => ({
    pattern,
    targets: targets.map((t) => normalize(join(baseUrl, t)))
  })), tsconfigRaw = { compilerOptions: Object.fromEntries(["experimentalDecorators", "emitDecoratorMetadata", "useDefineForClassFields", "verbatimModuleSyntax", "preserveValueImports", "importsNotUsedAsValues"].filter((k) => k in co).map((k) => [k, co[k]])) };
  return {
    jsx: classic ? "transform" : "automatic",
    jsxImportSource,
    jsxFactory: co.jsxFactory,
    jsxFragment: co.jsxFragmentFactory,
    paths,
    tsconfigRaw
  };
}
function matchPaths(cfg, spec) {
  for (let { pattern, targets } of cfg.paths) {
    let star = pattern.indexOf("*");
    if (star < 0) {
      if (spec === pattern) return targets;
      continue;
    }
    let pre = pattern.slice(0, star), post = pattern.slice(star + 1);
    if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length) {
      let mid = spec.slice(pre.length, spec.length - post.length);
      return targets.map((t) => t.replace("*", mid));
    }
  }
  return null;
}
function jsxOptions(cfg) {
  return cfg.jsx === "automatic" ? { jsx: "automatic", jsxImportSource: cfg.jsxImportSource } : { jsx: "transform", jsxFactory: cfg.jsxFactory ?? "React.createElement", jsxFragment: cfg.jsxFragment ?? "React.Fragment" };
}
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json"
}, mimeType = (p) => MIME[extname(p).toLowerCase()] ?? "application/octet-stream", SCRIPT_EXT = /\.(m?[jt]sx?|cjs|cts|mts)$/, ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|pdf|wasm|txt)$/i;

// src/shell/jsh.ts
init_path();

// src/shell/parser.ts
var ParseError = class extends Error {
}, OPS = ["2>&1", "2>>", "&&", "||", ">>", "2>", "&>", ";", "|", ">", "<", "&"];
function tokenize(src) {
  let toks = [], i = 0, n = src.length, readVar = () => {
    if (i++, src[i] === "{") {
      let end = src.indexOf("}", i);
      if (end < 0) throw new ParseError("bad substitution");
      let expr = src.slice(i + 1, end);
      i = end + 1;
      let m2 = /^([A-Za-z_][A-Za-z0-9_]*)(:?)-(.*)$/s.exec(expr);
      return m2 ? { v: m2[1], def: m2[3], colon: !!m2[2] } : { v: expr };
    }
    if (/[?$#0-9]/.test(src[i] ?? "")) return { v: src[i++] };
    let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    return m ? (i += m[0].length, { v: m[0] }) : "$";
  };
  for (; i < n; ) {
    let c = src[i];
    if (c === " " || c === "	" || c === `
` || c === "\r") {
      i++;
      continue;
    }
    if (c === "#") {
      for (; i < n && src[i] !== `
`; ) i++;
      continue;
    }
    let op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ t: "op", v: op }), i += op.length;
      continue;
    }
    let w = [], lit = "", quoted = !1, assign = -1, flush = () => {
      lit && w.push(lit), lit = "";
    };
    for (; i < n && !/[\s;|&<>]/.test(src[i]); ) {
      let ch = src[i];
      if (ch === "'") {
        quoted = !0;
        let end = src.indexOf("'", i + 1);
        if (end < 0) throw new ParseError("unterminated quote");
        lit += src.slice(i + 1, end), i = end + 1;
      } else if (ch === '"') {
        for (quoted = !0, i++; i < n && src[i] !== '"'; )
          src[i] === "\\" && '"\\$`'.includes(src[i + 1]) ? (lit += src[i + 1], i += 2) : src[i] === "$" ? (flush(), w.push(readVar())) : lit += src[i++];
        if (src[i] !== '"') throw new ParseError("unterminated quote");
        i++;
      } else ch === "\\" ? (lit += src[i + 1] ?? "", i += 2) : ch === "$" ? (flush(), w.push(readVar())) : ch === "~" && !w.length && !lit && (i + 1 >= n || /[\s/;|&]/.test(src[i + 1])) ? (w.push({ v: "HOME", def: "/home", colon: !0 }), i++) : (ch === "=" && !quoted && assign < 0 && !w.length && /^[A-Za-z_][A-Za-z0-9_]*$/.test(lit) && (assign = lit.length), lit += src[i++]);
    }
    flush(), w.length || w.push(""), toks.push({ t: "word", w, assign });
  }
  return toks;
}
function parse2(src) {
  let toks = tokenize(src), list = [], pipeline = [], cmd = { assigns: [], argv: [], redirects: [] }, empty = () => !cmd.argv.length && !cmd.assigns.length && !cmd.redirects.length, endCmd = (near) => {
    if (empty()) throw new ParseError(`syntax error near unexpected token '${near}'`);
    pipeline.push(cmd), cmd = { assigns: [], argv: [], redirects: [] };
  };
  for (let k = 0; k < toks.length; k++) {
    let tok = toks[k];
    if (tok.t === "word") {
      if (tok.assign >= 0 && !cmd.argv.length) {
        let first = tok.w[0];
        cmd.assigns.push([first.slice(0, tok.assign), [first.slice(tok.assign + 1), ...tok.w.slice(1)]]);
      } else cmd.argv.push(tok.w);
      continue;
    }
    switch (tok.v) {
      case "|":
        endCmd("|");
        break;
      case "&&":
      case "||":
      case ";":
      case "&":
        if ((tok.v === ";" || tok.v === "&") && empty() && !pipeline.length) {
          if (!list.length) throw new ParseError(`syntax error near unexpected token '${tok.v}'`);
          continue;
        }
        endCmd(tok.v), list.push({ pipeline, op: tok.v === "&" ? ";" : tok.v }), pipeline = [];
        break;
      case "2>&1":
        cmd.redirects.push({ op: "2>&1", target: [] });
        break;
      default: {
        let next = toks[++k];
        if (!next || next.t !== "word") throw new ParseError(`syntax error near unexpected token '${tok.v}'`);
        cmd.redirects.push({ op: tok.v, target: next.w });
      }
    }
  }
  if (!empty()) endCmd("");
  else if (pipeline.length) throw new ParseError("syntax error: unexpected end of input");
  if (pipeline.length) list.push({ pipeline, op: null });
  else if (list.length && list[list.length - 1].op !== ";") throw new ParseError("syntax error: unexpected end of input");
  return list.length && (list[list.length - 1].op = null), list;
}
function expandWord(w, env) {
  let s = "";
  for (let p of w)
    if (typeof p == "string") s += p;
    else {
      let v = env[p.v];
      s += p.def === void 0 ? v ?? "" : p.colon ? v || p.def : v ?? p.def;
    }
  return s;
}
function quote(s) {
  return /^[A-Za-z0-9_\-./:=@%+,]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

// src/shell/jsh.ts
var STATE_BUILTINS = /* @__PURE__ */ new Set(["cd", "export", "unset", "exit"]), Shell = class {
  constructor(c, cwd, env) {
    this.c = c;
    this.state = { cwd, env: { ...env, PWD: cwd } };
  }
  c;
  state;
  status = 0;
  /** Run a command line; returns exit status of the last pipeline. */
  async run(line, io) {
    let list;
    try {
      list = parse2(line);
    } catch (e) {
      if (e instanceof ParseError)
        return io.stderr.write(`jsh: ${e.message}
`), this.status = 2;
      throw e;
    }
    let status = this.status, skip = !1;
    for (let item of list) {
      if (skip || (status = this.status = await this.runPipeline(item.pipeline, io)), io.signal.aborted) return this.status = 130;
      if (this.state.exitRequested !== void 0) return status;
      skip = item.op === "&&" && status !== 0 || item.op === "||" && status === 0;
    }
    return status;
  }
  envFor() {
    return { ...this.state.env, "?": String(this.status), $: "1" };
  }
  async runPipeline(cmds, io) {
    if (cmds.length === 1) return this.runSimple(cmds[0], io.stdin, io.stdout, io);
    let chans = cmds.slice(1).map(() => new Channel()), runs = cmds.map((cmd, i) => {
      let stdin = i === 0 ? io.stdin : chans[i - 1], out = i === cmds.length - 1 ? io.stdout : { write: (s) => chans[i].push(s) };
      return this.runSimple(cmd, stdin, out, io).finally(() => chans[i]?.close());
    }), codes = await Promise.all(runs);
    return codes[codes.length - 1];
  }
  async runSimple(cmd, stdin, stdout, io) {
    let venv = this.envFor(), assigns = cmd.assigns.map(([k, w]) => [k, expandWord(w, venv)]), argv = cmd.argv.map((w) => expandWord(w, venv));
    if (!argv.length) {
      for (let [k, v] of assigns) this.state.env[k] = v;
      return 0;
    }
    let vfs = this.c.vfs, out = stdout, err2 = io.stderr, finals = [];
    for (let r of cmd.redirects) {
      let target = r.op === "2>&1" ? "" : resolve(this.state.cwd, expandWord(r.target, venv)), sink = (append) => {
        if (target === "/dev/null") return { write() {
        } };
        try {
          (!append || !vfs.exists(target)) && vfs.writeFile(target, "");
        } catch (e) {
          throw new Error(`jsh: ${errorMessage(e)}`);
        }
        return { write: (s) => vfs.writeFile(target, s, { append: !0 }) };
      };
      try {
        if (r.op === ">" || r.op === ">>") out = sink(r.op === ">>");
        else if (r.op === "2>" || r.op === "2>>") err2 = sink(r.op === "2>>");
        else if (r.op === "&>") out = err2 = sink(!1);
        else if (r.op === "2>&1") err2 = out;
        else if (r.op === "<") {
          let text = target === "/dev/null" ? "" : vfs.readText(target), ch = new Channel();
          ch.push(text), ch.close(), stdin = ch;
        }
      } catch (e) {
        return io.stderr.write(`jsh: ${errorMessage(e).replace(/^jsh: /, "")}
`), 1;
      }
    }
    let env = { ...this.state.env };
    for (let [k, v] of assigns) env[k] = v;
    let ctx = {
      args: argv.slice(1),
      cwd: this.state.cwd,
      env,
      stdout: out,
      stderr: err2,
      stdin: stdin ?? EMPTY_STDIN,
      signal: io.signal,
      container: this.c,
      isTTY: io.isTTY && out === stdout
    };
    try {
      let name = argv[0];
      return STATE_BUILTINS.has(name) ? await builtins[name](ctx, this.state) : await this.c.exec(name, ctx);
    } finally {
      finals.forEach((f) => f());
    }
  }
}, PROMPT_COLOR = "\x1B[1;32m", DIR_COLOR = "\x1B[1;34m", RESET3 = "\x1B[0m";
async function interactive(c, sh, io) {
  let out = io.stdout, history = [], hIdx = 0, line = "", cursor = 0, job = null, lines2 = new Channel(), prompt = () => {
    let cwd = sh.state.cwd, home = sh.state.env.HOME, shown = home && (cwd === home || cwd.startsWith(home + "/")) ? "~" + cwd.slice(home.length) : cwd;
    return `${PROMPT_COLOR}\u276F${RESET3} ${DIR_COLOR}${basename(shown) || shown}${RESET3} `;
  }, redraw = () => {
    out.write(`\r\x1B[K${prompt()}${line}`);
    let back = line.length - cursor;
    back > 0 && out.write(`\x1B[${back}D`);
  }, onKey = (seq) => {
    if (job) {
      seq === "" ? (out.write(`^C
`), job.abort.abort()) : seq === "" ? job.stdin.close() : seq === "\r" || seq === `
` ? (out.write(`
`), job.stdin.push(job.buf + `
`), job.buf = "") : seq === "\x7F" || seq === "\b" ? job.buf && (job.buf = job.buf.slice(0, -1), out.write("\b \b")) : !seq.startsWith("\x1B") && seq >= " " && (job.buf += seq, out.write(seq));
      return;
    }
    switch (seq) {
      case "\r":
      case `
`:
        out.write(`
`), lines2.push(line), line.trim() && history[history.length - 1] !== line && history.push(line), hIdx = history.length, line = "", cursor = 0;
        return;
      case "":
        out.write(`^C
`), line = "", cursor = 0, sh.status = 130, out.write(prompt());
        return;
      case "":
        line || lines2.close();
        return;
      case "\x7F":
      case "\b":
        cursor > 0 && (line = line.slice(0, cursor - 1) + line.slice(cursor), cursor--, redraw());
        return;
      case "\x1B[3~":
        cursor < line.length && (line = line.slice(0, cursor) + line.slice(cursor + 1), redraw());
        return;
      case "\x1B[D":
        cursor > 0 && (cursor--, out.write(seq));
        return;
      case "\x1B[C":
        cursor < line.length && (cursor++, out.write(seq));
        return;
      case "\x1B[H":
      case "":
        cursor = 0, redraw();
        return;
      case "\x1B[F":
      case "":
        cursor = line.length, redraw();
        return;
      case "":
        line = line.slice(cursor), cursor = 0, redraw();
        return;
      case "\v":
        line = line.slice(0, cursor), redraw();
        return;
      case "\f":
        out.write("\x1B[2J\x1B[H"), redraw();
        return;
      case "\x1B[A":
      case "\x1B[B": {
        if (!history.length) return;
        hIdx = Math.max(0, Math.min(history.length, hIdx + (seq === "\x1B[A" ? -1 : 1))), line = history[hIdx] ?? "", cursor = line.length, redraw();
        return;
      }
      case "	":
        return complete();
    }
    if (seq.startsWith("\x1B")) return;
    let printable = seq.replace(/[\x00-\x1f]/g, "");
    printable && (line = line.slice(0, cursor) + printable + line.slice(cursor), cursor += printable.length, cursor === line.length ? out.write(printable) : redraw());
  }, complete = () => {
    let before = line.slice(0, cursor), word = /(\S*)$/.exec(before)[1], dirPart = word.includes("/") ? word.slice(0, word.lastIndexOf("/") + 1) : "", base = word.slice(dirPart.length), dir = resolve(sh.state.cwd, dirPart || "."), names = [];
    try {
      names = c.vfs.readdir(dir).filter((n) => n.startsWith(base));
    } catch {
      return;
    }
    if (names.length !== 1) return;
    let isDir = c.vfs.isDir(resolve(dir, names[0])), add = names[0].slice(base.length) + (isDir ? "/" : " ");
    line = before + add + line.slice(cursor), cursor += add.length, redraw();
  }, pump = (async () => {
    for await (let chunk of io.stdin) {
      let re = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b.|[\s\S]/g, m;
      for (; m = re.exec(chunk); ) onKey(m[0].replace(/^\x1bO/, "\x1B["));
    }
    lines2.close();
  })();
  out.write(prompt());
  for await (let l of lines2) {
    if (io.signal.aborted) break;
    if (l.trim()) {
      let abort = new AbortController(), stdin = new Channel();
      job = { abort, stdin, buf: "" };
      let onKill = () => abort.abort();
      io.signal.addEventListener("abort", onKill);
      try {
        await sh.run(l, { stdout: out, stderr: out, stdin, signal: abort.signal, isTTY: !0 });
      } catch (e) {
        out.write(`jsh: ${errorMessage(e)}
`);
      } finally {
        io.signal.removeEventListener("abort", onKill), stdin.close(), job = null;
      }
      if (sh.state.exitRequested !== void 0) break;
    }
    out.write(prompt());
  }
  return sh.state.exitRequested ?? sh.status;
}

// src/node/host.ts
init_path();
init_vfs();
init_resolve();

// src/esm.ts
init_path();
init_resolve();
var ESM_SYNTAX = /(^|[\n;])\s*(import\s*[\w{*"'$]|export\s*(\{|\*|default\b|const\b|let\b|var\b|function\b|class\b|async\b))/, CJS_SYNTAX = /\b(module\.exports|exports\.[\w$]+\s*=|require\s*\(\s*['"`])/;
function isEsmFile(fs, path2, code) {
  let ext = extname(path2);
  if (ext === ".mjs" || ext === ".mts") return !0;
  if (ext === ".cjs" || ext === ".cts") return !1;
  let root = findPackageRoot(fs, dirname(path2)), pkg = root ? readPackageJson(fs, root) : null;
  if (pkg?.type === "module" && (ext === ".js" || ext === ".ts" || ext === ".jsx" || ext === ".tsx")) return !0;
  let stripped = code.replace(/\/\*[\s\S]*?\*\/|([^:\\'"`]|^)\/\/.*$/gm, "$1");
  return ESM_SYNTAX.test(stripped) ? !0 : CJS_SYNTAX.test(stripped) ? !1 : pkg?.type === "module";
}

// src/node/host.ts
init_esbuild();

// src/node/protocol.ts
var enc2 = new TextEncoder(), dec3 = new TextDecoder();
function encodeResult(ok, value) {
  if (!ok) {
    let e = value, body = enc2.encode(JSON.stringify({ message: e?.message ?? String(value), code: e?.code, path: e?.path }));
    return prefix(2, body);
  }
  return value === void 0 ? new Uint8Array([3]) : value instanceof Uint8Array ? prefix(1, value) : prefix(0, enc2.encode(JSON.stringify(value)));
}
function prefix(tag, body) {
  let out = new Uint8Array(body.byteLength + 1);
  return out[0] = tag, out.set(body, 1), out;
}

// src/node/host.ts
var HASHES = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }, loadCache = /* @__PURE__ */ new WeakMap();
async function loadModule(c, path2) {
  let st = c.vfs.stat(path2), cache = loadCache.get(c);
  cache || loadCache.set(c, cache = /* @__PURE__ */ new Map());
  let hit = cache.get(path2);
  if (hit && hit.mtime === st.mtimeMs) return hit.value;
  let code = c.vfs.readText(path2), ext = extname(path2), value;
  if (ext === ".json") value = { code, format: "json" };
  else {
    let ts = /\.[mc]?tsx?$/.test(ext) || ext === ".jsx", esm = isEsmFile(c.resolveFs, path2, code);
    if (!ts && !esm) value = { code, format: "cjs" };
    else {
      let es = await loadEsbuild(c.esbuildWasmUrl);
      try {
        value = { code: (await es.transform(code, {
          loader: ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : ts ? "ts" : "js",
          format: "cjs",
          platform: "node",
          target: "es2022",
          sourcefile: path2,
          sourcemap: "inline",
          jsx: "automatic",
          define: { "import.meta.url": "__clover_meta_url", "import.meta.dirname": "__dirname", "import.meta.filename": "__filename" },
          supported: { "dynamic-import": !1 },
          logLevel: "silent"
        })).code, format: "cjs" };
      } catch (e) {
        let msg = formatErrors(e);
        throw /Top-level await/.test(msg) ? new Error(`${path2}: top-level await is not supported by clover's node runtime yet; wrap it in an async function`) : new SyntaxError(msg);
      }
    }
  }
  return cache.set(path2, { mtime: st.mtimeMs, value }), value;
}
async function runOp(c, op, args) {
  let vfs = c.vfs, p = args[0];
  switch (op) {
    case "readFile":
      return vfs.readFile(p);
    case "writeFile":
      vfs.writeFile(p, toBytes(args[1]), { append: args[2] === "a" });
      return;
    case "stat":
    case "lstat": {
      let s = op === "stat" ? vfs.stat(p) : vfs.lstat(p);
      return { type: s.type, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, mode: s.mode };
    }
    case "exists":
      return vfs.exists(p);
    case "readdir":
      return vfs.readdirEntries(p).map((d) => ({ name: d.name, type: d.isDirectory() ? "dir" : d.isSymbolicLink() ? "symlink" : "file" }));
    case "mkdir": {
      let existed = vfs.exists(p);
      return vfs.mkdir(p, { recursive: !!args[1] }), args[1] && !existed ? p : void 0;
    }
    case "rm":
      vfs.rm(p, { recursive: !!args[1], force: !!args[2] });
      return;
    case "unlink":
      vfs.unlink(p);
      return;
    case "rmdir":
      vfs.rmdir(p);
      return;
    case "rename":
      vfs.rename(p, args[1]);
      return;
    case "copyFile":
      vfs.copyFile(p, args[1]);
      return;
    case "cp":
      vfs.cp(p, args[1]);
      return;
    case "realpath":
      return vfs.realpath(p);
    case "readlink":
      return vfs.readlink(p);
    case "symlink":
      vfs.symlink(p, args[1]);
      return;
    case "utimes":
      vfs.utimes(p, args[1]);
      return;
    case "resolve":
      return resolveModule(c.resolveFs, p, args[1], NODE_OPTS);
    case "load":
      return loadModule(c, p);
    case "hash": {
      let name = HASHES[(p || "").toLowerCase().replace("-", "")];
      if (!name) throw new Error(`Digest method not supported: ${p}`);
      return new Uint8Array(await crypto.subtle.digest(name, args[1]));
    }
    case "hmac": {
      let name = HASHES[(p || "").toLowerCase().replace("-", "")];
      if (!name) throw new Error(`Digest method not supported: ${p}`);
      let key = await crypto.subtle.importKey("raw", args[1], { name: "HMAC", hash: name }, !1, ["sign"]);
      return new Uint8Array(await crypto.subtle.sign("HMAC", key, args[2]));
    }
    case "fetch-local": {
      let [port, method, url, headers, body] = args, res = await c.ports.dispatch(port, new Request(url, { method, headers, body: body && method !== "GET" && method !== "HEAD" ? body : void 0 }));
      return { status: res.status, statusText: res.statusText, headers: [...res.headers], body: new Uint8Array(await res.arrayBuffer()) };
    }
    default:
      throw new Error(`unknown op ${op}`);
  }
}
var pidCounter = 100;
async function nodeCommand(ctx) {
  let c = ctx.container, args = [...ctx.args];
  if (args[0] === "-v" || args[0] === "--version")
    return ctx.stdout.write(`${NODE_VERSION}
`), 0;
  let evalCode = null;
  for (; args[0]?.startsWith("-"); ) {
    let a = args.shift();
    if (a === "-e" || a === "--eval" || a === "-p" || a === "--print") {
      let code = args.shift() ?? "";
      evalCode = a === "-p" || a === "--print" ? `console.log(eval(${JSON.stringify(code)}))` : code;
    } else if (a === "--") break;
  }
  let entry;
  if (evalCode !== null)
    entry = resolve(ctx.cwd, `[eval-${Date.now()}].js`), c.vfs.writeFile(entry, evalCode);
  else {
    if (!args.length)
      return ctx.stderr.write(`node: interactive REPL is not supported; pass a script
`), 1;
    entry = resolve(ctx.cwd, args.shift());
  }
  try {
    return await runNode(ctx, entry, args);
  } finally {
    evalCode !== null && c.vfs.rm(entry, { force: !0 });
  }
}
var NODE_VERSION = "v22.12.0";
function runNode(ctx, entry, args) {
  let c = ctx.container, worker = c.createWorker("node-worker.js"), sab = typeof SharedArrayBuffer < "u" && globalThis.crossOriginIsolated !== !1 ? new SharedArrayBuffer(4194312) : null, post = (m, transfer = []) => worker.postMessage(m, transfer), ports = /* @__PURE__ */ new Set(), pending = /* @__PURE__ */ new Map(), reqId = 0, stash = null, writeSync = (payload) => {
    let buf = sab, i32 = new Int32Array(buf, 0, 2);
    payload.byteLength > buf.byteLength - 8 ? (stash = payload, Atomics.store(i32, 1, payload.byteLength), Atomics.store(i32, 0, 2)) : (new Uint8Array(buf, 8, payload.byteLength).set(payload), Atomics.store(i32, 1, payload.byteLength), Atomics.store(i32, 0, 1)), Atomics.notify(i32, 0);
  };
  return new Promise((resolveExit) => {
    let done = !1, finish = (code) => {
      if (!done) {
        done = !0, worker.terminate();
        for (let p of ports) c.ports.close(p);
        for (let [, p] of pending) p.reject(new Error("process exited"));
        ctx.signal.removeEventListener("abort", onAbort), resolveExit(code);
      }
    }, onAbort = () => {
      post({ type: "signal", name: "SIGINT" }), setTimeout(() => finish(130), 150);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: !0 }), worker.onerror = (e) => {
      ctx.stderr.write(`node: worker error: ${e.message ?? e}
`), finish(1);
    }, worker.onmessage = async (ev) => {
      let m = ev.data;
      switch (m.type) {
        case "stdout":
          ctx.stdout.write(m.data);
          break;
        case "stderr":
          ctx.stderr.write(m.data);
          break;
        case "exit":
          finish(m.code);
          break;
        case "sync": {
          let payload;
          try {
            payload = encodeResult(!0, await runOp(c, m.op, m.args));
          } catch (e) {
            payload = encodeResult(!1, e instanceof FsError ? e : { message: errorMessage(e), code: e.code });
          }
          writeSync(payload);
          break;
        }
        case "sync-grow": {
          sab = m.sab;
          let payload = stash;
          stash = null, writeSync(payload);
          break;
        }
        case "async": {
          try {
            let value = await runOp(c, m.op, m.args);
            post({ type: "async-result", id: m.id, ok: !0, value });
          } catch (e) {
            post({ type: "async-result", id: m.id, ok: !1, value: { message: errorMessage(e), code: e.code } });
          }
          break;
        }
        case "listen": {
          ports.add(m.port), c.ports.open(m.port, (req) => forward(m.port, req), "node");
          break;
        }
        case "unlisten":
          ports.delete(m.port), c.ports.close(m.port);
          break;
        case "http-head": {
          let p = pending.get(m.id);
          if (!p) break;
          let nullBody = m.status === 204 || m.status === 304 || m.status === 101, body = nullBody ? null : new ReadableStream({
            start: (ctrl) => {
              p.ctrl = ctrl;
            },
            cancel: () => post({ type: "http-abort", id: m.id })
          });
          p.resolve(new Response(body, { status: m.status, statusText: m.statusText, headers: m.headers.filter(([k]) => k.toLowerCase() !== "content-length" || !nullBody) })), nullBody && pending.delete(m.id);
          break;
        }
        case "http-chunk":
          pending.get(m.id)?.ctrl?.enqueue(m.data);
          break;
        case "http-end": {
          let p = pending.get(m.id);
          pending.delete(m.id);
          try {
            m.error ? p?.ctrl?.error(new Error(m.error)) : p?.ctrl?.close();
          } catch {
          }
          break;
        }
      }
    };
    let forward = async (port, req) => {
      let id = ++reqId, body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer(), u = new URL(req.url);
      return new Promise((resolve2, reject) => {
        pending.set(id, { resolve: resolve2, reject }), post({ type: "http-request", id, port, method: req.method, url: u.pathname + u.search, headers: [...req.headers], body }, body ? [body] : []);
      });
    };
    ctx.stdin[Symbol.asyncIterator] && (async () => {
      for await (let s of ctx.stdin) {
        if (done) return;
        post({ type: "stdin", data: s });
      }
      done || post({ type: "stdin-end" });
    })(), post({
      type: "start",
      argv: ["/usr/local/bin/node", entry, ...args],
      env: ctx.env,
      cwd: ctx.cwd,
      isTTY: !!ctx.isTTY,
      columns: 80,
      pid: ++pidCounter,
      sab,
      ports: c.ports.list()
    });
  });
}

// src/commands.ts
var BOLD = "\x1B[1m", DIM2 = "\x1B[2m", GREEN = "\x1B[32m", CYAN2 = "\x1B[36m", RED = "\x1B[31m", RESET4 = "\x1B[0m", NPM_VERSION = "10.9.0";
function parseFlags(args) {
  let flags2 = /* @__PURE__ */ new Map(), rest = [];
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      let eq = a.indexOf("=");
      eq > 0 ? flags2.set(a.slice(2, eq), a.slice(eq + 1)) : flags2.set(a.slice(2), !0);
    } else if (a.startsWith("-") && a.length > 1) for (let ch of a.slice(1)) flags2.set(ch, !0);
    else rest.push(a);
  }
  return { flags: flags2, rest };
}
async function runScript(ctx, cwd, name, extra, quiet = !1) {
  let c = ctx.container, pkg = readPkg(c.vfs, cwd);
  if (pkg?.scripts?.[name] === void 0) return -1;
  let env = { ...ctx.env, PATH: `${join(cwd, "node_modules/.bin")}:${ctx.env.PATH ?? ""}`, npm_lifecycle_event: name, npm_package_name: pkg?.name ?? "", npm_package_version: pkg?.version ?? "", INIT_CWD: cwd }, sh = new Shell(c, cwd, env), io = { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal, isTTY: ctx.isTTY };
  for (let phase of [`pre${name}`, name, `post${name}`]) {
    let s = pkg.scripts[phase];
    if (s === void 0) continue;
    let line = phase === name && extra.length ? `${s} ${extra.map(quote).join(" ")}` : s;
    quiet || ctx.stdout.write(`
${DIM2}> ${pkg?.name ?? ""}${pkg?.version ? "@" + pkg.version : ""} ${phase}
> ${line}${RESET4}

`);
    let code = await sh.run(line, io);
    if (code !== 0) return code;
  }
  return 0;
}
var npm = async (ctx) => {
  let c = ctx.container, [sub = "help", ...args] = ctx.args, { flags: flags2, rest } = parseFlags(args), cwd = ctx.cwd;
  try {
    switch (sub) {
      case "-v":
      case "--version":
      case "version":
        return ctx.stdout.write(NPM_VERSION + `
`), 0;
      case "i":
      case "install":
      case "add":
      case "ci":
        return await install(c.vfs, c.registry, { cwd, add: rest, dev: flags2.has("D") || flags2.has("save-dev"), exact: flags2.has("E") || flags2.has("save-exact"), out: ctx.stdout, signal: ctx.signal }), 0;
      case "un":
      case "uninstall":
      case "remove":
      case "rm":
        if (!rest.length) throw new Error("npm uninstall: missing package name");
        return await install(c.vfs, c.registry, { cwd, remove: rest.map((r) => splitPkgSpec(r).name), out: ctx.stdout, signal: ctx.signal }), 0;
      case "run":
      case "run-script": {
        if (!rest.length) {
          let pkg = readPkg(c.vfs, cwd), scripts = Object.entries(pkg?.scripts ?? {});
          return ctx.stdout.write(scripts.length ? `Scripts available via \`npm run\`:
${scripts.map(([k, v]) => `  ${k}
    ${DIM2}${v}${RESET4}`).join(`
`)}
` : `no scripts
`), 0;
        }
        let code = await runScript(ctx, cwd, rest[0], rest.slice(1), flags2.has("silent") || flags2.has("s"));
        return code === -1 ? (ctx.stderr.write(`${RED}npm error${RESET4} Missing script: "${rest[0]}"
`), 1) : code;
      }
      case "start":
      case "test":
      case "t": {
        let name = sub === "t" ? "test" : sub, code = await runScript(ctx, cwd, name, rest);
        return code === -1 ? name === "start" && c.vfs.isFile(join(cwd, "server.js")) ? c.exec("node", { ...ctx, args: ["server.js"] }) : (ctx.stderr.write(`${RED}npm error${RESET4} Missing script: "${name}"
`), 1) : code;
      }
      case "init": {
        if (c.vfs.isFile(join(cwd, "package.json")) && !flags2.has("y") && !flags2.has("yes"))
          return ctx.stdout.write(`package.json already exists
`), 0;
        let name = cwd.split("/").pop().toLowerCase().replace(/[^a-z0-9._-]/g, "-") || "project", pkg = readPkg(c.vfs, cwd) ?? { name, version: "1.0.0", description: "", main: "index.js", scripts: { test: 'echo "Error: no test specified" && exit 1' }, keywords: [], author: "", license: "ISC" };
        return writePkg(c.vfs, cwd, pkg), ctx.stdout.write(`Wrote to ${join(cwd, "package.json")}:

${JSON.stringify(pkg, null, 2)}
`), 0;
      }
      case "exec":
      case "x":
        return npx({ ...ctx, args: rest });
      case "ls":
      case "list": {
        let pkg = readPkg(c.vfs, cwd);
        ctx.stdout.write(`${pkg?.name ?? ""}@${pkg?.version ?? ""} ${cwd}
`);
        for (let name of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies })) {
          let v = readPkg(c.vfs, join(cwd, "node_modules", name))?.version;
          ctx.stdout.write(`\u251C\u2500\u2500 ${name}@${v ?? `${RED}UNMET DEPENDENCY${RESET4}`}
`);
        }
        return 0;
      }
      case "pkg": {
        if (rest[0] === "get") {
          let pkg = readPkg(c.vfs, cwd);
          return ctx.stdout.write(JSON.stringify(rest[1] ? pkg?.[rest[1]] : pkg, null, 2) + `
`), 0;
        }
        if (rest[0] === "set") {
          let pkg = readPkg(c.vfs, cwd) ?? {};
          for (let kv of rest.slice(1)) {
            let [k, ...v] = kv.split("="), keys = k.split("."), o = pkg;
            for (let key of keys.slice(0, -1)) o = o[key] ??= {};
            o[keys[keys.length - 1]] = v.join("=");
          }
          return writePkg(c.vfs, cwd, pkg), 0;
        }
        break;
      }
      case "config":
      case "audit":
      case "fund":
      case "outdated":
      case "prune":
      case "dedupe":
        return ctx.stdout.write(`npm ${sub}: not supported in clover (no-op)
`), 0;
      case "help":
      case "-h":
      case "--help":
        return ctx.stdout.write(`npm (clover ${NPM_VERSION})
  install|i [pkg...] [-D]   uninstall <pkg...>   run <script>   start   test   init -y   exec|npx <bin>   ls
`), 0;
    }
    return ctx.stderr.write(`${RED}npm error${RESET4} Unknown command: "${sub}"
`), 1;
  } catch (e) {
    return ctx.stderr.write(`${RED}npm error${RESET4} ${errorMessage(e)}
`), 1;
  }
}, npx = async (ctx) => {
  let c = ctx.container, args = ctx.args.filter((a) => a !== "-y" && a !== "--yes"), p = args.findIndex((a) => a === "-p" || a === "--package"), pkgSpec;
  p >= 0 && (pkgSpec = args[p + 1], args.splice(p, 2));
  let [spec, ...rest] = args;
  if (!spec)
    return ctx.stderr.write(`npx: missing command
`), 1;
  let { name } = splitPkgSpec(spec), bin = name.startsWith("@") ? name.split("/")[1] : name;
  if (c.which(bin, ctx.cwd, { ...ctx.env, PATH: `${join(ctx.cwd, "node_modules/.bin")}:${ctx.env.PATH ?? ""}` }) && !pkgSpec) return c.exec(bin, { ...ctx, args: rest, env: { ...ctx.env, PATH: `${join(ctx.cwd, "node_modules/.bin")}:${ctx.env.PATH ?? ""}` } });
  let prefix2 = `/tmp/npx/${(pkgSpec ?? spec).replace(/[^\w.-]/g, "_")}`;
  c.vfs.isDir(join(prefix2, "node_modules")) || (c.vfs.mkdir(prefix2, { recursive: !0 }), writePkg(c.vfs, prefix2, { name: "npx-tmp", version: "0.0.0", private: !0 }), ctx.stdout.write(`${DIM2}npx: installing ${pkgSpec ?? spec}\u2026${RESET4}
`), await install(c.vfs, c.registry, { cwd: prefix2, add: [pkgSpec ?? spec], out: { write: () => {
  } }, signal: ctx.signal }));
  let pkgName = splitPkgSpec(pkgSpec ?? spec).name, meta = readPkg(c.vfs, join(prefix2, "node_modules", pkgName)), bins = binEntries(pkgName, meta?.bin), chosen = bins.find(([b]) => b === bin) ?? bins[0];
  return chosen ? c.exec("node", { ...ctx, args: [join(prefix2, "node_modules", pkgName, chosen[1]), ...rest] }) : (ctx.stderr.write(`npx: ${pkgName} has no executable
`), 1);
}, vite = async (ctx) => {
  let c = ctx.container, args = [...ctx.args], mode = "dev";
  ["dev", "serve", "build", "preview", "optimize"].includes(args[0]) && (mode = args.shift());
  let { flags: flags2, rest } = parseFlags(args), root = rest[0] ? resolve(ctx.cwd, rest[0]) : ctx.cwd, portFlag = flags2.get("port"), portArg = typeof portFlag == "string" ? portFlag : args[args.indexOf("--port") + 1], port = portArg && /^\d+$/.test(portArg) ? Number(portArg) : void 0;
  try {
    if (mode === "build") {
      let t0 = Date.now(), outDir = typeof flags2.get("outDir") == "string" ? flags2.get("outDir") : "dist";
      ctx.stdout.write(`${CYAN2}vite (clover)${RESET4} ${GREEN}building for production...${RESET4}
`);
      let { files } = await c.build({ root, outDir });
      for (let f of files) {
        let size = c.vfs.stat(f).size;
        ctx.stdout.write(`${DIM2}${f.slice(root.length + 1).padEnd(48)}${RESET4} ${(size / 1024).toFixed(2).padStart(8)} kB
`);
      }
      return ctx.stdout.write(`${GREEN}\u2713 built in ${Date.now() - t0}ms${RESET4}
`), 0;
    }
    if (mode === "preview") {
      let outDir = typeof flags2.get("outDir") == "string" ? flags2.get("outDir") : "dist";
      return serveStatic(ctx, join(root, outDir), port ?? 4173, !0);
    }
    if (mode === "optimize") return 0;
    let server = await c.createDevServer({ root, port });
    return ctx.stdout.write(`
  ${CYAN2}${BOLD}VITE${RESET4} ${CYAN2}(clover)${RESET4}  ready

  ${GREEN}\u279C${RESET4}  ${BOLD}Local${RESET4}:   ${CYAN2}${server.url}${RESET4}

`), await aborted(ctx.signal), server.close(), 0;
  } catch (e) {
    return ctx.stderr.write(`${RED}error${RESET4} ${errorMessage(e)}
`), 1;
  }
};
async function serveStatic(ctx, dir, port, spa) {
  let c = ctx.container;
  if (!c.vfs.isDir(dir))
    return ctx.stderr.write(`serve: ${dir} does not exist${dir.endsWith("dist") ? " (run the build first)" : ""}
`), 1;
  let handle = c.servePort(port, (req) => staticHandler(c, dir, spa)(req));
  return ctx.stdout.write(`
  ${GREEN}Serving${RESET4} ${dir}
  ${GREEN}\u279C${RESET4}  ${BOLD}Local${RESET4}:   ${CYAN2}${handle.url}${RESET4}

`), await aborted(ctx.signal), handle.close(), 0;
}
function staticHandler(c, dir, spa = !0) {
  return (req) => {
    let u = new URL(req.url), p = join(dir, decodeURIComponent(u.pathname));
    if (c.vfs.isDir(p) && (p = join(p, "index.html")), !c.vfs.isFile(p) && c.vfs.isFile(p + ".html") && (p += ".html"), !c.vfs.isFile(p))
      if (spa && c.vfs.isFile(join(dir, "index.html")) && !/\.\w+$/.test(u.pathname)) p = join(dir, "index.html");
      else return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    let immutable = /\/assets\/.+-[\w-]{8,}\.\w+$/.test(p);
    return new Response(c.vfs.readFile(p), { headers: { "content-type": mimeType(p), "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" } });
  };
}
var serve = async (ctx) => {
  let { flags: flags2, rest } = parseFlags(ctx.args), pf = ctx.args[ctx.args.indexOf("-p") + 1] ?? ctx.args[ctx.args.indexOf("-l") + 1] ?? ctx.args[ctx.args.indexOf("--port") + 1], port = pf && /^\d+$/.test(pf) ? Number(pf) : 3e3, dir = rest.filter((r) => r !== String(port))[0];
  return serveStatic(ctx, resolve(ctx.cwd, dir ?? "."), port, flags2.has("s") || flags2.has("single") || !0);
}, tsc = async (ctx) => ctx.args.includes("-v") || ctx.args.includes("--version") ? (ctx.stdout.write(`Version 5.9.3 (clover stub)
`), 0) : (ctx.stdout.write(`${DIM2}tsc: type-checking is skipped in clover (esbuild strips types at build time)${RESET4}
`), 0), jsh = async (ctx) => {
  let c = ctx.container, sh = new Shell(c, ctx.cwd, ctx.env), ci = ctx.args.indexOf("-c");
  if (ci >= 0) return sh.run(ctx.args[ci + 1] ?? "", { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal, isTTY: ctx.isTTY });
  if (ctx.args[0] && !ctx.args[0].startsWith("-")) {
    let script = c.vfs.readText(resolve(ctx.cwd, ctx.args[0])), code = 0;
    for (let line of script.split(`
`))
      if (!(!line.trim() || line.startsWith("#")) && (code = await sh.run(line, { stdout: ctx.stdout, stderr: ctx.stderr, stdin: ctx.stdin, signal: ctx.signal }), sh.state.exitRequested !== void 0))
        return sh.state.exitRequested;
    return code;
  }
  let stdin = ctx.stdin instanceof Channel ? ctx.stdin : toChannel(ctx.stdin), out = ctx.isTTY === !1 ? ctx.stdout : crlf(ctx.stdout);
  return interactive(c, sh, { stdout: out, stdin, signal: ctx.signal });
};
function toChannel(it) {
  let ch = new Channel();
  return (async () => {
    for await (let s of it) ch.push(s);
    ch.close();
  })(), ch;
}
var COMMANDS = {
  npm,
  npx,
  node: nodeCommand,
  vite,
  serve,
  "http-server": serve,
  tsc,
  jsh,
  sh: jsh,
  bash: jsh
};

// src/npm/registry.ts
var packuments = /* @__PURE__ */ new Map(), tarballs = /* @__PURE__ */ new Map(), CACHE_NAME = "clover-npm-tarballs-v1", HttpRegistry = class {
  constructor(base = "https://registry.npmjs.org") {
    this.base = base;
    this.base = base.replace(/\/+$/, "");
  }
  base;
  packument(name) {
    let key = `${this.base}|${name}`, hit = packuments.get(key);
    if (hit && Date.now() - hit.at < 3e5) return hit.p;
    let p = (async () => {
      let url = `${this.base}/${name.startsWith("@") ? "@" + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`, res = await fetchRetry(url, { headers: { accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" } });
      if (res.status === 404) throw new Error(`404 Not Found - ${name} is not in the npm registry`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${name}`);
      return await res.json();
    })();
    return packuments.set(key, { at: Date.now(), p }), p.catch(() => packuments.delete(key)), p;
  }
  tarball(url, integrity) {
    let p = tarballs.get(url);
    return p || (p = (async () => {
      let cache = await openCache(), res = cache ? await cache.match(url).catch(() => {
      }) : void 0, fromCache = !!res;
      if (res || (res = await fetchRetry(url)), !res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
      let buf = new Uint8Array(await res.clone().arrayBuffer());
      return integrity && await verify(buf, integrity, url), cache && !fromCache && cache.put(url, new Response(buf)).catch(() => {
      }), buf;
    })(), tarballs.set(url, p), p.catch(() => tarballs.delete(url))), p;
  }
}, cachePromise = null;
function openCache() {
  return cachePromise || (cachePromise = typeof caches < "u" ? caches.open(CACHE_NAME).catch(() => null) : Promise.resolve(null)), cachePromise;
}
async function fetchRetry(url, init2, tries = 3) {
  for (let i = 0; ; i++)
    try {
      let res = await fetch(url, init2);
      if (res.status >= 500 && i < tries - 1) throw new Error(String(res.status));
      return res;
    } catch (e) {
      if (i >= tries - 1) throw new Error(`network error fetching ${url}: ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 300 * 2 ** i));
    }
}
async function verify(buf, integrity, url) {
  let [algo, b64] = integrity.split(" ")[0].split("-"), name = { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[algo];
  if (!name || !b64 || !globalThis.crypto?.subtle) return;
  let digest = new Uint8Array(await crypto.subtle.digest(name, buf)), s = "";
  for (let b of digest) s += String.fromCharCode(b);
  if (btoa(s) !== b64) throw new Error(`integrity check failed for ${url}`);
}

// src/container.ts
init_resolve();
init_esbuild();

// src/dev/server.ts
init_esbuild();
init_path();
init_resolve();

// src/dev/client.ts
function clientCode(channel) {
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
`;
}
function styleModule(css, id, exportsCode = "") {
  return `const id = ${JSON.stringify(id)};
let el = document.querySelector('style[data-clover-id="' + id + '"]');
if (!el) { el = document.createElement('style'); el.setAttribute('data-clover-id', id); document.head.appendChild(el); }
el.textContent = ${JSON.stringify(css)};
${exportsCode || "export default " + JSON.stringify(css) + ";"}
`;
}
function errorModule(message) {
  return `import { showOverlay } from '/@clover/client';
const msg = ${JSON.stringify(message)};
showOverlay(msg);
throw new Error(msg);
`;
}

// src/dev/deps.ts
var import_cjs_lexer_js = __toESM(require_lexer(), 1);
init_esbuild();
init_resolve();
init_path();
var RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval".split(" ")
), IDENT = /^[A-Za-z_$][\w$]*$/, DepOptimizer = class {
  constructor(vfs, fs, root, opts) {
    this.vfs = vfs;
    this.fs = fs;
    this.root = root;
    this.opts = opts;
  }
  vfs;
  fs;
  root;
  opts;
  specs = /* @__PURE__ */ new Set();
  current = null;
  builtFor = /* @__PURE__ */ new Set();
  buildId = 0;
  timer = null;
  pendingResolve = [];
  /** Called when already-served modules became stale (page must reload). */
  onStale;
  lastServed = 0;
  has(spec) {
    return this.specs.has(spec);
  }
  /** Add specs (e.g. from the initial scan) without serving. */
  add(specs) {
    let changed = !1;
    for (let s of specs) this.specs.has(s) || (this.specs.add(s), changed = !0);
    changed && this.schedule();
  }
  invalidate() {
    this.current = null, this.builtFor.clear(), this.lastServed = 0;
  }
  async get(spec) {
    this.specs.has(spec) || (this.specs.add(spec), this.schedule());
    let r = await this.result();
    this.markServed(r.id);
    let code = r.entries.get(spec);
    return code !== void 0 ? { code } : { error: r.errors.get(spec) ?? `failed to pre-bundle ${spec}` };
  }
  async chunk(name) {
    let r = await this.result();
    return this.markServed(r.id), r.chunks.get(name);
  }
  markServed(id) {
    this.lastServed && this.lastServed !== id && this.onStale?.(), this.lastServed = id;
  }
  result() {
    let missing = [...this.specs].some((s) => !this.builtFor.has(s));
    return this.current && !missing && !this.timer ? this.current : new Promise((resolve2) => {
      this.pendingResolve.push((p) => resolve2(p)), this.schedule();
    });
  }
  schedule() {
    this.timer || (this.timer = setTimeout(() => {
      this.timer = null;
      let specs = [...this.specs], p = this.build(specs);
      this.current = p;
      for (let s of specs) this.builtFor.add(s);
      for (let r of this.pendingResolve.splice(0)) r(p);
    }, 25));
  }
  async build(specs) {
    let id = ++this.buildId, errors = /* @__PURE__ */ new Map(), ropts = { ...BROWSER_OPTS, conditions: this.opts.conditions ?? BROWSER_OPTS.conditions }, entryPoints = [], virtual = /* @__PURE__ */ new Map();
    for (let spec of specs) {
      if (spec.endsWith(".css")) continue;
      let file;
      try {
        file = resolveModule(this.fs, spec, this.root, ropts);
      } catch {
        errors.set(spec, `Failed to resolve import "${spec}". Is it installed? (npm install ${spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/")})`);
        continue;
      }
      if (file === !1) {
        virtual.set(spec, "export default {}"), entryPoints.push({ in: `clover-dep:${spec}`, out: spec });
        continue;
      }
      let code = this.vfs.readText(file);
      if (isEsmFile(this.fs, file, code)) entryPoints.push({ in: file, out: spec });
      else {
        let named = [...await this.cjsExports(file, ropts)].filter((n) => IDENT.test(n) && !RESERVED.has(n) && n !== "__esModule");
        virtual.set(
          spec,
          `import * as __m from ${JSON.stringify(file)};
export default (__m.default ?? __m);
` + (named.length ? `export const { ${named.join(", ")} } = __m;
` : "")
        ), entryPoints.push({ in: `clover-dep:${spec}`, out: spec });
      }
    }
    let result = { id, entries: /* @__PURE__ */ new Map(), chunks: /* @__PURE__ */ new Map(), errors };
    if (!entryPoints.length) return result;
    let depPlugin = {
      name: "clover-deps",
      setup(build2) {
        build2.onResolve({ filter: /^clover-dep:/ }, (a) => ({ path: a.path.slice(11), namespace: "clover-dep" })), build2.onLoad({ filter: /.*/, namespace: "clover-dep" }, (a) => ({ contents: virtual.get(a.path) ?? "", loader: "js", resolveDir: "/" })), build2.onLoad({ filter: /\.css$/, namespace: "clover-vfs" }, async (a) => {
          let css = await (await loadEsbuild()).transform(new TextDecoder().decode(vfsRead(a.path)), { loader: "css", minify: !1 });
          return {
            contents: `const s=document.createElement('style');s.setAttribute('data-clover-dep',${JSON.stringify(a.path)});s.textContent=${JSON.stringify(css.code)};document.head.appendChild(s);`,
            loader: "js"
          };
        });
      }
    }, vfsRead = (p) => this.vfs.readFile(p), vopts = { resolve: ropts };
    try {
      let out = await bundleVfs(this.vfs, {
        cwd: this.root,
        wasmURL: this.opts.wasmURL,
        entryPoints,
        outdir: "/@modules",
        splitting: !0,
        format: "esm",
        target: "es2022",
        chunkNames: "chunk-[hash]",
        define: { "process.env.NODE_ENV": JSON.stringify(this.opts.define["process.env.NODE_ENV"] ? JSON.parse(this.opts.define["process.env.NODE_ENV"]) : "development"), global: "globalThis", ...this.opts.define },
        loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
        metafile: !0,
        plugins: [depPlugin],
        vfsPlugin: vopts,
        logLevel: "silent"
      }), byOut = new Map(entryPoints.map((e) => [`/@modules/${e.out}.js`, e.out]));
      for (let f of out.outputFiles) {
        let spec = byOut.get(f.path);
        spec !== void 0 ? result.entries.set(spec, f.text) : f.path.endsWith(".js") && result.chunks.set(f.path.slice(f.path.lastIndexOf("/") + 1), f.text);
      }
    } catch (e) {
      let { formatErrors: formatErrors2 } = await Promise.resolve().then(() => (init_esbuild(), esbuild_exports)), msg = `Pre-bundling dependencies failed:
${formatErrors2(e)}`;
      for (let ep of entryPoints) errors.set(ep.out, msg);
    }
    return result;
  }
  /** Named exports of a CJS module, following `module.exports = require(...)` re-exports. */
  async cjsExports(file, ropts, depth = 0, seen = /* @__PURE__ */ new Set()) {
    let names = /* @__PURE__ */ new Set();
    if (depth > 8 || seen.has(file)) return names;
    seen.add(file);
    let code = this.vfs.readText(file);
    try {
      code = (await (await loadEsbuild(this.opts.wasmURL)).transform(code, { define: { "process.env.NODE_ENV": '"development"' }, minifySyntax: !0, loader: "js", logLevel: "silent" })).code;
    } catch {
    }
    let lexed;
    try {
      lexed = (0, import_cjs_lexer_js.parse)(code);
    } catch {
      return names;
    }
    for (let n of lexed.exports) names.add(n);
    for (let r of lexed.reexports)
      try {
        let f = resolveModule(this.fs, r, dirname(file), ropts);
        if (f) for (let n of await this.cjsExports(f, ropts, depth + 1, seen)) names.add(n);
      } catch {
      }
    return names;
  }
};
async function scanImports(vfs, root, entries, opts) {
  let found = /* @__PURE__ */ new Set(), plugin = {
    name: "clover-scan",
    setup(build2) {
      build2.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return { path: a.path, namespace: "scan" };
        if (/^(https?:|data:|\/\/|\/@)/.test(a.path)) return { path: a.path, external: !0 };
        let local = opts.resolveLocal(a.path, a.importer);
        return local === null ? (/\.(css|scss|sass|less)$/.test(a.path) || found.add(a.path.split("?")[0]), { path: a.path, external: !0 }) : /\.(m?[jt]sx?|cjs|cts|mts)$/.test(local) ? { path: local, namespace: "scan" } : { path: local, external: !0 };
      }), build2.onLoad({ filter: /.*/, namespace: "scan" }, (a) => {
        let ext = a.path.slice(a.path.lastIndexOf("."));
        return {
          contents: vfs.tryReadText(a.path) ?? "",
          loader: ext === ".tsx" ? "tsx" : ext === ".ts" || ext === ".mts" || ext === ".cts" ? "ts" : "jsx",
          resolveDir: dirname(a.path)
        };
      });
    }
  };
  try {
    await (await loadEsbuild(opts.wasmURL)).build({
      entryPoints: entries.filter((e) => vfs.isFile(e)),
      bundle: !0,
      write: !1,
      format: "esm",
      outdir: "/__scan__",
      jsx: "automatic",
      ...opts.jsx,
      plugins: [plugin],
      logLevel: "silent",
      absWorkingDir: root
    });
  } catch {
  }
  return found;
}

// src/build/html.ts
var TAG_RE = /<(script|link|img|source|video|audio)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
function parseAttrs(s) {
  let out = {}, re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, m;
  for (; m = re.exec(s); ) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}
function findTags(html) {
  let tags = [], masked = html.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length)), m;
  for (TAG_RE.lastIndex = 0; m = TAG_RE.exec(masked); )
    tags.push({ name: m[1].toLowerCase(), start: m.index, end: m.index + m[0].length, raw: html.slice(m.index, m.index + m[0].length), attrs: parseAttrs(m[2]) });
  return tags;
}
var isLocalRef = (u) => !!u && !/^(https?:|data:|blob:|mailto:|#|\/\/)/i.test(u) && !u.startsWith("%");
function findModuleScripts(html) {
  return findTags(html).filter((t) => t.name === "script" && t.attrs.type === "module" && isLocalRef(t.attrs.src ?? "")).map((t) => t.attrs.src);
}
function setAttr(raw, name, value) {
  let re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, "i");
  return re.test(raw) ? raw.replace(re, `$1"${value}"`) : raw.replace(/\s*\/?>$/, (end) => ` ${name}="${value}"${end}`);
}
function applyEdits(html, edits) {
  let out = html;
  for (let e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
function injectHead(html, markup) {
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${markup}
  </head>`) : markup + html;
}
function rewriteHtmlForBuild(html, r) {
  let edits = [];
  for (let t of findTags(html))
    if (t.name === "script" && t.attrs.src && r.scripts[t.attrs.src]) {
      let raw = setAttr(t.raw, "src", r.scripts[t.attrs.src]);
      /\scrossorigin\b/i.test(raw) || (raw = raw.replace(/<script/i, "<script crossorigin")), edits.push({ start: t.start, end: t.end, text: raw });
    } else t.name === "link" && t.attrs.href && (r.styles[t.attrs.href] || r.assets[t.attrs.href]) ? edits.push({ start: t.start, end: t.end, text: setAttr(t.raw, "href", r.styles[t.attrs.href] ?? r.assets[t.attrs.href]) }) : (t.name === "img" || t.name === "source" || t.name === "video" || t.name === "audio") && t.attrs.src && r.assets[t.attrs.src] && edits.push({ start: t.start, end: t.end, text: setAttr(t.raw, "src", r.assets[t.attrs.src]) });
  let out = applyEdits(html, edits), head = [
    ...(r.preload ?? []).map((p) => `<link rel="modulepreload" crossorigin href="${p}">`),
    ...r.extraCss.map((c) => `<link rel="stylesheet" crossorigin href="${c}">`)
  ];
  return head.length && (out = injectHead(out, head.map((h) => "  " + h).join(`
`))), out;
}
function contentHash(data) {
  let h1 = 2166136261, h2 = 16777619;
  for (let i = 0; i < data.length; i++)
    h1 = Math.imul(h1 ^ data[i], 16777619), h2 = Math.imul(h2 ^ data[i], 1540483477);
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 8);
}

// src/dev/server.ts
var NO_CACHE = { "cache-control": "no-cache, no-store" }, JS = { "content-type": "text/javascript; charset=utf-8", ...NO_CACHE };
async function createDevServer(c, o = {}) {
  let root = normalize(o.root ? o.root.startsWith("/") ? o.root : join(c.workdir, o.root) : c.workdir), port = o.port ?? c.ports.free(5173), channelName = `clover:${c.instanceId}:${port}`, bc = new BroadcastChannel(channelName), vfs = c.vfs, fs = c.resolveFs, cfg = readProjectConfig(vfs, root), env = loadEnv(vfs, root, "development"), defines = { ...envDefines(env), "process.env.NODE_ENV": '"development"' }, deps = new DepOptimizer(vfs, fs, root, { wasmURL: c.esbuildWasmUrl, define: { "process.env.NODE_ENV": '"development"' } });
  deps.onStale = () => scheduleReload("dependencies re-optimized");
  let transformCache = /* @__PURE__ */ new Map(), reloadTimer = null, depsTimer = null, scheduleReload = (_why) => {
    reloadTimer && clearTimeout(reloadTimer), reloadTimer = setTimeout(() => {
      reloadTimer = null, bc.postMessage({ type: "reload" });
    }, 60);
  }, watcher = vfs.watch(root, { recursive: !0 }, (_ev, file) => {
    if (file.startsWith("node_modules/") || file === "node_modules") {
      depsTimer && clearTimeout(depsTimer), depsTimer = setTimeout(() => {
        depsTimer = null, deps.invalidate(), transformCache.clear(), scheduleReload("node_modules changed");
      }, 400);
      return;
    }
    /^(\.git|dist)\//.test(file) || (/^(tsconfig.*\.json|jsconfig\.json|package\.json)$/.test(file) && (cfg = readProjectConfig(vfs, root)), /^\.env/.test(file) && (env = loadEnv(vfs, root, "development"), defines = { ...envDefines(env), "process.env.NODE_ENV": '"development"' }, transformCache.clear()), scheduleReload(file));
  }), toUrl = (abs2) => abs2.startsWith(root + "/") ? abs2.slice(root.length) : `/@fs${abs2}`, fromUrl = (p) => p.startsWith("/@fs/") ? p.slice(4) : join(root, p), resolveLocal = (spec, importer) => {
    let [clean] = splitQuery(spec), aliased = matchPaths(cfg, clean);
    if (aliased)
      for (let cand of aliased)
        try {
          let r2 = resolveModule(fs, cand, "/", BROWSER_OPTS);
          if (r2) return r2;
        } catch {
        }
    if (isBare(clean)) return null;
    let fromDir = importer ? dirname(importer) : root;
    return resolveModule(fs, clean.startsWith("/") && !clean.startsWith(root + "/") ? join(root, clean) : clean, fromDir, BROWSER_OPTS) || null;
  }, flagFor = (abs2, query) => /[?&](url|raw|inline)\b/.test(query) || SCRIPT_EXT.test(abs2) ? query : query ? `${query}&import` : "?import", rewrite = (spec, importer) => {
    if (/^(https?:|data:|blob:|\/\/|\/@)/.test(spec)) return spec;
    let [clean, query] = splitQuery(spec), local = resolveLocal(spec, importer);
    return local ? toUrl(local) + flagFor(local, query) : isNodeBuiltin(clean) ? "/@clover/empty" : /\.(css)$/.test(clean) ? `/@modules/${clean}${query ? query + "&import" : "?import"}` : `/@modules/${clean}${query}`;
  }, importsPlugin = (importer) => ({
    name: "clover-dev-imports",
    setup(build2) {
      build2.onResolve({ filter: /.*/ }, (a) => {
        if (a.kind === "entry-point") return { path: a.path, namespace: "clover-entry" };
        try {
          let url2 = rewrite(a.path, a.importer && a.importer !== "<stdin>" ? a.importer : importer);
          if (url2.startsWith("/@modules/")) {
            let s = splitQuery(url2.slice(10))[0];
            s.endsWith(".css") || deps.add([s]);
          }
          return { path: url2, external: !0 };
        } catch (e) {
          return { errors: [{ text: e instanceof Error ? e.message : String(e) }] };
        }
      }), build2.onLoad({ filter: /.*/, namespace: "clover-entry" }, (a) => ({ contents: vfs.readText(a.path), loader: loaderOf(a.path), resolveDir: dirname(a.path) }));
    }
  }), loaderOf = (p) => {
    let e = extname(p);
    return e === ".tsx" ? "tsx" : e === ".ts" || e === ".mts" || e === ".cts" ? "ts" : "jsx";
  }, transformScript = async (abs2) => {
    let st = vfs.stat(abs2), hit = transformCache.get(abs2);
    if (hit && hit.mtime === st.mtimeMs) return hit.code;
    let code = (await (await loadEsbuild(c.esbuildWasmUrl)).build({
      entryPoints: [abs2],
      bundle: !0,
      write: !1,
      format: "esm",
      target: "es2022",
      outdir: "/__dev__",
      sourcemap: "inline",
      sourcesContent: !0,
      ...jsxOptions(cfg),
      tsconfigRaw: cfg.tsconfigRaw,
      define: defines,
      plugins: [importsPlugin(abs2)],
      logLevel: "silent",
      absWorkingDir: root
    })).outputFiles[0].text;
    return transformCache.set(abs2, { mtime: st.mtimeMs, code }), code;
  }, transformInline = async (code, htmlPath) => (await (await loadEsbuild(c.esbuildWasmUrl)).build({
    stdin: { contents: code, resolveDir: dirname(htmlPath), loader: "tsx", sourcefile: htmlPath },
    bundle: !0,
    write: !1,
    format: "esm",
    target: "es2022",
    ...jsxOptions(cfg),
    define: defines,
    plugins: [importsPlugin(htmlPath)],
    logLevel: "silent"
  })).outputFiles[0].text, cssModule = async (abs2, asModule) => {
    let es = await loadEsbuild(c.esbuildWasmUrl), urlPlugin = {
      name: "clover-css-urls",
      setup(build2) {
        build2.onResolve({ filter: /.*/ }, (a) => {
          if (a.kind === "entry-point") return { path: a.path, namespace: "clover-entry" };
          if (/^(https?:|data:|\/\/|#)/.test(a.path)) return { path: a.path, external: !0 };
          let importer = a.importer || abs2;
          if (a.kind === "url-token" || a.kind === "import-rule") {
            let [clean] = splitQuery(a.path), target = null;
            try {
              target = isBare(clean) && !matchPaths(cfg, clean) ? resolveModule(fs, clean, dirname(importer), { ...BROWSER_OPTS, conditions: ["style", ...BROWSER_OPTS.conditions] }) : resolveLocal(clean, importer);
            } catch {
              target = null;
            }
            if (!target) {
              let pub = join(root, "public", clean);
              return clean.startsWith("/") && vfs.isFile(pub) ? { path: clean, external: !0 } : { path: a.path, external: !0 };
            }
            return a.kind === "import-rule" ? { path: target, namespace: "clover-entry" } : { path: toUrl(target), external: !0 };
          }
          if (a.kind === "composes-from") {
            let t = resolveLocal(a.path, importer);
            return t ? { path: t, namespace: "clover-entry" } : { path: a.path, external: !0 };
          }
          return { path: a.path, external: !0 };
        }), build2.onLoad({ filter: /.*/, namespace: "clover-entry" }, (a) => ({
          contents: vfs.readText(a.path),
          loader: /\.module\.css$/.test(a.path) ? "local-css" : "css",
          resolveDir: dirname(a.path)
        }));
      }
    };
    if (/\.module\.css$/.test(abs2)) {
      let r2 = await es.build({
        stdin: { contents: `export { default } from ${JSON.stringify(abs2)}`, resolveDir: root, loader: "js" },
        bundle: !0,
        write: !1,
        format: "esm",
        outdir: "/__dev__",
        plugins: [urlPlugin],
        logLevel: "silent"
      }), js = r2.outputFiles.find((f) => f.path.endsWith(".js")).text, css2 = r2.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
      return styleModule(css2, toUrl(abs2), js);
    }
    let css = (await es.build({ entryPoints: [abs2], bundle: !0, write: !1, outdir: "/__dev__", plugins: [urlPlugin], logLevel: "silent" })).outputFiles[0]?.text ?? "";
    return asModule ? styleModule(css, toUrl(abs2)) : css;
  }, transformHtml = async (abs2) => {
    let html = vfs.readText(abs2);
    html = html.replace(/%(\w+)%/g, (m, k) => k in env ? String(env[k]) : m);
    let inline = /<script\b([^>]*\btype\s*=\s*["']?module["']?[^>]*)>([\s\S]*?)<\/script>/gi, parts = [];
    html.replace(inline, (m, attrs, body) => (parts.push(/\bsrc\s*=/.test(attrs) || !body.trim() ? Promise.resolve(m) : transformInline(body, abs2).then((js) => `<script type="module">${js}<\/script>`, (e) => `<script type="module">${errorModule(formatErrors(e))}<\/script>`)), m));
    let done = await Promise.all(parts), i = 0;
    html = html.replace(inline, () => done[i++]);
    let tag = '<script type="module" src="/@clover/client"><\/script>';
    return /<head[^>]*>/i.test(html) ? html = html.replace(/<head[^>]*>/i, (h) => `${h}
    ${tag}`) : html = tag + html, html;
  }, indexHtml = join(root, "index.html");
  if (vfs.isFile(indexHtml)) {
    let entries = findModuleScripts(vfs.readText(indexHtml)).map((s) => s.startsWith("/") ? join(root, s) : join(root, s)).filter((p) => vfs.isFile(p));
    scanImports(vfs, root, entries, { wasmURL: c.esbuildWasmUrl, jsx: jsxOptions(cfg), resolveLocal: (s, imp) => {
      try {
        return resolveLocal(s, imp || root + "/index.html");
      } catch {
        return "";
      }
    } }).then((found) => deps.add([...found].filter((s) => isBare(s) && !isNodeBuiltin(s) && !/^(https?:|data:)/.test(s))));
  }
  let handler = async (req) => {
    if (o.middleware) {
      let r = await o.middleware(req);
      if (r) return r;
    }
    let u = new URL(req.url), pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch {
      pathname = u.pathname;
    }
    let has = (k) => u.searchParams.has(k);
    try {
      if (pathname === "/@clover/client") return new Response(clientCode(channelName), { headers: JS });
      if (pathname === "/@clover/empty") return new Response("export default {}", { headers: JS });
      if (pathname.startsWith("/@modules/")) {
        let spec = pathname.slice(10);
        if (/^chunk-[\w-]+\.js$/.test(spec.split("/").pop()) && !deps.has(spec)) {
          let text = await deps.chunk(spec.split("/").pop());
          if (text !== void 0) return new Response(text, { headers: JS });
        }
        if (spec.endsWith(".css")) {
          let file = resolveModule(fs, spec, root, { ...BROWSER_OPTS, conditions: ["style", ...BROWSER_OPTS.conditions] });
          return file ? new Response(has("import") ? await cssModule(file, !0) : await cssModule(file, !1), { headers: has("import") ? JS : { "content-type": "text/css", ...NO_CACHE } }) : new Response("", { headers: JS });
        }
        let r = await deps.get(spec);
        return new Response("code" in r ? r.code : errorModule(r.error), { headers: JS });
      }
      let abs2 = fromUrl(pathname), pub = join(root, "public", pathname);
      if (!pathname.startsWith("/@fs/") && !has("import") && vfs.isFile(pub)) return fileResponse(pub);
      if (vfs.isDir(abs2) && (abs2 = join(abs2, "index.html")), !vfs.isFile(abs2))
        if (((req.headers.get("accept") ?? "").includes("text/html") || !extname(pathname)) && req.method === "GET" && vfs.isFile(indexHtml) && !SCRIPT_EXT.test(pathname)) abs2 = indexHtml;
        else return SCRIPT_EXT.test(pathname) || has("import") ? new Response(errorModule(`Failed to load ${pathname}: file not found`), { status: 404, headers: JS }) : new Response(`Not found: ${pathname}`, { status: 404, headers: { "content-type": "text/plain" } });
      let ext = extname(abs2);
      if (ext === ".html" || ext === ".htm") return new Response(await transformHtml(abs2), { headers: { "content-type": "text/html; charset=utf-8", ...NO_CACHE } });
      if (has("url")) return new Response(`export default ${JSON.stringify(pathname)}`, { headers: JS });
      if (has("raw")) return new Response(`export default ${JSON.stringify(vfs.readText(abs2))}`, { headers: JS });
      if (ext === ".css") return new Response(await cssModule(abs2, has("import")), { headers: has("import") ? JS : { "content-type": "text/css; charset=utf-8", ...NO_CACHE } });
      if (has("import")) {
        if (ext === ".json") return new Response(`export default ${vfs.readText(abs2)}`, { headers: JS });
        if (ASSET_EXT.test(abs2) || !SCRIPT_EXT.test(abs2)) return new Response(`export default ${JSON.stringify(pathname)}`, { headers: JS });
      }
      if (SCRIPT_EXT.test(abs2))
        try {
          return new Response(await transformScript(abs2), { headers: JS });
        } catch (e) {
          return new Response(errorModule(formatErrors(e)), { headers: JS });
        }
      return fileResponse(abs2);
    } catch (e) {
      let msg = formatErrors(e);
      return SCRIPT_EXT.test(pathname) || has("import") || pathname.startsWith("/@modules/") ? new Response(errorModule(msg), { headers: JS }) : new Response(msg, { status: 500, headers: { "content-type": "text/plain" } });
    }
  }, fileResponse = (abs2) => new Response(vfs.readFile(abs2), { headers: { "content-type": mimeType(abs2), ...NO_CACHE } });
  return {
    url: c.ports.open(port, handler, "dev-server"),
    port,
    close() {
      watcher.close(), bc.close(), c.ports.close(port);
    }
  };
}

// src/build/build.ts
init_esbuild();
init_path();
init_resolve();
var PROD_RESOLVE = { ...BROWSER_OPTS, conditions: ["browser", "import", "module", "production", "default"] };
function pathsPlugin(c, cfg) {
  return {
    name: "clover-tsconfig-paths",
    setup(build2) {
      cfg.paths.length && build2.onResolve({ filter: /.*/ }, (a) => {
        let cands = matchPaths(cfg, a.path);
        if (cands)
          for (let cand of cands)
            try {
              let r = resolveModule(c.resolveFs, cand, "/", PROD_RESOLVE);
              if (r) return { path: r, namespace: "clover-vfs" };
            } catch {
            }
      });
    }
  };
}
async function build(c, o = {}) {
  let vfs = c.vfs, root = normalize(o.root ? o.root.startsWith("/") ? o.root : join(c.workdir, o.root) : c.workdir), outDir = normalize(join(root, o.outDir ?? "dist")), htmlPath = join(root, "index.html");
  if (!vfs.isFile(htmlPath)) throw new Error(`build: ${htmlPath} not found`);
  let cfg = readProjectConfig(vfs, root), env = loadEnv(vfs, root, "production"), html = vfs.readText(htmlPath).replace(/%(\w+)%/g, (m, k) => k in env ? String(env[k]) : m), tags = findTags(html), localPath = (ref) => normalize(ref.startsWith("/") ? join(root, ref.split(/[?#]/)[0]) : join(root, ref.split(/[?#]/)[0])), scriptRefs = tags.filter((t) => t.name === "script" && t.attrs.type === "module" && isLocalRef(t.attrs.src ?? "")).map((t) => t.attrs.src), styleRefs = tags.filter((t) => t.name === "link" && /\bstylesheet\b/i.test(t.attrs.rel ?? "") && isLocalRef(t.attrs.href ?? "") && extname(t.attrs.href.split("?")[0]) === ".css").map((t) => t.attrs.href).filter((h) => vfs.isFile(localPath(h)) && !vfs.isFile(join(root, "public", h))), entryFor = /* @__PURE__ */ new Map();
  for (let r of [...scriptRefs, ...styleRefs]) entryFor.set(localPath(r), r);
  if (!scriptRefs.length && !styleRefs.length) throw new Error('build: index.html has no <script type="module" src> entries');
  let result;
  try {
    result = await bundleVfs(vfs, {
      cwd: root,
      wasmURL: c.esbuildWasmUrl,
      entryPoints: [...entryFor.keys()],
      outdir: outDir,
      splitting: !0,
      format: "esm",
      target: "es2020",
      minify: o.minify ?? !0,
      sourcemap: o.sourcemap ? "linked" : !1,
      entryNames: "assets/[name]-[hash]",
      chunkNames: "assets/[name]-[hash]",
      assetNames: "assets/[name]-[hash]",
      publicPath: "/",
      metafile: !0,
      ...jsxOptions(cfg),
      tsconfigRaw: cfg.tsconfigRaw,
      define: { ...envDefines(env), "process.env.NODE_ENV": '"production"', global: "globalThis" },
      loader: { ".module.css": "local-css" },
      plugins: [pathsPlugin(c, cfg)],
      vfsPlugin: { resolve: PROD_RESOLVE }
    });
  } catch (e) {
    throw new Error(`build failed:
${formatErrors(e)}`);
  }
  vfs.rm(outDir, { recursive: !0, force: !0 });
  let files = [];
  for (let f of result.outputFiles)
    vfs.writeFile(f.path, f.contents.slice(), { mkdirp: !0 }), files.push(f.path);
  let url = (abs2) => "/" + abs2.slice(outDir.length + 1), scripts = {}, styles = {}, extraCss = [];
  for (let [out, meta] of Object.entries(result.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    let absOut = out.startsWith("/") ? out : normalize(join(root, out)), entryAbs = meta.entryPoint.replace(/^clover-vfs:/, ""), ref = entryFor.get(normalize(entryAbs.startsWith("/") ? entryAbs : join(root, entryAbs)));
    ref && (absOut.endsWith(".css") ? styles[ref] = url(absOut) : (scripts[ref] = url(absOut), meta.cssBundle && extraCss.push(url(meta.cssBundle.startsWith("/") ? meta.cssBundle : normalize(join(root, meta.cssBundle))))));
  }
  let pub = join(root, "public");
  if (vfs.isDir(pub))
    for (let f of vfs.walk(pub)) {
      let dest = join(outDir, f.slice(pub.length + 1));
      vfs.writeFile(dest, vfs.readFile(f).slice(), { mkdirp: !0 }), files.push(dest);
    }
  let assets = {};
  for (let t of tags) {
    let ref = t.name === "link" ? t.attrs.href : t.name !== "script" ? t.attrs.src : void 0;
    if (!ref || !isLocalRef(ref) || styles[ref] || assets[ref] || vfs.isFile(join(pub, ref))) continue;
    let abs2 = localPath(ref);
    if (!vfs.isFile(abs2)) continue;
    let data = vfs.readFile(abs2), ext = extname(abs2), name = `assets/${basename(abs2, ext)}-${contentHash(data)}${ext}`;
    vfs.writeFile(join(outDir, name), data.slice(), { mkdirp: !0 }), files.push(join(outDir, name)), assets[ref] = "/" + name;
  }
  return html = rewriteHtmlForBuild(html, { scripts, styles, assets, extraCss }), vfs.writeFile(join(outDir, "index.html"), html, { mkdirp: !0 }), files.push(join(outDir, "index.html")), { files: [...new Set(files)].sort() };
}

// src/container.ts
init_path();
var randomId = () => Math.random().toString(36).slice(2, 10), Container = class _Container {
  instanceId = randomId();
  workdir;
  /** Synchronous in-memory file system (advanced use). */
  vfs = new VFS();
  ports;
  registry;
  esbuildWasmUrl;
  resolveFs;
  fs;
  listeners = /* @__PURE__ */ new Map();
  commands = /* @__PURE__ */ new Map();
  procs = /* @__PURE__ */ new Set();
  cleanups = [];
  torndown = !1;
  constructor(opts) {
    this.workdir = normalize(opts.workdir ?? "/home/project"), this.registry = new HttpRegistry(opts.registry ?? "https://registry.npmjs.org"), this.esbuildWasmUrl = opts.esbuildWasmUrl ?? DEFAULT_WASM_URL, this.ports = new PortTable(this.instanceId, {
      open: (port, url) => {
        this.emit("port", port, "open", url), this.emit("server-ready", port, url);
      },
      close: (port, url) => this.emit("port", port, "close", url)
    });
    let vfs = this.vfs;
    this.resolveFs = { isFile: (p) => vfs.isFile(p), isDir: (p) => vfs.isDir(p), readText: (p) => vfs.tryReadText(p) };
    for (let d of ["/tmp", "/home", "/usr/local/bin", this.workdir]) vfs.mkdir(d, { recursive: !0 });
    let w = vfs.watch("/", { recursive: !0 }, (_e, f) => {
      f.endsWith("package.json") && clearPackageCache(this.resolveFs);
    });
    this.cleanups.push(() => w.close()), this.fs = this.makeFs();
  }
  /** Boot a container. Registers the preview service worker (unless disabled). */
  static async boot(opts = {}) {
    let c = new _Container(opts);
    return opts.serviceWorkerUrl !== !1 && await c.connectServiceWorker(opts.serviceWorkerUrl ?? "/clover-sw.js"), c;
  }
  // ---------------- events ----------------
  on(event, fn) {
    let set = this.listeners.get(event);
    return set || this.listeners.set(event, set = /* @__PURE__ */ new Set()), set.add(fn), () => {
      set.delete(fn);
    };
  }
  emit(event, ...args) {
    for (let fn of this.listeners.get(event) ?? [])
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
  }
  // ---------------- fs ----------------
  /** Resolve a path against the workdir. */
  path(p) {
    return resolve(this.workdir, p);
  }
  makeFs() {
    let v = this.vfs, P = (p) => this.path(p);
    return {
      readFile: (async (p, enc3) => {
        let d = v.readFile(P(p));
        return enc3 ? new TextDecoder().decode(d) : d.slice();
      }),
      writeFile: async (p, data) => v.writeFile(P(p), typeof data == "string" ? data : data.slice(), { mkdirp: !0 }),
      readdir: (async (p, o) => o?.withFileTypes ? v.readdirEntries(P(p)) : v.readdir(P(p))),
      mkdir: async (p, o) => v.mkdir(P(p), o),
      rm: async (p, o) => v.rm(P(p), o),
      rename: async (a, b) => v.rename(P(a), P(b)),
      stat: async (p) => v.stat(P(p)),
      exists: async (p) => v.exists(P(p)),
      watch: (p, o, cb) => v.watch(P(p), o, cb)
    };
  }
  async mount(tree, opts = {}) {
    mountTree(this.vfs, tree, this.path(opts.mountPoint ?? "."));
  }
  async export(path2, opts = {}) {
    return exportTree(this.vfs, this.path(path2), (opts.excludes ?? []).map(globToRegExp));
  }
  // ---------------- processes ----------------
  registerCommand(name, fn) {
    return this.commands.set(name, fn), () => {
      this.commands.delete(name);
    };
  }
  defaultEnv() {
    return {
      HOME: "/home",
      USER: "clover",
      SHELL: "/bin/jsh",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_US.UTF-8",
      PWD: this.workdir
    };
  }
  async spawn(cmd, args = [], opts = {}) {
    let cwd = this.path(opts.cwd ?? "."), env = { ...this.defaultEnv(), PWD: cwd };
    for (let [k, v] of Object.entries(opts.env ?? {})) v === void 0 ? delete env[k] : env[k] = String(v);
    let interactiveShell = (cmd === "jsh" || cmd === "sh" || cmd === "bash") && !args.includes("-c") && !args.some((a) => !a.startsWith("-")), p = createProcess(
      ({ stdout, stderr, stdin, signal }) => this.exec(cmd, { args, cwd, env, stdout, stderr, stdin, signal, container: this, isTTY: interactiveShell || !!opts.terminal }),
      { terminal: opts.terminal && !interactiveShell }
    );
    return this.procs.add(p), p.exit.finally(() => this.procs.delete(p)), p;
  }
  /** Locate a command: registered, builtin, bundled or on PATH. */
  which(name, cwd, env) {
    if (name.includes("/")) {
      let p = resolve(cwd, name);
      return this.vfs.isFile(p) ? p : null;
    }
    if (this.commands.has(name)) return `/usr/local/bin/${name}`;
    if (name in builtins) return `${name}: shell builtin`;
    if (name in COMMANDS) return `/usr/local/bin/${name}`;
    for (let dir of (env.PATH ?? "").split(":")) {
      if (!dir) continue;
      let p = join(resolve(cwd, dir), name);
      if (this.vfs.isFile(p)) return p;
    }
    return null;
  }
  /** Run a command by name in an existing context (used by jsh, npm run, …). */
  async exec(name, ctx) {
    if (!name.includes("/")) {
      let reg = this.commands.get(name);
      if (reg) return reg({ ...ctx, stdin: ctx.stdin ?? EMPTY_STDIN });
      let b = builtins[name];
      if (b) return b(ctx);
      let cmd = COMMANDS[name];
      if (cmd) return cmd(ctx);
    }
    let file = this.which(name, ctx.cwd, ctx.env);
    return !file || !this.vfs.isFile(file) ? (ctx.stderr.write(`jsh: command not found: ${name}
`), 127) : this.runFile(file, ctx);
  }
  runFile(file, ctx) {
    let head = this.vfs.readText(file).slice(0, 512), shim = /\/\/ clover-bin -> (.+)\n/.exec(head);
    if (shim) return COMMANDS.node({ ...ctx, args: [resolve(dirname(file), shim[1]), ...ctx.args] });
    let shebang = head.startsWith("#!") ? head.slice(2, head.indexOf(`
`)) : "";
    return /\b(sh|bash|jsh|zsh)\b/.test(shebang) ? COMMANDS.jsh({ ...ctx, args: [file, ...ctx.args] }) : COMMANDS.node({ ...ctx, args: [file, ...ctx.args] });
  }
  // ---------------- servers ----------------
  servePort(port, handler) {
    return { url: this.ports.open(port, handler), close: () => this.ports.close(port) };
  }
  createDevServer(opts = {}) {
    return createDevServer(this, opts);
  }
  build(opts = {}) {
    return build(this, opts);
  }
  /** esbuild over the VFS. Relative entry points resolve against workdir. */
  async bundle(options) {
    let serverish = options.platform === "node" || options.platform === "neutral", externals = (options.external ?? []).map((e) => globToRegExp(e)), r = await bundleVfs(this.vfs, {
      ...options,
      cwd: options.absWorkingDir ?? this.workdir,
      wasmURL: this.esbuildWasmUrl,
      vfsPlugin: {
        builtins: serverish ? "external" : "empty",
        external: (spec) => {
          if (/^(npm|jsr|node|bun):/.test(spec) || externals.some((re) => re.test(spec)) || options.packages === "external" && isBare(spec)) return spec;
        },
        resolve: serverish ? { conditions: ["deno", "worker", "node", "import", "module", "default"], extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".cjs", ".json"], mainFields: ["module", "main"] } : void 0
      }
    });
    return {
      outputFiles: r.outputFiles.map((f) => ({ path: f.path, text: f.text, contents: f.contents })),
      errors: r.errors,
      warnings: r.warnings,
      metafile: r.metafile
    };
  }
  // ---------------- workers ----------------
  /** Create a runtime worker shipped next to this module (dist/node-worker.js). */
  createWorker(_name) {
    let url = new URL("./node-worker.js", import.meta.url);
    if (typeof location > "u" || url.origin === location.origin) return new Worker(url, { type: "module", name: "clover-node" });
    let blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" });
    return new Worker(URL.createObjectURL(blob), { type: "module", name: "clover-node" });
  }
  // ---------------- service worker bridge ----------------
  async connectServiceWorker(url) {
    if (typeof navigator > "u" || !("serviceWorker" in navigator)) {
      this.emit("error", { message: "Service workers unavailable: previews disabled" });
      return;
    }
    let sw = navigator.serviceWorker, onMessage = (ev) => {
      let m = ev.data;
      !m || typeof m != "object" || (m.type === "clover-who" ? ev.ports[0]?.postMessage({ owns: m.instanceId === this.instanceId }) : m.type === "clover-request" && m.instanceId === this.instanceId && ev.ports[0] && this.ports.answer(m, ev.ports[0]));
    };
    sw.addEventListener("message", onMessage), sw.startMessages(), this.cleanups.push(() => sw.removeEventListener("message", onMessage));
    try {
      let reg = await sw.register(url, { scope: "/" }), active = reg.active ?? await waitActive(reg);
      active.postMessage({ type: "clover-register", instanceId: this.instanceId }), this.cleanups.push(() => active.postMessage({ type: "clover-unregister", instanceId: this.instanceId }));
    } catch (e) {
      this.emit("error", { message: `Service worker registration failed (${url}): ${e instanceof Error ? e.message : e}` });
    }
  }
  // ---------------- teardown ----------------
  teardown() {
    if (!this.torndown) {
      this.torndown = !0;
      for (let p of this.procs) p.kill();
      for (let port of this.ports.list()) this.ports.close(port);
      for (let fn of this.cleanups.splice(0)) fn();
      this.listeners.clear();
    }
  }
};
function waitActive(reg) {
  return new Promise((resolve2, reject) => {
    let w = reg.installing ?? reg.waiting;
    if (!w) return navigator.serviceWorker.ready.then((r) => resolve2(r.active), reject);
    let check = () => {
      w.state === "activated" ? resolve2(w) : w.state === "redundant" && reject(new Error("service worker became redundant"));
    };
    w.addEventListener("statechange", check), check();
  });
}

// src/index.ts
init_esbuild();
export {
  Container,
  DEFAULT_WASM_URL,
  ESBUILD_VERSION
};
//# sourceMappingURL=clover-container.js.map
