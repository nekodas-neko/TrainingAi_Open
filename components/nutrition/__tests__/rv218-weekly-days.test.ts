// RV-218 ④ — the 7-day chart's rules for padded rows, and for the cached rows from before them.
import { describe, it, expect } from 'vitest'
import { weeklyChartModel } from '../weekly-nutrition-days'

const day = (date: string, calories: number, extra: Record<string, unknown> = {}) =>
  ({ date, calories, proteinG: 0, carbsG: 0, fatG: 0, ...extra })

describe('weeklyChartModel', () => {
  it('averages logged days only: an unlogged day is not a 0 kcal day', () => {
    const m = weeklyChartModel([
      day('2026-09-23', 2000, { logged: true }), day('2026-09-24', 0, { logged: false }),
      day('2026-09-25', 1600, { logged: true }), day('2026-09-26', 0, { logged: false, isToday: true }),
    ])
    expect(m.avgCalories).toBe(1800)
    expect(m.loggedDays).toBe(2)
  })

  it('emphasises the bar marked today, not the last bar', () => {
    const m = weeklyChartModel([day('a', 1, { logged: true, isToday: true }), day('b', 0, { logged: false, isToday: false })])
    expect(m.todayIndex).toBe(0)
  })

  it('shows the empty state when nothing was logged, even with seven padded rows', () => {
    const rows = Array.from({ length: 7 }, (_, i) => day(`d${i}`, 0, { logged: false, isToday: i === 6 }))
    const m = weeklyChartModel(rows)
    expect(m.hasAnyLogged).toBe(false)
    expect(m.avgCalories).toBeNull()
  })

  it('reads a cached row from before padding as logged, with the last row as today', () => {
    const m = weeklyChartModel([day('2026-09-24', 1800), day('2026-09-25', 2200)])
    expect(m.loggedDays).toBe(2)
    expect(m.avgCalories).toBe(2000)
    expect(m.todayIndex).toBe(1)
  })
})
