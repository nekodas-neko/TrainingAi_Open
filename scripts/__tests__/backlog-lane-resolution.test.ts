// An entry's PROSE could outrank its own lane tag, because the parser took the first "Lane A"-shaped
// string it saw. Measured 2026-08-20: Q-529 was being served to Lane A's queue while its own body
// said "Re-scoped from Lane A to Lane B" fourteen lines above `**Lane:** B`. A Lane B item had been
// sitting at the top of the other lane's list.
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { laneFromLines } = require('../lib/lane.js') as {
  laneFromLines: (lines: string[]) => 'A' | 'B' | '?' | null
}

describe('backlog lane resolution', () => {
  it('reads the field form', () => {
    expect(laneFromLines(['- **Lane:** B'])).toBe('B')
    expect(laneFromLines(['- **Lane: A** — `app/api/**`'])).toBe('A')
  })

  // 75 of 205 entries write it without a colon, so this form cannot be dropped.
  it('reads the bare form when there is no field', () => {
    expect(laneFromLines(['- **Surface:** `components/**` — **Lane B**'])).toBe('B')
  })

  // The defect. Both of these are real entries' shapes.
  it("does not let an entry's prose outrank its own field", () => {
    expect(laneFromLines([
      '  - **Re-scoped from Lane A to Lane B.** Not a missing recompute path.',
      '- **Branch:** `fix/x` · **Lane:** B',
    ])).toBe('B')

    expect(laneFromLines([
      '> **⚠️ ROUTE (a) SHIPPED (Lane A), owner-approved.**',
      '- **Lane: B**',
    ])).toBe('B')
  })

  it('still takes the first field when an entry states one twice', () => {
    expect(laneFromLines(['- **Lane:** A', '- **Lane:** B'])).toBe('A')
  })

  // `null` means "not stated", which the caller reads as visible to BOTH lanes. Returning undefined
  // here instead once hid 96 of 203 entries from both lanes at once.
  it('returns null — not undefined — when no lane is stated', () => {
    const got = laneFromLines(['- **Branch:** `fix/x`', 'some prose about landing it'])
    expect(got).toBeNull()
    expect(got).not.toBeUndefined()
  })

  // The residual class, found after the field-vs-prose fix: an entry with NO field form whose bare
  // mentions disagree. Measured 2026-08-20 — 19 entries, and EIGHT of Lane A's top ten READY items
  // among them, because a banner reading "the Lane A half SHIPPED, what is left is Lane B" puts an
  // `A` ahead of the real tag. Taking the first is a coin toss dressed as an answer.
  it('refuses to guess when bare mentions disagree and there is no field', () => {
    expect(laneFromLines([
      '> **⚠️ The Lane A half SHIPPED. What is left is Lane B only** — switching the client over.',
      '- **Lane B** (`components/nutrition/meal-type-manager.tsx`).',
    ])).toBe('?')
  })

  it('still answers when the bare mentions agree', () => {
    expect(laneFromLines([
      '- **Lane B.** `components/oura-ble/` only — the route is Lane B too.',
      'and the console is Lane B.',
    ])).toBe('B')
  })

  it('a field form settles it even when the prose disagrees repeatedly', () => {
    expect(laneFromLines([
      'the Lane A half shipped', 'and more Lane A prose', '- **Lane:** B',
    ])).toBe('B')
  })

  it('preserves an explicit unknown', () => {
    expect(laneFromLines(['- **Lane: ?** — whichever role does its handoff next'])).toBe('?')
  })
})
