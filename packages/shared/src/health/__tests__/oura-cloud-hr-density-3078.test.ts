// #3078: since the switch to the Oura API the ring's heart rate is a 5-minute series at rest, with
// irregular bursts while awake. Whether Activity's lanes gate it is the owner's call (#3114),
// so they are pinned UNCHANGED here. The calorie estimate is held to the #2437 rule, and Body
// Battery's gate is pinned against a complete Oura series.
import { describe, it, expect } from 'vitest'
import {
  dropSparseHrHours, intradayHrContributors, isDenseHrSeries, isDenseHrSpan, DENSITY_GATED_HR_SOURCES, HR_DENSE_MAX_GAP_MS,
} from '../intraday-hr-contributors'
import { moveHoursGoal } from '../hourly-movement'
import { estSessionKcal } from '../workout-energy'
import { batteryConfidence, MIN_SAMPLES_PER_WAKING_HOUR } from '../body-battery-inputs'

const TZ = 'Australia/Brisbane'
const DAY = '2026-10-18'
// A Brisbane wall-clock time on DAY as an instant (UTC+10, no DST).
const at = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 9, 18, h - 10, m, s))
const PROFILE = { maxHr: 178, restingHr: 55 }
const series = (source: string, from: Date, to: Date, everySec: number, bpm: number) => {
  const out: { timestamp: Date; bpm: number; source: string }[] = []
  for (let t = from.getTime(); t < to.getTime(); t += everySec * 1000) out.push({ timestamp: new Date(t), bpm, source })
  return out
}
const run = (hrRows: { timestamp: Date; bpm: number; source?: string | null }[]) =>
  intradayHrContributors({ hrRows, ...PROFILE, tz: TZ, dateIso: DAY })

describe('zone minutes and move hours: Oura Cloud stays ungated until the owner decides', () => {
  it('does not gate oura_cloud', () => {
    expect(DENSITY_GATED_HR_SOURCES.has('oura_cloud')).toBe(false)
  })

  it('a scattered midday Oura half-hour still scores, as it did before this PR', () => {
    const oura = series('oura_cloud', at(12), at(12, 30), 8 * 60, 140)
    expect(dropSparseHrHours(oura, TZ).rows).toHaveLength(oura.length)
    expect(run(oura).moveHoursGoal).toBe(moveHoursGoal())
  })

  it('a dense strap hour at midday scores its zone minutes', () => {
    const strap = series('chest_strap', at(12), at(12, 30), 1, 140)
    expect(run(strap).zoneMinutes).toBeGreaterThanOrEqual(29)
  })

  it('Health Connect is still gated by the same rule', () => {
    expect(run(series('health_connect', at(12), at(12, 30), 8 * 60, 140))).toEqual({ zoneMinutes: null, moveHours: null, moveHoursGoal: null })
  })
})

describe('the HR calorie estimate falls back to METs when the session\'s HR fails the #2437 rule', () => {
  const body = { ageYears: 33, weightKg: 80, sex: 'male' as const, rpe: 6, durationMin: 71 }
  const kcalFor = (times: number[]) => estSessionKcal({ ...body, avgBpm: isDenseHrSeries(times) ? 130 : null })

  it('21 points over 71 minutes with gaps up to 19 minutes fall back to METs, though their average rate is high enough', () => {
    // 20 gaps summing to 71 minutes: nineteen of ~2.7 min and one of 19.
    const gaps = [...Array(19).fill((71 - 19) / 19), 19]
    const times = gaps.reduce<number[]>((acc, g) => [...acc, acc[acc.length - 1] + g * 60_000], [at(12).getTime()])
    expect(times).toHaveLength(21)
    expect(21 / 71).toBeGreaterThan(60_000 / HR_DENSE_MAX_GAP_MS) // the rate rule this replaced passed it
    expect(isDenseHrSeries(times)).toBe(false)
    const est = kcalFor(times)
    expect(est.source).toBe('met')
    expect(est.kcal).toBeGreaterThan(0)
  })

  it('a dense strap session uses the HR estimate', () => {
    expect(kcalFor(series('chest_strap', at(12), at(13, 11), 1, 130).map(r => r.timestamp.getTime())).source).toBe('hr')
  })

  it('a complete 5-minute series passes; a lone reading or a gap one second over the cadence does not', () => {
    expect(isDenseHrSeries(series('oura_cloud', at(12), at(13), 5 * 60, 70).map(r => r.timestamp.getTime()))).toBe(true)
    expect(isDenseHrSpan(1, null)).toBe(false)
    expect(isDenseHrSpan(2, HR_DENSE_MAX_GAP_MS)).toBe(true)
    expect(isDenseHrSpan(2, HR_DENSE_MAX_GAP_MS + 1000)).toBe(false)
  })
})

describe('Body Battery\'s confidence gate reads a complete Oura series as measured', () => {
  // Reviewed for #3078, not changed: the gate needs 8 waking samples an hour, and Oura's 5-minute
  // cadence gives 12. A day below 8 an hour averages a reading every 7.5 minutes or more, past the
  // ring's own cadence and the walk's 7-minute sample cap: "Limited data" is then true.
  it('a full 5-minute series over the waking day is sufficient', () => {
    const wakingMin = 10 * 60
    expect(batteryConfidence(wakingMin / 5, wakingMin).sufficient).toBe(true)
    expect(60 / 5).toBeGreaterThan(MIN_SAMPLES_PER_WAKING_HOUR)
  })

  it('a series with a reading only every 10 minutes is limited', () => {
    const wakingMin = 10 * 60
    expect(batteryConfidence(wakingMin / 10, wakingMin).sufficient).toBe(false)
  })
})
