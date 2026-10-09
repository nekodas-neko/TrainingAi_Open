// #2652: `check-hex-literals` read issue numbers as colours. A comment was already blanked by
// `stripComments` (#2557); what still tripped it was a number written where a colour cannot be (a
// test name, JSX text). These cases pin both halves: the references that must not count, and the
// colours in code that must, so the ratchet cannot be loosened by accident.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const { stripComments } = require_('../lib/strip-comments.js') as { stripComments: (s: string) => string }
const { countHexLiterals } = require_('../lib/hex-literals.js') as { countHexLiterals: (s: string) => number }

// The same two steps the script runs on every file.
const count = (src: string) => countHexLiterals(stripComments(src))

describe('issue references are not colours', () => {
  it('ignores #NNNN in a line comment, a block comment and a JSDoc', () => {
    expect(count('// see #2383\nconst a = 1')).toBe(0)
    expect(count('/* fixes #2383 */ const a = 1')).toBe(0)
    expect(count('/**\n * Closes #2383, #2118\n */\nexport const a = 1')).toBe(0)
  })

  it('ignores #NNNN in a test name and in JSX text', () => {
    expect(count("it('keeps the total (#2383)', () => {})")).toBe(0)
    expect(count("describe('item #2383 stays', () => {})")).toBe(0)
    expect(count('export const A = <p>see #2383</p>')).toBe(0)
  })
})

describe('colours in code still count', () => {
  it('counts a string, a className arbitrary value and a style object', () => {
    expect(count("const c = '#ff0000'")).toBe(1)
    expect(count('<div className="bg-[#abc]" />')).toBe(1)
    expect(count("<div style={{ color: '#123456' }} />")).toBe(1)
  })

  it('counts a template literal, a gradient and a numeric-only colour in a colour position', () => {
    expect(count('const c = `${x}#fff`')).toBe(1)
    expect(count("const g = 'linear-gradient(#123456, #abcdef)'")).toBe(2)
    expect(count("const c = '#1234'")).toBe(1)
    expect(count('<div className="text-[#1234]" />')).toBe(1)
    expect(count('const s = { color: #2383 }')).toBe(1)
  })

  it('keeps counting three-digit numeric matches, which are valid short colours', () => {
    expect(count("it('PR #919 landed', () => {})")).toBe(1)
    expect(count("const border = '1px solid #333'")).toBe(1)
  })

  it('still counts code after a // inside a URL string', () => {
    expect(count("const u = 'https://example.com//a#fff'; const c = '#ff0000'")).toBe(2)
    expect(count("const u = 'https://example.com//a'; const c = '#ff0000' // #2383")).toBe(1)
  })

  it('counts a colour next to a comment that holds a reference', () => {
    expect(count("const c = '#ff0000' // was #2383")).toBe(1)
  })
})
