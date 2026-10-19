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

  // #3079: Oura's MET for a day can land hours after the day ended, after its final verdict.
  describe('once more when Oura MET changed after the final verdict', () => {
    const DAY = '2026-10-02'
    const verdictAt = () => new Date(endOf(DAY).getTime() + 30 * 60_000)

    it("names a finished day whose MET changed after its verdict", () => {
      const m = allFinal(); m.set(DAY, verdictAt())
      const met = new Map([[DAY, new Date(verdictAt().getTime() + 3 * 3_600_000)]])
      expect(staleTrainingStressDays(TODAY, TZ, m, met)).toEqual([DAY])
    })

    it("counts the Oura day before it, whose activity day runs to 4 a.m. on this one", () => {
      const m = allFinal(); m.set(DAY, verdictAt())
      const met = new Map([[shiftDateStr(DAY, -1), new Date(verdictAt().getTime() + 60_000)]])
      expect(staleTrainingStressDays(TODAY, TZ, m, met)).toContain(DAY)
    })

    it('is final again once re-evaluated after the change (one re-evaluation per change)', () => {
      const changed = new Date(verdictAt().getTime() + 3 * 3_600_000)
      const m = allFinal(); m.set(DAY, new Date(changed.getTime() + 1))
      expect(staleTrainingStressDays(TODAY, TZ, m, new Map([[DAY, changed]]))).toEqual([])
    })

    it('ignores MET that changed before the verdict', () => {
      const m = allFinal(); m.set(DAY, verdictAt())
      const met = new Map([[DAY, new Date(verdictAt().getTime() - 60_000)]])
      expect(staleTrainingStressDays(TODAY, TZ, m, met)).toEqual([])
    })
  })
})
