// Issue 3691 item 1 — the night-temperature maturity count restarts when a source changes its sleep
// algorithm version, as the temperature z's normal has since #3690. Before, it counted every earlier
// deviation of the source across versions, so `temperatureBaselineDays` (the elevated-temperature
// deload gate) and the `night_temperature` row's `baseline_nights` read a mature normal the z did not have.
import { describe, it, expect, vi } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { loadNightTemperature } from '@/lib/health/night-temperature'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-11-08'
const CLOUD = 'oura_cloud'

/** `days` nights of Oura data ending today; nights from `switchBack` days ago on run `v3`, earlier `v2`. */
function repoFor(days: number, switchBack: number | null, opts: { unversionedFrom?: number } = {}) {
  const nights: ({ date: string } & Record<string, unknown>)[] = []
  const ouraDaily: { date: string; temperatureDeviation: number; nonWearTimeSec: number }[] = []
  for (let back = days - 1; back >= 0; back--) {
    const date = shiftDateStr(TODAY, -back)
    const end = new Date(`${date}T06:30:00+10:00`)
    const version = opts.unversionedFrom != null && back <= opts.unversionedFrom ? null
      : switchBack != null && back <= switchBack ? 'v3' : 'v2'
    nights.push({
      id: `s${back}`, userId: 'u1', date, sleepStart: new Date(end.getTime() - 7 * 3_600_000), sleepEnd: end,
      durationHours: 7, deepSleepHours: 1.2, remSleepHours: 1.4, lightSleepHours: 3.9, awakHours: 0.5,
      respiratoryRate: 14, createdAt: end, durationSource: CLOUD, respiratoryRateSource: CLOUD, sourceAlgorithmVersion: version,
    })
    ouraDaily.push({ date, temperatureDeviation: ((back % 7) - 3) / 20, nonWearTimeSec: 1_000 })
  }
  const inRange = <T extends { date: string }>(rows: T[], from: string, to: string) => rows.filter(r => r.date >= from && r.date <= to)
  return {
    getOuraDailySummary: vi.fn(async () => []),
    listBodyMetrics: vi.fn(async () => []),
    listSleepSessions: vi.fn(async (_u: string, from: string, to: string) => inRange(nights, shiftDateStr(from, -1), shiftDateStr(to, 1))),
    getOuraDaily: vi.fn(async (_u: string, from: string, to: string) => inRange(ouraDaily, from, to)),
  }
}

describe('night-temperature maturity count is keyed by algorithm version (#3691)', () => {
  it('counts every earlier night of the window while the source sends one version', async () => {
    const t = await loadNightTemperature(repoFor(70, null) as never, 'u1', TODAY, TZ)
    expect(t.deviationSource).toBe('cloud')
    // The 60-day window, tonight excluded.
    expect(t.baselineNights).toBe(60)
  })

  it('restarts on a new version: only the earlier nights under tonight\'s version count', async () => {
    const t = await loadNightTemperature(repoFor(70, 5) as never, 'u1', TODAY, TZ)
    expect(t.deviationSource).toBe('cloud')
    expect(t.baselineNights).toBe(5)
  })

  it('reaches past 28 days for the version lookup, so a switch 40 days back still keys the count', async () => {
    const t = await loadNightTemperature(repoFor(70, 40) as never, 'u1', TODAY, TZ)
    expect(t.baselineNights).toBe(40)
  })

  it('a night with no version joins the newest version, by the normals\' rule', async () => {
    // v2 until 10 days back, v3 for 10..4 back, then nights with no version: they read as v3.
    const t = await loadNightTemperature(repoFor(70, 10, { unversionedFrom: 3 }) as never, 'u1', TODAY, TZ)
    expect(t.baselineNights).toBe(10)
  })
})
