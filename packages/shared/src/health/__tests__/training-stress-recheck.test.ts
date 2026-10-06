import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'
import { staleTrainingStressDays, TRAINING_STRESS_RECHECK_DAYS } from '../training-stress-recheck'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-05'
const endOf = (day: string) => dateStrMidnightInTz(shiftDateStr(day, 1), TZ)

const allFinal = () => {
  const m = new Map<string, Date | null>()
  for (let back = 1; back <= TRAINING_STRESS_RECHECK_DAYS; back++) {
    const day = shiftDateStr(TODAY, -back)
    m.set(day, new Date(endOf(day).getTime() + 1))
  }
  return m
}

describe('staleTrainingStressDays (#2400)', () => {
  it('is empty when every day in the look-back was evaluated after it ended', () => {
    expect(staleTrainingStressDays(TODAY, TZ, allFinal())).toEqual([])
  })

  it('names a day stamped before it ended, even when it is not yesterday', () => {
    const m = allFinal()
    m.set('2026-10-02', new Date(dateStrMidnightInTz('2026-10-02', TZ).getTime() + 6.4 * 3_600_000))
    expect(staleTrainingStressDays(TODAY, TZ, m)).toEqual(['2026-10-02'])
  })

  it('treats the exact end of the day as final', () => {
    const m = allFinal()
    m.set('2026-10-04', endOf('2026-10-04'))
    expect(staleTrainingStressDays(TODAY, TZ, m)).toEqual([])
  })

  it('names a day with no row or a null stamp, oldest first', () => {
    const m = allFinal()
    m.delete('2026-10-01')
    m.set('2026-10-04', null)
    expect(staleTrainingStressDays(TODAY, TZ, m)).toEqual(['2026-10-01', '2026-10-04'])
  })

  it('never names today or a day beyond the look-back', () => {
    const days = staleTrainingStressDays(TODAY, TZ, new Map())
    expect(days).toHaveLength(TRAINING_STRESS_RECHECK_DAYS)
    expect(days[0]).toBe(shiftDateStr(TODAY, -TRAINING_STRESS_RECHECK_DAYS))
    expect(days.at(-1)).toBe(shiftDateStr(TODAY, -1))
    expect(days).not.toContain(TODAY)
  })
})
