import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { entriesVerdict } = require('../lib/entries-verdict')

/**
 * BF-36: over the limit, the failure must land on the branch that GREW the directory.
 *
 * Driven against fixture numbers rather than the live directory on purpose — a regression test for
 * a counting rule that reads the repo's real count changes verdict as the repo does, which is the
 * one thing it must not do. The live count was 20 foldable against a limit of 60 when this was
 * written; none of these cases would exercise the limit at all if they read it.
 */

const BASE = { chore: 20, limit: 60, totalCeiling: 250, dir: 'docs/overview/entries' }
const over = (addedHere: number | null) =>
  entriesVerdict({ ...BASE, total: 161, unlinked: 61, addedHere })

describe('over the runaway limit', () => {
  it('fails a branch that adds an entry — it is the growth, and it is already here', () => {
    const v = over(1)
    expect(v.level).toBe('fail')
    expect(v.message).toContain('adds 1 of them')
    expect(v.message).toContain('runaway limit')
  })

  it('only NOTES a branch that adds none — #527 was a docs-only PR the failure never named', () => {
    const v = over(0)
    expect(v.level).toBe('note')
    expect(v.message).toContain('not yours to fix')
  })

  it('still fails when the base cannot be read, rather than silencing the limit', () => {
    const v = over(null)
    expect(v.level).toBe('fail')
    expect(v.message).toContain('could not be read')
  })
})

describe('the other thresholds are unchanged', () => {
  it('the total ceiling fails regardless of who added what', () => {
    const v = entriesVerdict({ ...BASE, total: 251, unlinked: 10, addedHere: 0 })
    expect(v.level).toBe('fail')
    expect(v.message).toContain('total ceiling')
  })

  it('the ceiling is still reached when the limit was excused for this branch', () => {
    const v = entriesVerdict({ ...BASE, total: 251, unlinked: 61, addedHere: 0 })
    expect(v.level).toBe('fail')
    expect(v.message).toContain('total ceiling')
  })

  it('the chore threshold still notes, and does not fail', () => {
    const v = entriesVerdict({ ...BASE, total: 100, unlinked: 20, addedHere: 5 })
    expect(v.level).toBe('note')
    expect(v.message).toContain('compaction chore')
  })

  it('under everything is silent', () => {
    expect(entriesVerdict({ ...BASE, total: 100, unlinked: 19, addedHere: 5 }).level).toBe('ok')
  })
})
