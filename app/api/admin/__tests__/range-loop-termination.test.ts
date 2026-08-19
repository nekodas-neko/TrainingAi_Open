import { describe, it, expect } from 'vitest'
import { shiftDateStr, daysBetweenDateStrs } from '@trainingai/shared/date-utils'

/**
 * Q-497 — the two admin range loops must terminate on a range that passes every guard.
 *
 * `admin/day-review` and `admin/backfill-derived-scores` both drive ~12 queries per day against a
 * `max: 10` pool, and the second one COMMITS, so a non-terminating loop is an unbounded write. The
 * loop body cannot be exercised here without a repository and a day of real data — what is asserted
 * is the *iteration contract* the routes now use, against the exact input that defeated the old one.
 */
describe('admin range loop termination (Q-497)', () => {
  // from=9999-12-01&to=9999-12-31 passes every guard: both dates normalise, `end < start` is false,
  // and the span is exactly MAX_RANGE_DAYS.
  const START = '9999-12-01'
  const END = '9999-12-31'
  const MAX_RANGE_DAYS = 31

  it('the guarded span is exactly at the limit, so nothing rejects this range', () => {
    const span = daysBetweenDateStrs(START, END) + 1
    expect(span).toBe(31)
    expect(span > MAX_RANGE_DAYS).toBe(false)
  })

  it('the OLD string-compare loop does not terminate — this is the defect', () => {
    let iterations = 0
    for (let d = START; d <= END; d = shiftDateStr(d, 1)) {
      if (++iterations > 200) break
    }
    // It sails past the 31 days it was asked for. Left as a live assertion rather than a comment so
    // that a future change which genuinely makes string comparison safe fails here and gets read.
    expect(iterations).toBeGreaterThan(31)
  })

  it('the loop the routes use now runs exactly the guarded number of days', () => {
    const span = daysBetweenDateStrs(START, END) + 1
    const visited: string[] = []
    for (let i = 0; i < span; i++) visited.push(shiftDateStr(START, i))

    expect(visited).toHaveLength(31)
    expect(visited[0]).toBe('9999-12-01')
    expect(visited[30]).toBe('9999-12-31')
    expect(visited.every(d => d <= END)).toBe(true)
  })

  it('an ordinary range is unchanged — the control', () => {
    const span = daysBetweenDateStrs('2026-08-01', '2026-08-31') + 1
    const visited: string[] = []
    for (let i = 0; i < span; i++) visited.push(shiftDateStr('2026-08-01', i))
    expect(visited).toHaveLength(31)
    expect(visited[30]).toBe('2026-08-31')
  })

  it('a single-day range runs once, not zero times', () => {
    const span = daysBetweenDateStrs('2026-08-05', '2026-08-05') + 1
    expect(span).toBe(1)
    const visited: string[] = []
    for (let i = 0; i < span; i++) visited.push(shiftDateStr('2026-08-05', i))
    expect(visited).toEqual(['2026-08-05'])
  })
})
