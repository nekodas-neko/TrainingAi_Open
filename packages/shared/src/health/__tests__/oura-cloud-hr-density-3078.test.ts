// #3078: since the switch to the Oura API the ring's heart rate is a 5-minute series at rest, with
// irregular bursts while awake. An hour of it with a gap over the ring's cadence is missing — the
// #2437 rule — not a low hour; a dense strap hour is scored as before. The calorie estimate and
// Body Battery are held to the same idea of "measured".
import { describe, it, expect } from 'vitest'
import { dropSparseHrHours, intradayHrContributors, DENSITY_GATED_HR_SOURCES } from '../intraday-hr-contributors'
import { moveHoursGoal } from '../hourly-movement'
import { avgBpmDenseEnough, estSessionKcal, MIN_HR_READINGS_PER_MIN_FOR_ENERGY } from '../workout-energy'
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

describe('zone minutes and move hours: sparse Oura Cloud against a dense strap', () => {
  it('gates oura_cloud like Health Connect', () => {
    expect(DENSITY_GATED_HR_SOURCES.has('oura_cloud')).toBe(true)
  })

  it('a dense strap hour at midday scores its zone minutes', () => {
    const strap = series('chest_strap', at(12), at(12, 30), 1, 140)
    expect(run(strap).zoneMinutes).toBeGreaterThanOrEqual(29)
  })

  it('the same midday half-hour seen by Oura in scattered points is missing, not a low score', () => {
    // Awake bursts with 8-minute holes: under the ring's own cadence, so the hour is unmeasured.
    const oura = series('oura_cloud', at(12), at(12, 30), 8 * 60, 140)
    expect(run(oura)).toEqual({ zoneMinutes: null, moveHours: null, moveHoursGoal: null })
    // Before the gate these points were scored as a few minutes of zone time — under the strap's 30.
    expect(dropSparseHrHours(oura, TZ).rows).toEqual([])
  })

  it('a full 5-minute Oura series is measured, so the owner\'s resting hours still count', () => {
    const oura = series('oura_cloud', at(7), at(22), 5 * 60, 70)
    const c = run(oura)
    expect(c.moveHoursGoal).toBe(moveHoursGoal())
    expect(c.zoneMinutes).toBe(0)
  })

  it('a sparse Oura hour leaves the move goal, and a strap hour beside it is kept', () => {
    const oura = [...series('oura_cloud', at(8), at(12), 5 * 60, 70), ...series('oura_cloud', at(12), at(13), 20 * 60, 70)]
    const strap = series('chest_strap', at(13), at(13, 30), 1, 140)
    const c = run([...oura, ...strap])
    expect(c.moveHoursGoal).toBe(moveHoursGoal() - 1)
    expect(c.zoneMinutes).toBeGreaterThanOrEqual(29)
  })

  it('an hour the strap covers keeps its strap readings even when Oura was sparse in it', () => {
    const strap = series('chest_strap', at(12), at(12, 30), 1, 140)
    const oura = series('oura_cloud', at(12), at(13), 20 * 60, 70)
    const { rows, sparseHours } = dropSparseHrHours([...strap, ...oura], TZ)
    expect(rows).toHaveLength(strap.length)
    expect(sparseHours).toEqual([])
  })
})

describe('the HR calorie estimate falls back to METs when the session\'s HR is sparse', () => {
  const start = at(12)
  const end = at(12, 45) // a 65-minute HR window with the two 10-minute pads
  const body = { ageYears: 33, weightKg: 80, sex: 'male' as const, rpe: 6, durationMin: 45 }
  const kcalFor = (readings: number) =>
    estSessionKcal({ ...body, avgBpm: avgBpmDenseEnough(readings, start, end) ? 130 : null })

  it('uses the ring\'s cadence as the rate: about one reading per 5.5 minutes', () => {
    expect(MIN_HR_READINGS_PER_MIN_FOR_ENERGY).toBeCloseTo(60 / 330, 9)
  })

  it('a full 5-minute series (13 readings) drives the HR estimate', () => {
    expect(avgBpmDenseEnough(13, start, end)).toBe(true)
    expect(kcalFor(13).source).toBe('hr')
  })

  it('scattered points (9 readings) fall back to METs', () => {
    expect(avgBpmDenseEnough(9, start, end)).toBe(false)
    const est = kcalFor(9)
    expect(est.source).toBe('met')
    expect(est.kcal).toBeGreaterThan(0)
  })

  it('a strap session passes; an incomplete session or an unusable count does not', () => {
    expect(avgBpmDenseEnough(3900, start, end)).toBe(true)
    expect(avgBpmDenseEnough(13, start, null)).toBe(false)
    expect(avgBpmDenseEnough(Number.NaN, start, end)).toBe(false)
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
