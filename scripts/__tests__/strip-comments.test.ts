// LA-64: eight `check-*.js` scripts each carried their own comment stripper. Six shared one regex
// pair, and that pair had the defect the strippers exist to prevent — its `//` rule fires inside a
// string literal, so everything after `"a // b"` on that line was blanked and a banned call sitting
// after it read as absent. A false negative in a check whose only job is to find one.
//
// These cases are the ones that were actually wrong, not a general lexer suite.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { stripComments } = require_('../lib/strip-comments.js') as { stripComments: (s: string) => string }

describe('stripComments', () => {
  it('blanks a line comment', () => {
    expect(stripComments('ok(); // banned()')).toBe('ok();            ')
  })

  it('blanks a block comment, including one that spans lines', () => {
    expect(stripComments('/* banned() */ ok();')).toBe('               ok();')
    const src = 'a;\n/* banned()\n   x */\nb;'
    const lines = stripComments(src).split('\n')
    expect(lines[0]).toBe('a;')
    expect(lines[3]).toBe('b;')
    // Blanked, not deleted — the line numbers a failure is reported with have to survive.
    expect(lines[1]).toMatch(/^ +$/)
    expect(lines[2]).toMatch(/^ +$/)
    expect(lines[1]).toHaveLength('/* banned()'.length)
  })

  it('keeps a string that contains a comment opener', () => {
    // The six-copy regex blanked from the `//` inside the string onward, so `banned()` after it
    // was invisible to the scan. This is the false negative LA-64 is about.
    expect(stripComments('const s = "a // b"; banned();')).toBe('const s = "a // b"; banned();')
  })

  it('keeps a URL, including a doubled slash later in it', () => {
    // The old `(^|[^:])` guard protected the `//` after the scheme and nothing after that.
    expect(stripComments('const u = "https://example.com//a"; banned();'))
      .toBe('const u = "https://example.com//a"; banned();')
  })

  it('leaves division alone', () => {
    expect(stripComments('let x = 4 / 2 / 1;')).toBe('let x = 4 / 2 / 1;')
  })

  it('handles an escaped quote inside a string', () => {
    expect(stripComments('const s = "a\\" // b"; banned();')).toBe('const s = "a\\" // b"; banned();')
  })

  it('does not let an unterminated quote swallow the rest of the file', () => {
    // A stray apostrophe in prose is common; without the newline guard everything after it would
    // read as one string and no comment past it would ever be stripped.
    const out = stripComments("const a = 1; ' oops\nok(); // banned()")
    expect(out.split('\n')[1]).toBe('ok();            ')
  })

  it('preserves line count and byte length, so reported line numbers stay right', () => {
    const src = 'a();\n/* x\n y */\nconst s = "// z";\nb(); // c\n'
    const out = stripComments(src)
    expect(out.split('\n').length).toBe(src.split('\n').length)
    expect(out.length).toBe(src.length)
  })
})

describe('every check that strips comments uses the shared one', () => {
  it('no check-*.js declares its own stripComments', async () => {
    // The rule this file protects: eight copies is how two of them drifted into being worse than
    // the other six. `check-aest-midnight-timezone.js` is exempt by name — its
    // `stripCommentsAndStrings` blanks string literals too, which is a different contract.
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '..')
    const offenders = readdirSync(dir)
      .filter(f => f.startsWith('check-') && f.endsWith('.js'))
      .filter(f => /function stripComments\s*\(/.test(readFileSync(join(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
