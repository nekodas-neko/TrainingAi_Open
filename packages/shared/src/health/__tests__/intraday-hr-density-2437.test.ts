// #2437 (decided 2026-10-06 under "missing is missing, never zero"): Health Connect heart rate counts
// toward zone minutes and move-every-hour only in hours at least as dense as the ring's own 5-minute
// cadence. Below that the hour is missing — never a low score — and the ring and strap never change.
import { describe, it, expect } from 'vitest'
import { dropSparseHrHours, intradayHrContributors, HR_DENSE_MAX_GAP_MS } from '../intraday-hr-contributors'
import { activeMinutesFromReadings } from '../zone-minutes'
import { computeMovedHours, moveHoursGoal } from '../hourly-movement'
import { moderateIntensityBpm, vigorousIntensityBpm } from '../hr-zones'

const TZ = 'Australia/Brisbane'
const DAY = '2026-10-07'
// A Brisbane wall-clock minute on DAY as an instant (UTC+10, no DST).
const at = (h: number, m = 0, s = 0) => new Date(Date.UTC(2026, 9, 7, h - 10, m, s))
const PROFILE = { maxHr: 185, restingHr: 55 }
const series = (source: string, fromH: number, toH: number, everyMin: number, bpm: number | ((i: number) => number)) => {
  const out: { timestamp: Date; bpm: number; source: string }[] = []
  let i = 0
  for (let t = at(fromH).getTime(); t < at(toH).getTime(); t += everyMin * 60_000, i++) {
    out.push({ timestamp: new Date(t), bpm: typeof bpm === 'function' ? bpm(i) : bpm, source })
  }
  return out
}
const run = (hrRows: { timestamp: Date; bpm: number; source?: string | null }[]) =>
  intradayHrContributors({ hrRows, ...PROFILE, tz: TZ, dateIso: DAY })

describe('dropSparseHrHours', () => {
  it('keeps a Health Connect hour at the ring\'s cadence and drops one at half of it', () => {
    expect(dropSparseHrHours(series('health_connect', 9, 10, 5, 80), TZ).rows).toHaveLength(12)
    const sparse = dropSparseHrHours(series('health_connect', 9, 10, 10, 80), TZ)
    expect(sparse.rows).toEqual([])
    expect(sparse.sparseHours).toEqual([{ date: DAY, hour: 9 }])
  })

  it(`allows a gap of ${HR_DENSE_MAX_GAP_MS / 1000} s, not one second more`, () => {
    const pair = (gapMs: number) => [
      { timestamp: at(9, 10), bpm: 80, source: 'health_connect' },
      { timestamp: new Date(at(9, 10).getTime() + gapMs), bpm: 80, source: 'health_connect' },
    ]
    expect(dropSparseHrHours(pair(HR_DENSE_MAX_GAP_MS), TZ).rows).toHaveLength(2)
    expect(dropSparseHrHours(pair(HR_DENSE_MAX_GAP_MS + 1000), TZ).rows).toEqual([])
  })

  it('judges only the worn part of the hour: a watch put on at :40 is dense', () => {
    expect(dropSparseHrHours(series('health_connect', 9, 10, 1, 80).filter(r => r.timestamp >= at(9, 40)), TZ).rows).toHaveLength(20)
  })

  it('a single reading is not an hour of heart rate', () => {
    expect(dropSparseHrHours([{ timestamp: at(9, 30), bpm: 80, source: 'health_connect' }], TZ).rows).toEqual([])
  })

  it('never touches the ring or the strap, however sparse', () => {
    const ring = series('ble', 9, 10, 20, 80)
    const strap = series('chest_strap', 11, 12, 15, 80)
    expect(dropSparseHrHours([...ring, ...strap], TZ).rows).toHaveLength(ring.length + strap.length)
  })
})

describe('intradayHrContributors', () => {
  it('reads the owner\'s ring day exactly as before', () => {
    const ring = series('ble', 7, 22, 5, i => (i % 12 === 0 ? 120 : 70))
    const c = run(ring)
    const floors = { moderateFloorBpm: moderateIntensityBpm(PROFILE), vigorousFloorBpm: vigorousIntensityBpm(PROFILE) }
    expect(c.zoneMinutes).toBe(activeMinutesFromReadings(ring.map(r => ({ timestamp: r.timestamp.getTime(), bpm: r.bpm })), floors))
    expect(c.moveHours).toBe(computeMovedHours({ hrRows: ring, ...PROFILE, tz: TZ, dateIso: DAY }))
    expect(c.moveHoursGoal).toBe(moveHoursGoal())
  })

  it('a phone writing one reading every 10 minutes is missing, not low: both contributors drop out', () => {
    expect(run(series('health_connect', 7, 22, 10, 130))).toEqual({ zoneMinutes: null, moveHours: null, moveHoursGoal: null })
  })

  it('a watch worn for one dense hour scores that hour, and the sparse waking hours leave the goal', () => {
    const watch = series('health_connect', 17, 18, 1, 140)
    const phone = series('health_connect', 8, 17, 10, 75)
    const c = run([...phone, ...watch])
    expect(c.zoneMinutes).toBeGreaterThan(50)
    expect(c.moveHours).toBe(1)
    // 9 sparse waking hours (08:00–16:59) are missing, not unmoved.
    expect(c.moveHoursGoal).toBe(moveHoursGoal() - 9)
  })

  it('an hour the ring covers is not missing even if Health Connect was sparse in it', () => {
    const ring = series('ble', 9, 10, 5, 70)
    const hc = series('health_connect', 9, 10, 20, 70)
    const c = run([...ring, ...hc])
    expect(c.moveHoursGoal).toBe(moveHoursGoal())
  })
})

it('applies the same density rule to native Apple Health as Health Connect', () => {
  expect(run(series('apple_health',7,22,10,130))).toEqual({zoneMinutes:null,moveHours:null,moveHoursGoal:null});
  expect(run(series('apple_health',9,10,5,130))).toEqual(run(series('health_connect',9,10,5,130)));
});
