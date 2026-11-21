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

type DerivedRow = { day: string; stillRhrBpm: number | null }

function repo(opts: {
  stored?: { bucketMid: Date; level: number }[]; switchDay?: string | null; normalDays?: number
  /** Rows returned whatever range is asked for, as a repo that ignored its arguments would. */
  derivedIgnoringRange?: DerivedRow[]
  workouts?: { id: string; startedAt: Date; completedAt: Date | null }[]
  activities?: { date: string; startTime?: string; endTime?: string; durationMin?: number }[]
} = {}) {
  const normalDays = opts.normalDays ?? 10
  // What is stored: `normalDays` prior days at 60 bpm, then outliers on the day itself and on every day
  // older than the fortnight. A read that asks for the wrong range picks an outlier up.
  const storedDays: DerivedRow[] = [
    { day: DAY, stillRhrBpm: 200 },
    ...Array.from({ length: normalDays }, (_, i) => ({ day: shiftDateStr(DAY, -(i + 1)), stillRhrBpm: 60 })),
    ...Array.from({ length: 30 }, (_, i) => ({ day: shiftDateStr(DAY, -(15 + i)), stillRhrBpm: 200 })),
  ]
  const r = {
    getOuraDaytimeStressBuckets: vi.fn(async () => opts.stored ?? []),
    getOuraCloudSwitchDay: vi.fn(async () => (opts.switchDay === undefined ? SWITCH : opts.switchDay)),
    getHrForWindow: vi.fn(async (_u: string, from: Date, to: Date) =>
      heartRate().filter(h => h.timestamp >= from && h.timestamp < to)),
    getPerMinuteMovementSeries: vi.fn(async () => movement()),
    listSleepSessions: vi.fn(async () => [{ sleepStart: new Date(at(-2)), sleepEnd: new Date(at(6, 30)) }]),
    getOuraDailyDerived: vi.fn(async (_u: string, from: string, to: string) =>
      opts.derivedIgnoringRange ?? storedDays.filter(r => r.day >= from && r.day <= to)),
    listCompletedSessionsOverlapping: vi.fn(async () => opts.workouts ?? []),
    listActivityLogs: vi.fn(async () => opts.activities ?? []),
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
    expect(out).toEqual({
      method: 'ring_dhrv', series: [{ t: at(9, 15), level: -0.4 }, { t: at(9, 45), level: 0.2 }], moving: [], asleep: [],
    })
    expect(r.getHrForWindow).not.toHaveBeenCalled()
  })

  it('computes nothing for a day before the switch, or with no switch at all', async () => {
    for (const switchDay of ['2026-10-22', null]) {
      const r = repo({ switchDay })
      expect(await readStressDay(r, 'u', DAY, TZ, NOW)).toEqual({ series: [], method: null, moving: [], asleep: [] })
      expect(r.getHrForWindow).not.toHaveBeenCalled()
    }
  })

  it('draws nothing until the still-time normal has enough prior days', async () => {
    expect(await readStressDay(repo({ normalDays: 2 }), 'u', DAY, TZ, NOW)).toEqual({ series: [], method: null, moving: [], asleep: [] })
  })

  it('the normal is the fortnight before the day, never the day itself', async () => {
    const r = repo()
    const out = await readStressDay(r, 'u', DAY, TZ, NOW)
    expect(r.getOuraDailyDerived).toHaveBeenCalledWith('u', shiftDateStr(DAY, -14), shiftDateStr(DAY, -1))
    // 60 bpm against a normal of 60: level 0. An outlier in the normal would move it.
    expect(out.series.find(p => p.t === at(9, 15))!.level).toBe(0)

    // A repo that hands back the day's own row anyway: it is dropped before the median.
    const sloppy = repo({ derivedIgnoringRange: [
      { day: shiftDateStr(DAY, -3), stillRhrBpm: 58 }, { day: shiftDateStr(DAY, -2), stillRhrBpm: 60 },
      { day: shiftDateStr(DAY, -1), stillRhrBpm: 62 }, { day: DAY, stillRhrBpm: 200 },
    ] })
    const kept = await readStressDay(sloppy, 'u', DAY, TZ, NOW)
    expect(kept.series.find(p => p.t === at(9, 15))!.level).toBe(0)
  })

  it('today reads heart rate only up to now', async () => {
    const r = repo()
    const out = await readStressDay(r, 'u', DAY, TZ, new Date(at(10)))
    expect(r.getHrForWindow.mock.calls[0][2]).toEqual(new Date(at(10)))
    expect(out.series.every(p => p.t < at(10))).toBe(true)
  })

  it('returns the moving half hours and the day\'s sleep, clipped to the day, for the chart\'s strip (#3939)', async () => {
    const out = await readStressDay(repo(), 'u', DAY, TZ, NOW)
    // MET 4 from 12:00 to 13:00, and the minute after it falls in 13:00–13:30, which still gets a level.
    expect(out.moving).toEqual([{ startMs: at(12), endMs: at(13) }])
    // The night began before midnight; the strip starts at the day's start.
    expect(out.asleep).toEqual([{ startMs: at(0), endMs: at(6, 30) }])
  })

  it('leaves out a recorded workout and a logged activity, each with 15 minutes after it (#3938 item 3)', async () => {
    // Heart rate runs high 15:00–16:00 while still; a workout 14:20–14:55 and an activity log 15:30–15:40.
    const base = await readStressDay(repo(), 'u', DAY, TZ, NOW)
    expect(base.series.map(p => p.t)).toContain(at(15, 15))
    const r = repo({
      workouts: [{ id: 'w', startedAt: new Date(at(14, 20)), completedAt: new Date(at(14, 55)) }],
      activities: [{ date: DAY, startTime: '15:30', endTime: '15:40' }],
    })
    const out = await readStressDay(r, 'u', DAY, TZ, NOW)
    // 14:20–15:10 and 15:30–15:55 are out: 14:00–14:30 keeps 10 still minutes, 14:30–15:00 none,
    // 15:00–15:30 keeps 15:10–15:30, 15:30–16:00 only 15:55–16:00.
    const ts = out.series.map(p => p.t)
    expect(ts).not.toContain(at(14, 45))
    expect(ts).not.toContain(at(15, 45))
    expect(out.moving).toContainEqual({ startMs: at(14, 30), endMs: at(15, 0) })
    expect(r.listCompletedSessionsOverlapping).toHaveBeenCalledWith('u', new Date(mid(DAY)), new Date(mid(shiftDateStr(DAY, 1))), 50)
    expect(r.listActivityLogs).toHaveBeenCalledWith('u', shiftDateStr(DAY, -1), DAY)
  })
})
