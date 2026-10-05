// TN-46 — a flagged day names the recent dose beside the advisory. It annotates and never corrects.
import { describe, it, expect } from 'vitest'
import { recentDoses, doseContextPhrase, withDoseContext, DOSE_EFFECT_LOOKBACK_DAYS } from '../dose-context'

const retaHalf = { supplementName: 'Retatrutide', date: '2026-09-07', amount: 0.5, unit: 'mg' }
const retaOne = { supplementName: 'Retatrutide', date: '2026-09-13', amount: 1, unit: 'mg' }

describe('recentDoses (TN-46)', () => {
  it('keeps doses inside the lag window, newest first, with how long ago', () => {
    expect(recentDoses([retaHalf, retaOne], '2026-09-16').map(d => [d.date, d.daysAgo])).toEqual([['2026-09-13', 3]])
    expect(recentDoses([retaHalf, retaOne], '2026-09-13').map(d => d.daysAgo)).toEqual([0])
  })

  it('reaches back exactly the measured effect window, not further', () => {
    expect(DOSE_EFFECT_LOOKBACK_DAYS).toBe(5)
    expect(recentDoses([retaOne], '2026-09-18')).toHaveLength(1)
    expect(recentDoses([retaOne], '2026-09-19')).toHaveLength(0)
  })

  it('ignores a dose logged after the day being read', () => {
    expect(recentDoses([retaOne], '2026-09-12')).toHaveLength(0)
  })
})

describe('the advisory annotation (TN-46)', () => {
  it('names the latest dose per supplement, in the administered amount', () => {
    const recent = recentDoses([retaHalf, retaOne], '2026-09-16', 10)
    expect(doseContextPhrase(recent)).toBe('Retatrutide 1 mg, 3 days ago')
  })

  it('appends the dose to an advisory and leaves it alone without one', () => {
    const recent = recentDoses([retaOne], '2026-09-16')
    expect(withDoseContext('Signs your body may be fighting something.', recent))
      .toBe('Signs your body may be fighting something. Recent dose: Retatrutide 1 mg, 3 days ago. Some medications move resting HR and HRV for several days, so this may be the dose rather than illness.')
    expect(withDoseContext('Signs your body may be fighting something.', [])).toBe('Signs your body may be fighting something.')
    expect(withDoseContext(null, recent)).toBeNull()
  })

  it('reads "today" and "yesterday" for the nearest days', () => {
    expect(doseContextPhrase(recentDoses([retaOne], '2026-09-13'))).toBe('Retatrutide 1 mg, today')
    expect(doseContextPhrase(recentDoses([retaOne], '2026-09-14'))).toBe('Retatrutide 1 mg, yesterday')
  })
})
