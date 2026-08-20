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

  it('preserves an explicit unknown', () => {
    expect(laneFromLines(['- **Lane: ?** — whichever role does its handoff next'])).toBe('?')
  })
})
