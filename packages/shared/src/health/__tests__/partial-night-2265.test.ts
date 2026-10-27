// #2265 — a night the owner marked partial keeps its physiology and loses its duration-derived
// numbers; unmarking returns it exactly; with no mark nothing anywhere moves.
import { describe, it, expect } from 'vitest'
import { computeSleepScore, sleepScoreBaselines } from '@trainingai/shared/health/sleep-score'
import { scoreSleepForDate } from '@trainingai/shared/health/sleep-score-for-date'
import { aggregateNight, groupSleepPeriods, nightSessions } from '@trainingai/shared/health/sleep-night'
import { sleepDurationTrend, sleepScoreTrend } from '@trainingai/shared/health/sleep-trend'
import { toVerdictNights, sleepVerdictForNight, VERDICT_BASELINE_NIGHTS } from '@trainingai/shared/health/sleep-verdict'
import { sleepAverages } from '@trainingai/shared/profile/measured-overview'
import {
  PARTIAL_NIGHT_DROPPED_FIELDS, PartialNightPayloadSchema, isPartialNight, nightsWithDuration, scoredNights,
  withoutPartialDuration,
} from '@trainingai/shared/health/partial-night'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { SleepSession } from '@trainingai/shared/types/body'

const TZ = 'Australia/Brisbane' // UTC+10, no DST
const FIRST = '2026-09-01'
const MARK = new Date('2026-10-20T01:00:00Z')

/** A normal night waking on `date`: 22:30 to 06:30 local, 8 h, with its physiology. */
function fullNight(date: string, over: Partial<SleepSession> = {}): SleepSession {
  const wake = new Date(`${date}T06:30:00+10:00`)
  return {
    id: `n-${date}`, userId: 'u1', date,
    sleepStart: new Date(wake.getTime() - 8 * 3_600_000), sleepEnd: wake, createdAt: wake,
    durationHours: 8, timeInBedHours: 8.6, efficiency: 92, onsetLatencySec: 600, restlessPeriods: 3,
    deepSleepHours: 1.4, remSleepHours: 1.8, lightSleepHours: 4.4, awakHours: 0.4,
    averageHrvMs: 60, avgHeartRate: 55, lowestHeartRate: 50, respiratoryRate: 14,
    durationSource: 'oura_cloud', hrvSource: 'oura_cloud', avgHeartRateSource: 'oura_cloud', respiratoryRateSource: 'oura_cloud',
    ...over,
  }
}

/** The ring went on at 04:40 and the night ran to 07:55: 3 h 15 m, with healthy physiology. */
function partialNight(date: string, over: Partial<SleepSession> = {}): SleepSession {
  return fullNight(date, {
    sleepStart: new Date(`${date}T04:40:00+10:00`), sleepEnd: new Date(`${date}T07:55:00+10:00`),
    durationHours: 3.25, timeInBedHours: 3.6, efficiency: 84, onsetLatencySec: 1800, restlessPeriods: 1,
    deepSleepHours: 0.6, remSleepHours: 0.7, lightSleepHours: 1.8, awakHours: 0.5,
    averageHrvMs: 47, avgHeartRate: 59, lowestHeartRate: 55, respiratoryRate: 13.4,
    ...over,
  })
}

const dates = (n: number, from = FIRST) => Array.from({ length: n }, (_, i) => shiftDateStr(from, i))

describe('withoutPartialDuration', () => {
  it('returns an unmarked night as the same object', () => {
    const n = partialNight('2026-10-20')
    expect(withoutPartialDuration(n)).toBe(n)
    expect(withoutPartialDuration({ ...n, partialNightAt: null })).toEqual({ ...n, partialNightAt: null })
  })

  it('removes exactly the duration-derived fields and keeps the physiology and the window', () => {
    const marked = partialNight('2026-10-20', { partialNightAt: MARK })
    const kept = withoutPartialDuration(marked)
    for (const f of PARTIAL_NIGHT_DROPPED_FIELDS) expect(kept[f], f).toBeUndefined()
    expect(kept).toMatchObject({
      averageHrvMs: 47, avgHeartRate: 59, lowestHeartRate: 55, respiratoryRate: 13.4,
      sleepStart: marked.sleepStart, sleepEnd: marked.sleepEnd, partialNightAt: MARK,
    })
  })

  it('does not change the night it was given', () => {
    const marked = partialNight('2026-10-20', { partialNightAt: MARK })
    const before = structuredClone(marked)
    withoutPartialDuration(marked)
    expect(marked).toEqual(before)
  })

  it('scoredNights leaves an unmarked series element for element, and nightsWithDuration drops only marks', () => {
    const series = [fullNight('2026-10-18'), partialNight('2026-10-19', { partialNightAt: MARK }), fullNight('2026-10-20')]
    const scored = scoredNights([series[0], series[2]])
    expect(scored[0]).toBe(series[0])
    expect(scored[1]).toBe(series[2])
    expect(nightsWithDuration(series).map(n => n.date)).toEqual(['2026-10-18', '2026-10-20'])
    expect(isPartialNight(series[1])).toBe(true)
    expect(isPartialNight(null)).toBe(false)
  })
})

