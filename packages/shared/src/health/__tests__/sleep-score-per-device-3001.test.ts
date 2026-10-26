import { describe, it, expect } from 'vitest'
import {
  computeSleepScoreSeries, sleepScoreBaselines, SLEEP_HRV_BASELINE_MIN_NIGHTS,
} from '../sleep-score'
import type { SleepSession } from '../../types/body'

// #3001: the Sleep Score learns its HRV, heart-rate, schedule and awake-fraction normals from the
// device that measured the night, as readiness does (#2991). The ring and Oura read HRV and heart
// rate by different definitions, so an Oura night against a ring-built normal is a change of ruler.
const TZ = 'Australia/Brisbane'
const bne = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour - 10))

const night = (day: number, device: 'oura_ble' | 'oura_cloud', over: Record<string, unknown> = {}): SleepSession => ({
  id: `n${day}`, userId: 'u1', date: `2026-10-${String(day).padStart(2, '0')}`,
  sleepStart: bne(day - 1, 22), sleepEnd: bne(day, 6), createdAt: bne(day, 7),
  durationHours: 8, efficiency: 94, deepSleepHours: 1.3, remSleepHours: 1.9, awakHours: 0.4, onsetLatencySec: 720,
  // The ring's HRV/HR run lower and higher than Oura's for the same sleep.
  averageHrvMs: device === 'oura_ble' ? 45 : 62, avgHeartRate: device === 'oura_ble' ? 52 : 57,
  durationSource: device, hrvSource: device, avgHeartRateSource: device, ...over,
}) as unknown as SleepSession

// 14 ring nights, then 10 Oura nights (the switch is the 15th).
const timeline = [
  ...Array.from({ length: 14 }, (_, i) => night(i + 1, 'oura_ble')),
  ...Array.from({ length: 10 }, (_, i) => night(i + 15, 'oura_cloud')),
]
const pooled = timeline.map(n => ({ ...n, durationSource: undefined, hrvSource: undefined, avgHeartRateSource: undefined }) as SleepSession)

describe('sleepScoreBaselines per device (#3001)', () => {
  const ring = timeline.slice(0, 14)

  it('is unchanged for a single device', () => {
    expect(sleepScoreBaselines(ring, TZ)).toEqual(sleepScoreBaselines(pooled.slice(0, 14), TZ))
    expect(sleepScoreBaselines(ring, TZ).hrvBaselineMs).toBe(45)
  })

  it('leaves the HRV, HR and schedule normals warming up for a night on a new device', () => {
    const firstOura = timeline[14]
    const b = sleepScoreBaselines(ring, TZ, firstOura)
    expect(b.hrvBaselineMs).toBeNull()
    expect(b.hrBaselineBpm).toBeNull()
    expect(b.habitualBedHour).toBeNull()
    expect(b.awakeFractionBaselineMean).toBeNull()
    // Pooled, as before, the ring's 14 nights would have been the Oura night's normal.
    expect(sleepScoreBaselines(pooled.slice(0, 14), TZ).hrvBaselineMs).toBe(45)
  })

  it('learns the new device’s own normal at the gate, and never mixes the ring in', () => {
    const upTo = (n: number) => timeline.slice(0, 14 + n)
    expect(sleepScoreBaselines(upTo(SLEEP_HRV_BASELINE_MIN_NIGHTS - 1), TZ, timeline[14 + SLEEP_HRV_BASELINE_MIN_NIGHTS - 1]).hrvBaselineMs).toBeNull()
    const b = sleepScoreBaselines(upTo(SLEEP_HRV_BASELINE_MIN_NIGHTS), TZ, timeline[14 + SLEEP_HRV_BASELINE_MIN_NIGHTS])
    expect(b.hrvBaselineMs).toBe(62)
    expect(b.hrBaselineBpm).toBe(57)
    expect(b.habitualBedHour).not.toBeNull()
  })

  it('infers the device from the newest prior night when no scored night is given', () => {
    expect(sleepScoreBaselines(timeline.slice(0, 21), TZ).hrvBaselineMs).toBe(62)
    expect(sleepScoreBaselines(timeline.slice(0, 16), TZ).hrvBaselineMs).toBeNull()
  })
})

describe('which nights move (fixture: 14 ring nights, then 10 Oura nights)', () => {
  const scores = (rows: SleepSession[]) => new Map(computeSleepScoreSeries(rows, TZ).map(r => [r.session.date, r.result?.score ?? null]))
  const per = scores(timeline)
  const old = scores(pooled)

  it('moves no ring night, and the Oura nights only until their own normal matures', () => {
    const moved = timeline.filter(n => per.get(n.date) !== old.get(n.date)).map(n => n.date)
    // Ring nights 1-14 are scored on ring priors either way: none moves.
    expect(moved.filter(d => d <= '2026-10-14')).toEqual([])
    // The first 7 Oura nights lose the normals they cannot yet have (the issue's "about 7 Oura
    // nights"). The 8th differs by a point because the pooled window was still half ring nights.
    // From the 9th the two agree. So 8 of the 10 Oura nights move on this fixture.
    expect(moved).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])
  })
})
