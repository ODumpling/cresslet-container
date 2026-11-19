import { describe, expect, it } from 'vitest'
import { contentHash, findModuleScripts, findTags, rewriteHtmlForBuild } from '../src/build/html'
import { parseDotenv, parseJsonc } from '../src/dev/project'

const html = `<!doctype html>
<html><head>
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/src/style.css">
  <!-- <script type="module" src="/commented.ts"></script> -->
</head><body>
  <img src="./logo.png" alt=x>
  <script type="module" src="/src/main.tsx"></script>
  <script src="https://cdn.example.com/x.js"></script>
</body></html>`

describe('html', () => {
  it('finds module scripts, ignoring comments and remote', () => {
    expect(findModuleScripts(html)).toEqual(['/src/main.tsx'])
    expect(findTags(html).map((t) => t.name)).toEqual(['link', 'link', 'img', 'script', 'script'])
  })

  it('rewrites for production build', () => {
    const out = rewriteHtmlForBuild(html, {
      scripts: { '/src/main.tsx': '/assets/main-ABC.js' },
      styles: { '/src/style.css': '/assets/style-DEF.css' },
      assets: { './logo.png': '/assets/logo-123.png' },
      extraCss: ['/assets/main-ABC.css'],
    })
    expect(out).toContain('<script crossorigin type="module" src="/assets/main-ABC.js"></script>')
    expect(out).toContain('<link rel="stylesheet" href="/assets/style-DEF.css">')
    expect(out).toContain('<img src="/assets/logo-123.png" alt=x>')
    expect(out).toMatch(/<link rel="stylesheet" crossorigin href="\/assets\/main-ABC.css">\s*<\/head>/)
    expect(out).toContain('href="/favicon.svg"')
    expect(out).toContain('https://cdn.example.com/x.js')
  })

  it('hashes deterministically', () => {
    const a = contentHash(new TextEncoder().encode('abc'))
    expect(a).toHaveLength(8)
    expect(a).toBe(contentHash(new TextEncoder().encode('abc')))
    expect(a).not.toBe(contentHash(new TextEncoder().encode('abd')))
  })

  it('parses jsonc and dotenv', () => {
    expect(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1,], }')).toEqual({ a: 'x//y', b: [1] })
    expect(parseDotenv('A=1\nexport B="two words"\n# c\nC=x # trailing\nD=')).toEqual({ A: '1', B: 'two words', C: 'x', D: '' })
  })
})
