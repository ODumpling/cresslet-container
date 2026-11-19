// jsh command-line parser: quotes, escapes, $VAR/${VAR}/${VAR:-x}, VAR=x prefixes,
// | && || ; and > >> < 2> 2>> &> 2>&1 redirects. Variables expand at execution time.

/** A word is a list of literal text and variable references. */
export type WordPart = string | { v: string; def?: string; colon?: boolean }
export type Word = WordPart[]

export interface Redirect {
  op: '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1'
  target: Word
}
export interface SimpleCommand {
  assigns: [string, Word][]
  argv: Word[]
  redirects: Redirect[]
}
export type Pipeline = SimpleCommand[]
export interface ListItem {
  pipeline: Pipeline
  /** Operator connecting to the NEXT item (null for last). */
  op: '&&' | '||' | ';' | null
}
export type CommandList = ListItem[]

type Tok = { t: 'word'; w: Word; assign: number } | { t: 'op'; v: string }

export class ParseError extends Error {}

const OPS = ['2>&1', '2>>', '&&', '||', '>>', '2>', '&>', ';', '|', '>', '<', '&']

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  const readVar = (): WordPart => {
    i++ // '$'
    if (src[i] === '{') {
      const end = src.indexOf('}', i)
      if (end < 0) throw new ParseError('bad substitution')
      const expr = src.slice(i + 1, end)
      i = end + 1
      const m = /^([A-Za-z_][A-Za-z0-9_]*)(:?)-(.*)$/s.exec(expr)
      return m ? { v: m[1], def: m[3], colon: !!m[2] } : { v: expr }
    }
    if (/[?$#0-9]/.test(src[i] ?? '')) return { v: src[i++] }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (!m) return '$'
    i += m[0].length
    return { v: m[0] }
  }
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      toks.push({ t: 'op', v: op })
      i += op.length
      continue
    }
    const w: Word = []
    let lit = ''
    let quoted = false
    let assign = -1
    const flush = () => {
      if (lit) w.push(lit)
      lit = ''
    }
    while (i < n && !/[\s;|&<>]/.test(src[i])) {
      const ch = src[i]
      if (ch === "'") {
        quoted = true
        const end = src.indexOf("'", i + 1)
        if (end < 0) throw new ParseError('unterminated quote')
        lit += src.slice(i + 1, end)
        i = end + 1
      } else if (ch === '"') {
        quoted = true
        i++
        while (i < n && src[i] !== '"') {
          if (src[i] === '\\' && '"\\$`'.includes(src[i + 1])) {
            lit += src[i + 1]
            i += 2
          } else if (src[i] === '$') {
            flush()
            w.push(readVar())
          } else lit += src[i++]
        }
        if (src[i] !== '"') throw new ParseError('unterminated quote')
        i++
      } else if (ch === '\\') {
        lit += src[i + 1] ?? ''
        i += 2
      } else if (ch === '$') {
        flush()
        w.push(readVar())
      } else if (ch === '~' && !w.length && !lit && (i + 1 >= n || /[\s/;|&]/.test(src[i + 1]))) {
        w.push({ v: 'HOME', def: '/home', colon: true })
        i++
      } else {
        if (ch === '=' && !quoted && assign < 0 && !w.length && /^[A-Za-z_][A-Za-z0-9_]*$/.test(lit)) assign = lit.length
        lit += src[i++]
      }
    }
    flush()
    if (!w.length) w.push('')
    toks.push({ t: 'word', w, assign })
  }
  return toks
}

export function parse(src: string): CommandList {
  const toks = tokenize(src)
  const list: CommandList = []
  let pipeline: Pipeline = []
  let cmd: SimpleCommand = { assigns: [], argv: [], redirects: [] }
  const empty = () => !cmd.argv.length && !cmd.assigns.length && !cmd.redirects.length
  const endCmd = (near: string) => {
    if (empty()) throw new ParseError(`syntax error near unexpected token '${near}'`)
    pipeline.push(cmd)
    cmd = { assigns: [], argv: [], redirects: [] }
  }
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]
    if (tok.t === 'word') {
      if (tok.assign >= 0 && !cmd.argv.length) {
        const first = tok.w[0] as string
        cmd.assigns.push([first.slice(0, tok.assign), [first.slice(tok.assign + 1), ...tok.w.slice(1)]])
      } else cmd.argv.push(tok.w)
      continue
    }
    switch (tok.v) {
      case '|':
        endCmd('|')
        break
      case '&&':
      case '||':
      case ';':
      case '&':
        if ((tok.v === ';' || tok.v === '&') && empty() && !pipeline.length) {
          if (!list.length) throw new ParseError(`syntax error near unexpected token '${tok.v}'`)
          continue
        }
        endCmd(tok.v)
        list.push({ pipeline, op: tok.v === '&' ? ';' : (tok.v as ListItem['op']) })
        pipeline = []
        break
      case '2>&1':
        cmd.redirects.push({ op: '2>&1', target: [] })
        break
      default: {
        const next = toks[++k]
        if (!next || next.t !== 'word') throw new ParseError(`syntax error near unexpected token '${tok.v}'`)
        cmd.redirects.push({ op: tok.v as Redirect['op'], target: next.w })
      }
    }
  }
  if (!empty()) endCmd('')
  else if (pipeline.length) throw new ParseError('syntax error: unexpected end of input')
  if (pipeline.length) list.push({ pipeline, op: null })
  else if (list.length && list[list.length - 1].op !== ';') throw new ParseError('syntax error: unexpected end of input')
  if (list.length) list[list.length - 1].op = null
  return list
}

export function expandWord(w: Word, env: Record<string, string | undefined>): string {
  let s = ''
  for (const p of w) {
    if (typeof p === 'string') s += p
    else {
      const v = env[p.v]
      s += p.def === undefined ? (v ?? '') : p.colon ? v || p.def : (v ?? p.def)
    }
  }
  return s
}

/** Quote a string for safe re-parsing. */
export function quote(s: string): string {
  return /^[A-Za-z0-9_\-./:=@%+,]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}
