import { describe, expect, it } from 'vitest'
import { expandWord, parse, ParseError } from '../src/shell/parser'

const env = { HOME: '/home', NAME: 'world', EMPTY: '' }
const argv = (src: string) => parse(src).map((i) => i.pipeline.map((c) => c.argv.map((w) => expandWord(w, env))))

describe('jsh parser', () => {
  it('splits words, quotes and escapes', () => {
    expect(argv(`echo "hello $NAME" 'it''s' a\\ b`)).toEqual([[['echo', 'hello world', 'its', 'a b']]])
    expect(argv(`echo "a \\"q\\""`)).toEqual([[['echo', 'a "q"']]])
    expect(argv(`echo '$NAME'`)).toEqual([[['echo', '$NAME']]])
  })

  it('expands ${VAR}, defaults and ~', () => {
    expect(argv('echo ${NAME}x ${MISSING:-dflt} ${EMPTY:-e} ${EMPTY-keep} ~/x')).toEqual([[['echo', 'worldx', 'dflt', 'e', '', '/home/x']]])
  })

  it('parses lists, pipes and operators', () => {
    const l = parse('a && b || c; d | e | f')
    expect(l.map((i) => i.op)).toEqual(['&&', '||', ';', null])
    expect(l[3].pipeline).toHaveLength(3)
  })

  it('parses env prefixes and redirects', () => {
    const [{ pipeline }] = parse('FOO=1 BAR="x y" node a.js > out.txt 2>&1 < in.txt')
    const cmd = pipeline[0]
    expect(cmd.assigns.map(([k, w]) => [k, expandWord(w, env)])).toEqual([['FOO', '1'], ['BAR', 'x y']])
    expect(cmd.argv.map((w) => expandWord(w, env))).toEqual(['node', 'a.js'])
    expect(cmd.redirects.map((r) => r.op)).toEqual(['>', '2>&1', '<'])
    expect(argv('echo a=b')).toEqual([[['echo', 'a=b']]])
  })

  it('handles comments, trailing ; and errors', () => {
    expect(argv('echo hi # comment')).toEqual([[['echo', 'hi']]])
    expect(argv('echo a;')).toEqual([[['echo', 'a']]])
    expect(() => parse('echo "unterminated')).toThrow(ParseError)
    expect(() => parse('| x')).toThrow(ParseError)
    expect(() => parse('a &&')).toThrow(ParseError)
    expect(() => parse('echo >')).toThrow(ParseError)
  })
})
