import { describe, expect, it } from 'vitest'
import { computeStreak } from '../compute-streak'

/** Pins the rest-gap rule that moved out of `session-select-content.tsx` with the RV-86 change.
 *  The extraction was mechanical, so these exist to make the next edit to it a deliberate one. */

const dayKey = (daysAgo = 0) => `d${daysAgo}`
const trained = (...agos: number[]) =>
  Object.fromEntries(agos.map(a => [`d${a}`, ['session']])) as Record<string, string[]>

describe('computeStreak', () => {
  it('is 0 on an empty window — which the caller must not read as "the fetch succeeded"', () => {
    expect(computeStreak({}, dayKey)).toBe(0)
  })

  it('does not count an untrained today against the streak', () => {
    expect(computeStreak(trained(1, 2, 3), dayKey)).toBe(3)
  })

  it('counts a trained today', () => {
    expect(computeStreak(trained(0, 1), dayKey)).toBe(2)
  })

  it('bridges two rest days but breaks on the third', () => {
    // 1 and 2 rest → the gap is spanned and the rest days are credited.
    expect(computeStreak(trained(1, 4), dayKey)).toBe(4)
    // 1, 2 and 3 rest → the walk stops before day 5 is reached.
    expect(computeStreak(trained(1, 5), dayKey)).toBe(1)
  })
})
