// The queue holds two kinds of thing, and the tool could only see one.
//
// Most rows are work. A few are maps that other entries READ — BF-28 carries the twelve artboards
// and the three rules six parity entries follow; BF-11 is the spec its eight phases read. They
// belong in the queue, and they said so only in prose, so `next-item.js` printed BF-28 as READY #1
// under a header that says "top of the list is next". Three sessions in a row opened the queue and
// met a row that cannot be started.
//
// The marker is a FIELD for the reason `Lane:`, `Needs:` and `Gate:` are: a third phrasing appears
// and prose-detection silently goes back to mis-sorting.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { referenceFromLines, hasProseMarker } = require('../lib/reference.js') as {
  referenceFromLines: (lines: string[]) => string | null
  hasProseMarker: (lines: string[]) => boolean
}

describe('reference field', () => {
  it('reads the bullet form', () => {
    expect(referenceFromLines(['- **Reference:** the parity entries read this one.']))
      .toBe('the parity entries read this one.')
  })

  // `keepFromLines` accepts a dash because two real entries write `- **Keep — what is NOT done:**`.
  // The same hand writes the same shape here, so this matches rather than waiting to be surprised.
  it('reads the dash form', () => {
    expect(referenceFromLines(['- **Reference — why:** the map'])).toBe('why: the map')
  })

  it('ignores prose that merely uses the word', () => {
    expect(referenceFromLines(['see the reference doc for the byte layout'])).toBeNull()
    expect(referenceFromLines(['- this entry is a reference for the others'])).toBeNull()
  })
})

describe('prose marker detection', () => {
  it('sees a self-declaration at the start of its bullet', () => {
    expect(hasProseMarker(['- **⚑ Not implementable on its own.** This is the entry…'])).toBe(true)
    expect(hasProseMarker(['- **Not a work item.** Split into eight phases…'])).toBe(true)
  })

  // The reason this is anchored rather than a substring match, and it is not hypothetical: the
  // first draft used `includes` and immediately flagged LB-22 — the entry that *proposed* the field
  // and quotes both markers while describing them. An entry discussing the convention is not
  // claiming it, and a checker that cannot tell those apart is the failure the field exists to end.
  it('does not fire on an entry that merely quotes the markers', () => {
    expect(hasProseMarker([
      '  marker today — `⚑ Not implementable on its own` (BF-28) and `Not a work item` (BF-11) —',
    ])).toBe(false)
    expect(hasProseMarker([
      '  - **BF-28** — *"⚑ Not implementable on its own. This is the entry the parity entries read"*',
    ])).toBe(false)
  })

  it('is silent on an ordinary entry', () => {
    expect(hasProseMarker(['- **Lane:** B', '- **Branch:** `feat/x`'])).toBe(false)
  })
})