describe('the wire shape', () => {
  it('takes an id and a boolean and nothing else', () => {
    const id = '6f1c2a4e-0b7d-4c1e-9a55-2265aa0000ff'
    expect(PartialNightPayloadSchema.safeParse({ id, partial: true }).success).toBe(true)
    expect(PartialNightPayloadSchema.safeParse({ id, partial: false }).success).toBe(true)
    for (const bad of [{}, { id }, { id: 'x', partial: true }, { id, partial: 'yes' }, { id, partial: true, userId: 'u2' }]) {
      expect(PartialNightPayloadSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('the sleep score of a marked night', () => {
  const history = dates(20).map(d => fullNight(d))
  const target = '2026-09-21'

  it('has none of its own, and unmarking returns the original score exactly', () => {
    const original = scoreSleepForDate([...history, partialNight(target)], target, TZ)
    expect(original).not.toBeNull()
    const marked = scoreSleepForDate([...history, partialNight(target, { partialNightAt: MARK })], target, TZ)
    expect(marked).toBeNull()
    const unmarked = scoreSleepForDate([...history, partialNight(target, { partialNightAt: null })], target, TZ)
    expect(unmarked?.result).toEqual(original!.result)
  })

  it('computeSleepScore reads a marked night as unscorable', () => {
    expect(computeSleepScore(partialNight(target, { partialNightAt: MARK }), TZ)).toBeNull()
  })

  it('does not change the score of any other night', () => {
    const withMark = [...history, partialNight(target, { partialNightAt: MARK })]
    const without = [...history, partialNight(target)]
    for (const d of dates(20)) {
      expect(scoreSleepForDate(withMark, d, TZ), d).toEqual(scoreSleepForDate(without, d, TZ))
    }
  })

  it('moves nothing while no night is marked: a null mark scores identically to no mark', () => {
    const plain = [...history, fullNight(target)]
    const nulled = plain.map(s => ({ ...s, partialNightAt: null }))
    for (const d of [...dates(20), target]) {
      expect(scoreSleepForDate(nulled, d, TZ)?.result, d).toEqual(scoreSleepForDate(plain, d, TZ)?.result)
    }
    expect(nightSessions(nulled, TZ).map(n => n.date)).toEqual(nightSessions(plain, TZ).map(n => n.date))
  })
})

describe('the normals a marked night joins and leaves', () => {
  // Six full nights and one marked: a normal that needs seven.
  const six = dates(6).map(d => fullNight(d))
  const seven = dates(7).map(d => fullNight(d))
  const marked = partialNight('2026-09-07', { partialNightAt: MARK, averageHrvMs: 61, avgHeartRate: 53 })

  it('counts its HRV and heart rate toward the autonomic normals', () => {
    expect(sleepScoreBaselines(six, TZ).hrvBaselineMs).toBeNull()
    expect(sleepScoreBaselines([...six, marked], TZ).hrvBaselineMs).not.toBeNull()
    expect(sleepScoreBaselines([...six, marked], TZ).hrBaselineBpm).not.toBeNull()
  })

  it('keeps its bed and wake times out of the schedule normals', () => {
    expect(sleepScoreBaselines(seven, TZ).habitualBedHour).not.toBeNull()
    const withMarked = sleepScoreBaselines([...six, marked], TZ)
    expect(withMarked.habitualBedHour).toBeNull()
    expect(withMarked.habitualWakeHour).toBeNull()
  })

  it('keeps its awake fraction out of the fragmentation normal, and its hours out of the nights that count', () => {
    const fourteen = dates(14).map(d => fullNight(d, { awakHours: 0.4 }))
    const wild = partialNight('2026-09-15', { partialNightAt: MARK, awakHours: 3 })
    expect(sleepScoreBaselines([...fourteen, wild], TZ)).toEqual({
      ...sleepScoreBaselines(fourteen, TZ),
      // only the autonomic normals may differ: the mark adds a reading to them
      hrvBaselineMs: expect.anything(), hrBaselineBpm: expect.anything(),
    })
    expect(sleepScoreBaselines([...fourteen, wild], TZ).awakeFractionBaselineMean)
      .toBe(sleepScoreBaselines(fourteen, TZ).awakeFractionBaselineMean)
  })

  it('an unmarked short night still stays out of every normal (the 4 h gate is unchanged)', () => {
    const short = partialNight('2026-09-07')
    expect(sleepScoreBaselines([...six, short], TZ)).toEqual(sleepScoreBaselines(six, TZ))
  })

  it('a marked night moves the normal by its own HRV, as a reading', () => {
    const base = dates(10).map(d => fullNight(d, { averageHrvMs: 60 }))
    const high = partialNight('2026-09-11', { partialNightAt: MARK, averageHrvMs: 100 })
    const withHigh = sleepScoreBaselines([...base, high], TZ).hrvBaselineMs!
    const without = sleepScoreBaselines(base, TZ).hrvBaselineMs!
    expect(withHigh).toBeGreaterThanOrEqual(without)
  })
})

describe('a reassembled night', () => {
  it('carries the mark when any window has it, and an unmarked night is untouched', () => {
    const a = fullNight('2026-10-20', {
      sleepStart: new Date('2026-10-19T12:30:00Z'), sleepEnd: new Date('2026-10-19T18:30:00Z'), durationHours: 6,
    })
    const b = fullNight('2026-10-20', {
      id: 'b', sleepStart: new Date('2026-10-19T19:30:00Z'), sleepEnd: new Date('2026-10-19T21:30:00Z'), durationHours: 2, partialNightAt: MARK,
    })
    const period = groupSleepPeriods([a, b], TZ).nights[0]
    expect(aggregateNight(period).partialNightAt).toEqual(MARK)

    const b2 = { ...b }
    delete b2.partialNightAt
    const unmarked = aggregateNight(groupSleepPeriods([a, b2], TZ).nights[0])
    expect('partialNightAt' in unmarked).toBe(false)
  })
})

describe('trends and averages that are about hours', () => {
  const days = dates(12)
  const base = days.map(d => fullNight(d))

  it('skip a marked night rather than reading it as a short one', () => {
    const markedLast = [...base.slice(0, -1), partialNight(days[11], { partialNightAt: MARK })]
    const dropped = base.slice(0, -1)
    expect(sleepDurationTrend(markedLast, TZ)).toBe(sleepDurationTrend(dropped, TZ))
    const unmarkedLast = [...base.slice(0, -1), partialNight(days[11])]
    expect(sleepDurationTrend(unmarkedLast, TZ)).toBeLessThan(sleepDurationTrend(dropped, TZ)!)
    expect(sleepScoreTrend(markedLast, TZ)).toBe(sleepScoreTrend(dropped, TZ))
  })

  it('judge a marked night by nothing: the verdict reads no component of it', () => {
    const [n] = toVerdictNights([partialNight('2026-10-20', { partialNightAt: MARK })], TZ)
    expect(n).toEqual({ date: '2026-10-20', durationHours: null, onsetMinutes: null, efficiency: null })
    const [plain] = toVerdictNights([partialNight('2026-10-20')], TZ)
    expect(plain.durationHours).toBe(3.25)
  })

  it('average the owner\'s measured nights without its hours, keeping its heart rate and breathing', () => {
    const row = (date: string, over: Record<string, unknown> = {}) => ({
      date, durationHours: 8, efficiency: 92, sleepStart: `${date}T12:30:00.000Z`, lowestHeartRate: 50, respiratoryRate: 14, ...over,
    })
    const avg = sleepAverages([
      row('2026-10-18'), row('2026-10-19'),
      row('2026-10-20', { durationHours: 3, efficiency: 84, sleepStart: '2026-10-19T18:23:00.000Z', lowestHeartRate: 56, respiratoryRate: 9, partialNightAt: MARK.toISOString() }),
    ])
    expect(avg).toMatchObject({ nights: 3, durationHours: 8, efficiency: 92 })
    expect(avg!.lowestHeartRate).toBeCloseTo((50 + 50 + 56) / 3, 6)
    expect(avg!.respiratoryRate).toBeCloseTo((14 + 14 + 9) / 3, 6)
  })
})

describe('the sleep verdict of a marked night', () => {
  const history = dates(VERDICT_BASELINE_NIGHTS).map(d => fullNight(d))
  const target = shiftDateStr(history.at(-1)!.date, 1)
  const verdictFor = (mark: boolean) => {
    const short = partialNight(target, mark ? { partialNightAt: MARK } : {})
    const nights = toVerdictNights([...history, short], TZ)
    return sleepVerdictForNight(nights.find(n => n.date === target)!, nights)
  }

  it('is no verdict at all, not "normal", when the owner marked the night', () => {
    expect(verdictFor(true)).toBeNull()
  })

  it('is unchanged when the same short night is not marked: poor', () => {
    expect(verdictFor(false)?.verdict).toBe('poor')
  })
})
