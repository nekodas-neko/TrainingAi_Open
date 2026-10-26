// #2634: the stored still-period resting HR feeds `heart.daytime_rhr`, read from the completed day
// before the one scored (a daytime unit never reads the day itself), and a day with no stored value
// drops out as missing rather than scoring as 0.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '../assemble'
import { scoreShadowReadiness } from '../score'

const D = '2026-10-20'

function raw(derived: ShadowRawHistory['derived']): ShadowRawHistory {
  return {
    tz: 'America/Los_Angeles', ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], wear: [], workouts: [], program: null,
    setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(), derived,
  }
}
const days = (n: number, bpm: (i: number) => number | null) =>
  Array.from({ length: n }, (_, i) => ({ day: shiftDateStr(D, -(i + 1)), stressHighMinutes: null, stillRhrBpm: bpm(i) }))

describe('heart.daytime_rhr from the stored still-period resting HR (#2634)', () => {
  it('takes yesterday\'s stored value, with the earlier days as its history', () => {
    const unit = assembleShadowInputs(prepareShadowHistory(raw(days(30, i => 62 + (i % 3)))), D).units['heart.daytime_rhr']!
    expect(unit.today).toMatchObject({ date: shiftDateStr(D, -1), value: 62, source: 'oura_daily_derived' })
    expect(unit.history).toHaveLength(29)
  })

  it('never reads the scored day itself', () => {
    const withToday = [{ day: D, stressHighMinutes: null, stillRhrBpm: 99 }, ...days(30, () => 62)]
    const unit = assembleShadowInputs(prepareShadowHistory(raw(withToday)), D).units['heart.daytime_rhr']!
    expect(unit.today?.date).toBe(shiftDateStr(D, -1))
    expect(unit.today?.value).toBe(62)
  })

  it('is missing, not zero, for a day that stored nothing', () => {
    const unit = assembleShadowInputs(prepareShadowHistory(raw(days(30, i => (i === 0 ? null : 62)))), D).units['heart.daytime_rhr']!
    expect(unit.today).toBeNull()
    const r = scoreShadowReadiness(assembleShadowInputs(prepareShadowHistory(raw(days(30, i => (i === 0 ? null : 62)))), D))
    expect(r.pillarDetail.heart.dropped['heart.daytime_rhr']).toBe('missing')
  })

  it('is no longer marked unavailable', () => {
    const r = scoreShadowReadiness(assembleShadowInputs(prepareShadowHistory(raw(days(30, () => 62))), D))
    expect(r.pillarDetail.heart.dropped['heart.daytime_rhr']).not.toBe('unavailable')
    expect(r.units['heart.daytime_rhr'].score).not.toBeNull()
  })
})
