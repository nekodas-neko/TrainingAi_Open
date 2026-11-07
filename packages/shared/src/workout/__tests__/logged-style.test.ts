import { describe, it, expect } from 'vitest'
import { loggedStyleFromSetRows, type LoggedSetPlan } from '../logged-style'
import { estimateOneRm } from '../../1rm'

const row = (n: number, pct: number | null, reps: number | null, use = true): LoggedSetPlan =>
  ({ set_number: n, planned_pct: pct, planned_reps: reps, use_for_1rm: use })

describe('loggedStyleFromSetRows (issue 3663)', () => {
  it('rebuilds the style a Preview log was scored with, so the edit gives the log-time 1RM', () => {
    const rows = [1, 2, 3, 4].map(n => row(n, 70, 8))
    const sets = [70, 70, 70, 70].map(w => ({ weightKg: w, reps: 8 }))
    const style = loggedStyleFromSetRows(rows, 4, 'weighted')
    expect(estimateOneRm(sets, { exerciseType: 'weighted', style }).estimated1rm).toBe(100)
    // What the edit computed before: no style at all.
    expect(estimateOneRm(sets, { exerciseType: 'weighted', style: null }).estimated1rm).toBe(87.75)
  })

  it('returns null for a log with no stored plan, so the caller falls back to style_id', () => {
    expect(loggedStyleFromSetRows([row(1, null, null, true), row(2, null, null, true)], 2, 'weighted')).toBeNull()
    expect(loggedStyleFromSetRows([], 2, 'weighted')).toBeNull()
  })

  it('returns null for a bodyweight exercise, whose planned_pct is never stored', () => {
    expect(loggedStyleFromSetRows([row(1, null, 8)], 1, 'bodyweight')).toBeNull()
  })

  it('keeps the stored use_for_1rm flags, and an unplanned set does not count when others are flagged', () => {
    const rows = [row(1, 80, 5, false), row(2, 75, 6, true)]
    const style = loggedStyleFromSetRows(rows, 3, 'weighted')!
    expect(style).toEqual([
      { pct: 80, reps: 5, useFor1rm: false },
      { pct: 75, reps: 6, useFor1rm: true },
      { pct: 0, reps: 0, useFor1rm: false },
    ])
  })
})
