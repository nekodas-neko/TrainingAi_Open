// #3078, #3114: since the switch to the Oura API the ring's heart rate is a 5-minute series at rest,
// with irregular bursts while awake. The owner chose option C on 26 Oct: Activity's zone minutes read
// Oura heart rate only in dense stretches, and "moved this hour" comes from Oura's per-minute MET. The
// calorie estimate is held to the #2437 rule for the sources it gates, Oura Cloud included (the
// source scoping is tested against Postgres in oura-late-hr-workouts-3078), and Body Battery's gate
// is pinned against a complete Oura series.
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

describe('Oura Cloud heart rate: zone minutes from dense stretches, moved hours from MET (#3114)', () => {
  // A 07:00–22:00 worn day whose MET is 1.0 except the hours given, which are 2.0.
  const metDay = (movedHours: number[], wornFrom = 0, wornTo = 24) => {
    const start = at(0).getTime()
    return {
      startTimestampMs: start,
      metsPerMinute: Array.from({ length: 24 * 60 }, (_, i) => {
        const h = Math.floor(i / 60)
        if (h < wornFrom || h >= wornTo) return null
        return movedHours.includes(h) ? 2.0 : 1.0
      }),
    }
  }

  it('gates oura_cloud by stretch: scattered readings go, a dense run stays', () => {
    expect(DENSITY_GATED_HR_SOURCES.has('oura_cloud')).toBe(true)
    const scattered = series('oura_cloud', at(12), at(13), 17 * 60, 140)
    expect(dropSparseHrHours(scattered, TZ).rows).toEqual([])
    expect(dropSparseHrHours(scattered, TZ).sparseHours).toEqual([{ date: DAY, hour: 12 }])
    const workout = series('oura_cloud', at(12, 10), at(12, 40), 5, 150)
    const outside = scattered.filter(r => r.timestamp < at(12, 5) || r.timestamp > at(12, 45))
    expect(dropSparseHrHours([...outside, ...workout], TZ).rows).toHaveLength(workout.length)
  })

  it('an Oura-app workout inside an otherwise scattered hour still earns its zone minutes', () => {
    const rows = [...series('oura_cloud', at(12), at(13), 17 * 60, 70), ...series('oura_cloud', at(12, 10), at(12, 40), 5, 150)]
    expect(run(rows).zoneMinutes).toBeGreaterThanOrEqual(1)
    expect(run(series('oura_cloud', at(12), at(13), 17 * 60, 150)).zoneMinutes).toBeNull()
  })

  it('a lone Oura reading is not a stretch', () => {
    expect(run([{ timestamp: at(12), bpm: 150, source: 'oura_cloud' }]).zoneMinutes).toBeNull()
  })

  it('Oura heart rate never decides a moved hour, MET does', () => {
    const hot = series('oura_cloud', at(12), at(13), 1, 160)
    expect(run(hot).moveHours).toBeNull()
    const c = intradayHrContributors({ hrRows: hot, ...PROFILE, tz: TZ, dateIso: DAY, metGrid: metDay([9]), dayIsOver: true })
    expect(c.moveHours).toBe(1)
    expect(c.moveHoursGoal).toBe(moveHoursGoal())
  })

  it('a minute at MET 1.8 moves its hour; 1.79 does not', () => {
    const grid = (met: number) => {
      const g = metDay([])
      g.metsPerMinute[9 * 60 + 30] = met
      return g
    }
    const moved = (met: number) => intradayHrContributors({ hrRows: [], ...PROFILE, tz: TZ, dateIso: DAY, metGrid: grid(met), dayIsOver: true }).moveHours
    expect(moved(1.8)).toBe(1)
    expect(moved(1.79)).toBe(0)
  })

  it('hours the ring was off leave the goal on a finished day', () => {
    const c = intradayHrContributors({ hrRows: [], ...PROFILE, tz: TZ, dateIso: DAY, metGrid: metDay([8, 9, 10], 7, 17), dayIsOver: true })
    expect(c).toEqual({ zoneMinutes: null, moveHours: 3, moveHoursGoal: 10 })
  })

  it('today, an hour after the last worn one has not arrived yet and stays in the goal', () => {
    const grid = metDay([8], 7, 17)
    const today = intradayHrContributors({ hrRows: [], ...PROFILE, tz: TZ, dateIso: DAY, metGrid: grid })
    expect(today.moveHoursGoal).toBe(moveHoursGoal())
    const gap = metDay([8], 7, 17)
    for (let m = 11 * 60; m < 13 * 60; m++) gap.metsPerMinute[m] = null
    expect(intradayHrContributors({ hrRows: [], ...PROFILE, tz: TZ, dateIso: DAY, metGrid: gap }).moveHoursGoal).toBe(moveHoursGoal() - 2)
  })

  it('the strap still moves an hour MET did not', () => {
    const strap = series('chest_strap', at(15), at(15, 30), 1, 140)
    const c = intradayHrContributors({ hrRows: strap, ...PROFILE, tz: TZ, dateIso: DAY, metGrid: metDay([9]), dayIsOver: true })
    expect(c.moveHours).toBe(2)
    expect(c.zoneMinutes).toBeGreaterThanOrEqual(29)
  })

  it('a day with no MET and no non-Oura heart rate has no move lane', () => {
    expect(run(series('oura_cloud', at(12), at(12, 30), 5, 70))).toEqual({ zoneMinutes: expect.any(Number), moveHours: null, moveHoursGoal: null })
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
