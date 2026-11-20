// #2860 F1 step 1: the stress-day route serves the ring's stored buckets where a day has them, and from
// the switch day on computes a series from heart rate while still, through the generic shapes only.
import { describe, it, expect, vi } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import type { MovementIntervalSeries } from '@trainingai/shared/health/per-minute-movement'
import { readStressDay, type StressDayRepo } from '../stress-day'

const TZ = 'Australia/Brisbane'
const SWITCH = '2026-10-17'
const DAY = '2026-10-21'
const mid = (d: string) => dateStrMidnightInTz(d, TZ).getTime()
const at = (h: number, m = 0) => mid(DAY) + (h * 60 + m) * 60_000

/** One movement series covering the local day at one value a minute, still (MET 1.1) except 12:00–13:00. */
function movement(): MovementIntervalSeries[] {
  const mets = Array.from({ length: 24 * 60 }, (_, i) => (i >= 12 * 60 && i < 13 * 60 ? 4 : 1.1))
  return [{ source: 'generic_test', startMs: mid(DAY), intervalMs: 60_000, mets, notWorn: [] }]
}

/** Heart rate every 2 minutes 07:00–21:00: 60 bpm, 72 bpm from 15:00 to 16:00. */
function heartRate() {
  const out: { timestamp: Date; bpm: number; source: string | null }[] = []
  for (let t = at(7); t < at(21); t += 120_000) {
    out.push({ timestamp: new Date(t + 30_000), bpm: t >= at(15) && t < at(16) ? 72 : 60, source: 'generic_test' })
  }
  return out
}

function repo(opts: { stored?: { bucketMid: Date; level: number }[]; switchDay?: string | null; normalDays?: number } = {}) {
  const normalDays = opts.normalDays ?? 10
  const r = {
    getOuraDaytimeStressBuckets: vi.fn(async () => opts.stored ?? []),
    getOuraCloudSwitchDay: vi.fn(async () => (opts.switchDay === undefined ? SWITCH : opts.switchDay)),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      heartRate().filter(h => h.timestamp >= from && h.timestamp < to)),
    getPerMinuteMovementSeries: vi.fn(async () => movement()),
    listSleepSessions: vi.fn(async () => [{ sleepStart: new Date(at(-2)), sleepEnd: new Date(at(6, 30)) }]),
    getOuraDailyDerived: vi.fn(async () =>
      Array.from({ length: normalDays }, (_, i) => ({ day: shiftDateStr(DAY, -(i + 1)), stillRhrBpm: 60 }))),
  }
  return r as typeof r & StressDayRepo
}

const NOW = new Date(at(23, 59))

describe('readStressDay (#2860 F1 step 1)', () => {
  it('computes a still-heart-rate series after the switch, stressed where the still heart rate ran high', async () => {
    const r = repo()
    const out = await readStressDay(r, 'u', DAY, TZ, NOW)
    expect(out.method).toBe('still_hr')
    // 07:00–21:00 is 28 half hours; the active hour and the minute after it drop 12:00–13:00's two.
    expect(out.series.length).toBe(26)
    expect(out.series.every(p => p.t > at(7) && p.t < at(21))).toBe(true)
    expect(out.series.some(p => p.t > at(12) && p.t < at(13))).toBe(false)
    const stressed = out.series.filter(p => p.level < 0).map(p => p.t)
    expect(stressed).toEqual([at(15, 15), at(15, 45)])
    expect(out.series.find(p => p.t === at(15, 15))!.level).toBe(-1)
    // Read only through the generic shapes: merged heart rate and the movement series.
    expect(r.getHrForWindow).toHaveBeenCalledTimes(1)
    expect(r.getPerMinuteMovementSeries).toHaveBeenCalledWith('u', shiftDateStr(DAY, -1), DAY)
  })

  it('serves the stored ring buckets as they are wherever a day has them, and never computes over them', async () => {
    const stored = [{ bucketMid: new Date(at(9, 15)), level: -0.4 }, { bucketMid: new Date(at(9, 45)), level: 0.2 }]
    const r = repo({ stored })
    const out = await readStressDay(r, 'u', DAY, TZ, NOW)
    expect(out).toEqual({ method: 'ring_dhrv', series: [{ t: at(9, 15), level: -0.4 }, { t: at(9, 45), level: 0.2 }] })
    expect(r.getHrForWindow).not.toHaveBeenCalled()
  })

  it('computes nothing for a day before the switch, or with no switch at all', async () => {
    for (const switchDay of ['2026-10-22', null]) {
      const r = repo({ switchDay })
      expect(await readStressDay(r, 'u', DAY, TZ, NOW)).toEqual({ series: [], method: null })
      expect(r.getHrForWindow).not.toHaveBeenCalled()
    }
  })

  it('draws nothing until the still-time normal has enough prior days', async () => {
    expect(await readStressDay(repo({ normalDays: 2 }), 'u', DAY, TZ, NOW)).toEqual({ series: [], method: null })
  })

  it('today reads heart rate only up to now', async () => {
    const r = repo()
    const out = await readStressDay(r, 'u', DAY, TZ, new Date(at(10)))
    expect(r.getHrForWindow.mock.calls[0][2]).toEqual(new Date(at(10)))
    expect(out.series.every(p => p.t < at(10))).toBe(true)
  })
})
