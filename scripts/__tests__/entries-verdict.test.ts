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
  // These two asserted `fail` "regardless of who added what" until LB-58. That was the defect, not
  // the contract: with the base already over, the branch did not cross the ceiling and cannot fold
  // its way back under it either, so it is told rather than blocked. What each case was really
  // protecting — that the ceiling is a SEPARATE gate from the runaway limit, and still surfaces
  // when that limit does not — is what they assert now.
  it('a branch that did not cross the ceiling is told, not blamed for it', () => {
    const v = entriesVerdict({ ...BASE, total: 251, unlinked: 10, addedHere: 0 })
    expect(v.level).toBe('note')
    expect(v.message).toContain('total ceiling')
  })

  it('the ceiling still surfaces when the runaway limit was excused for this branch', () => {
    // Over BOTH, adding nothing: the runaway limit excuses it, and the ceiling must not go silent.
    const v = entriesVerdict({ ...BASE, total: 251, unlinked: 61, addedHere: 0 })
    expect(v.level).toBe('note')
    expect(v.message).toContain('total ceiling')
  })

  it('and it still FAILS the branch that crosses the ceiling — the gate is not gone', () => {
    const v = entriesVerdict({ ...BASE, total: 251, unlinked: 10, addedHere: 1 })
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

/**
 * LB-58 — the TOTAL ceiling had no attribution at all, so once `main` reached it every PR adding a
 * journal entry failed, whoever it belonged to. Measured twice: 2026-09-03 blocked a spec fix at
 * 251/250, 2026-09-06 blocked an e2e-drift PR at 320/320. Both had added exactly one entry.
 *
 * It deliberately does NOT reuse the runaway limit's `grewIt` test. Every session writes a journal
 * entry, so `grewIt` is true for practically every PR and gating on it would change nothing. The
 * ceiling also differs in kind: unlike the runaway limit, the branch it blocks CANNOT pay it off —
 * most entries are linked by a durable doc and unfoldable, so the sweep the message asks for cannot
 * get under the number.
 */
const CEIL = { chore: 20, limit: 60, totalCeiling: 320, dir: 'docs/overview/entries' }
const atCeiling = (addedHere: number | null, total = 321) =>
  entriesVerdict({ ...CEIL, total, unlinked: 46, addedHere })

describe('the total ceiling', () => {
  it('fails the branch whose own entries cross it, and says what the base was', () => {
    const v = atCeiling(1)
    expect(v.level).toBe('fail')
    expect(v.message).toContain('total ceiling')
    expect(v.message).toContain('base was 320')
  })

  it('only NOTES a branch that arrives after the base is already over', () => {
    // base 321, this branch adds 1 -> 322. It did not cross it; the previous PR did.
    const v = entriesVerdict({ ...CEIL, total: 322, unlinked: 46, addedHere: 1 })
    expect(v.level).toBe('note')
    expect(v.message).toContain('did not cross it')
  })

  it('notes rather than fails even when the branch adds nothing at all', () => {
    expect(entriesVerdict({ ...CEIL, total: 322, unlinked: 46, addedHere: 0 }).level).toBe('note')
  })

  it('says a sweep here could not fix it — that is what makes the old failure unactionable', () => {
    const v = entriesVerdict({ ...CEIL, total: 322, unlinked: 46, addedHere: 1 })
    expect(v.message).toContain('could not get under it')
  })

  it('still fails when the base cannot be read — an unreadable base must not silence it', () => {
    const v = atCeiling(null)
    expect(v.level).toBe('fail')
    expect(v.message).toContain('could not be read')
  })

  it('pluralises the attribution, because the message names a real number', () => {
    expect(atCeiling(1, 321).message).toContain('1 entry is')
    expect(entriesVerdict({ ...CEIL, total: 323, unlinked: 46, addedHere: 3 }).message).toContain('3 entries are')
  })

  it('is silent below the ceiling — the gate is the count, not the act of adding', () => {
    expect(entriesVerdict({ ...CEIL, total: 300, unlinked: 19, addedHere: 1 }).level).toBe('ok')
  })

  it('the runaway limit still outranks it: a foldable overflow this branch grew fails first', () => {
    // Over BOTH. The runaway message is the actionable one, so it must win.
    const v = entriesVerdict({ ...CEIL, total: 321, unlinked: 61, addedHere: 1 })
    expect(v.level).toBe('fail')
    expect(v.message).toContain('runaway limit')
  })
})
