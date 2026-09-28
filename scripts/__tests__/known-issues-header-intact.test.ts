// The header of docs/overview/known-issues.md quotes the domain-tag grep, and that quote contains
// `### `. Two sessions on 2026-09-28 inserted a new issue "before the first `### [`" by searching
// for that text unanchored: the first hit was inside the quote, so the new heading was spliced into
// the header mid-line and the rest of the header was pushed below the new rows. Each later insertion
// landed in the same wrong place. This pins the quote whole and requires every issue heading to
// come after the header.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const lines = readFileSync(join(process.cwd(), 'docs/overview/known-issues.md'), 'utf8').split('\n')

describe('known-issues.md header (2026-09-28)', () => {
  it('keeps the domain-tag grep quote on one intact line', () => {
    expect(lines).toContain("> `grep -n '^### .*\\[sleep\\]' docs/overview/known-issues.md` works exactly as it did against")
  })

  it('puts no issue heading inside the header block', () => {
    const firstHeading = lines.findIndex(l => /^### \[/.test(l))
    const lastQuote = lines.reduce((last, l, i) => (i < firstHeading + 40 && l.startsWith('>') ? i : last), -1)
    expect(firstHeading).toBeGreaterThan(lastQuote)
    expect(lines.filter(l => /^> .*### \[[a-z-]+\]/.test(l))).toEqual([])
  })
})
