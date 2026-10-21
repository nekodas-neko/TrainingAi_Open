// Issue 2740: the 28:90 block trend with a line to draw. Synthetic sessions only.
import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { blockTrendBand, computeBlockTrend, computeBlockTrendSeries, computeVolumeAcwr, BLOCK_TREND_THRESHOLDS, type AcwrSession } from '../acwr'

const TZ = 'Australia/Brisbane'
const TODAY = '2026-10-21'
const at = (day: string) => new Date(dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000) // local midday

/** `perDay` kg on every `every`-th day from `from` to `to` inclusive. */
function history(from: string, to: string, every: number, perDay: number): AcwrSession[] {
  const out: AcwrSession[] = []
  for (let d = from, i = 0; d <= to; d = shiftDateStr(d, 1), i++) if (i % every === 0) out.push({ startedAt: at(d), volumeKg: perDay })
  return out
}

/** 62 days of a steady base, then the last 28 days scaled so the 28:90 ratio lands near `target`. */
function withRecentFactor(factor: number): AcwrSession[] {
  const recentStart = shiftDateStr(TODAY, -27)
  const base = history(shiftDateStr(TODAY, -90), shiftDateStr(recentStart, -1), 2, 5000)
  const recent = history(recentStart, TODAY, 2, 5000 * factor)
  return [...base, ...recent]
}

describe('computeBlockTrendSeries', () => {
  it('agrees with computeBlockTrend on the headline ratio and band', () => {
    const sessions = withRecentFactor(1.5)
    const series = computeBlockTrendSeries(sessions, TODAY, { tz: TZ })
    const direct = computeBlockTrend(sessions, dateStrMidnightInTz(TODAY, TZ), { tz: TZ })
    expect(series.ratio).toBe(direct.ratio)
    expect(series.band).toBe(direct.band)
    expect(series.status).toBe('ok')
  })

  it('ends the line on the headline ratio, one point per week, oldest first', () => {
    const series = computeBlockTrendSeries(withRecentFactor(1.5), TODAY, { tz: TZ })
    expect(series.points).toHaveLength(10)
    expect(series.points.at(-1)).toEqual({ date: TODAY, ratio: expect.closeTo(series.ratio!, 10) })
    expect(series.points.map(p => p.date)).toEqual(
      Array.from({ length: 10 }, (_, i) => shiftDateStr(TODAY, -7 * (9 - i))),
    )
  })

  it('rises across the line when the last month is heavier than the base', () => {
    const { points } = computeBlockTrendSeries(withRecentFactor(2), TODAY, { tz: TZ })
    expect(points[0].ratio).toBeLessThan(points.at(-1)!.ratio)
  })

  it('reports the 90-day weekly baseline the ratio divides by', () => {
    const s = computeBlockTrendSeries(history(shiftDateStr(TODAY, -89), TODAY, 2, 4000), TODAY, { tz: TZ })
    // 45 sessions × 4000 kg over a 89-day span (12.7 weeks)
    expect(s.baselineWeeklyKg).toBeCloseTo((45 * 4000) / (89 / 7), 3)
    expect(s.ratio).toBeCloseTo(1, 1)
  })

  describe('band edges (0.8 and 1.2, both inside steady)', () => {
    const bandAt = (factor: number) => computeBlockTrendSeries(withRecentFactor(factor), TODAY, { tz: TZ })
    it('reads detraining well under 0.8, building well over 1.2, steady in between', () => {
      expect(bandAt(0.3).band).toBe('detraining')
      expect(bandAt(1).band).toBe('steady')
      expect(bandAt(2.5).band).toBe('building')
    })
    it('treats exactly 0.8 and exactly 1.2 as steady, and the series uses the same edges', () => {
      expect(BLOCK_TREND_THRESHOLDS).toEqual({ detrainingMax: 0.8, buildingMin: 1.2 })
      expect(blockTrendBand(0.8)).toBe('steady')
      expect(blockTrendBand(0.7999)).toBe('detraining')
      expect(blockTrendBand(1.2)).toBe('steady')
      expect(blockTrendBand(1.2001)).toBe('building')
      for (const f of [0.3, 0.6, 0.9, 1, 1.1, 1.4, 2.5]) {
        const s = bandAt(f)
        expect(s.band, `factor ${f}`).toBe(blockTrendBand(s.ratio!))
      }
    })
  })

  describe('sparse history is not a number', () => {
    it('says not_enough_history for a 30-day history', () => {
      const s = computeBlockTrendSeries(history(shiftDateStr(TODAY, -29), TODAY, 2, 5000), TODAY, { tz: TZ })
      expect(s).toEqual({ status: 'not_enough_history', ratio: null, band: null, baselineWeeklyKg: null, spanDays: 29, points: [] })
    })
    it('says not_enough_history for no sessions at all', () => {
      expect(computeBlockTrendSeries([], TODAY, { tz: TZ }).status).toBe('not_enough_history')
    })
    it('says not_enough_history for a long span with too few sessions', () => {
      const few = [-89, -60, -30, 0].map(n => ({ startedAt: at(shiftDateStr(TODAY, n)), volumeKg: 5000 }))
      expect(computeBlockTrendSeries(few, TODAY, { tz: TZ }).ratio).toBeNull()
    })
  })
})

describe('a short history does not start the line in detraining', () => {
  it('drops the weeks whose 28-day window reaches before the first logged day', () => {
    const s = computeBlockTrendSeries(history(shiftDateStr(TODAY, -69), TODAY, 2, 5000), TODAY, { tz: TZ })
    expect(s.status).toBe('ok')
    expect(s.band).toBe('steady')
    expect(s.points.length).toBeGreaterThan(0)
    expect(s.points.length).toBeLessThan(10)
    for (const p of s.points) {
      expect(p.ratio, p.date).toBeGreaterThanOrEqual(BLOCK_TREND_THRESHOLDS.detrainingMax)
      expect(blockTrendBand(p.ratio), p.date).toBe('steady')
    }
    expect(s.points.at(-1)!.date).toBe(TODAY)
  })

  it('keeps every point once the history reaches day -90', () => {
    expect(computeBlockTrendSeries(history(shiftDateStr(TODAY, -90), TODAY, 2, 5000), TODAY, { tz: TZ }).points).toHaveLength(10)
  })
})

describe('the 68-day gate is the shared loadRatio gate, and the span is reported', () => {
  const sinceDaysAgo = (n: number) => computeBlockTrendSeries(history(shiftDateStr(TODAY, -n), TODAY, 2, 5000), TODAY, { tz: TZ })
  it('67 days of history is not enough, 68 is a number', () => {
    const short = sinceDaysAgo(67)
    expect(short.status).toBe('not_enough_history')
    expect(short.ratio).toBeNull()
    expect(short.spanDays).toBe(67)
    const enough = sinceDaysAgo(68)
    expect(enough.status).toBe('ok')
    expect(enough.ratio).not.toBeNull()
    expect(enough.spanDays).toBe(68)
  })
  it('reports the span on a full history too', () => {
    expect(sinceDaysAgo(89).spanDays).toBe(89)
  })
})

describe('local-day boundaries away from Brisbane (America/Los_Angeles, DST ends 2026-11-01)', () => {
  const LA = 'America/Los_Angeles'
  const LA_TODAY = '2026-11-02'
  const clock = (day: string, hh: number, mm: number) => new Date(dateStrMidnightInTz(day, LA).getTime() + (hh * 60 + mm) * 60_000)
  const base = (): AcwrSession[] => {
    const out: AcwrSession[] = []
    for (let i = 0; i <= 80; i += 2) {
      const day = shiftDateStr(LA_TODAY, -i)
      out.push({ startedAt: clock(day, i % 4 === 0 ? 23 : 0, i % 4 === 0 ? 59 : 1), volumeKg: 5000 })
    }
    return out
  }
  const run = (extra: AcwrSession[] = []) => computeBlockTrendSeries([...base(), ...extra], LA_TODAY, { tz: LA })

  it('ends the line on computeBlockTrend with 23:59 and 00:01 sessions across the DST change', () => {
    const sessions = base()
    const series = computeBlockTrendSeries(sessions, LA_TODAY, { tz: LA })
    const direct = computeBlockTrend(sessions, dateStrMidnightInTz(LA_TODAY, LA), { tz: LA })
    expect(series.status).toBe('ok')
    expect(series.ratio).toBe(direct.ratio)
    expect(series.band).toBe(direct.band)
    expect(series.points.at(-1)!.ratio).toBeCloseTo(direct.ratio!, 10)
  })

  it('counts a 00:01 session on day -90 and ignores a 23:59 session on day -91', () => {
    const none = run()
    const day90 = run([{ startedAt: clock(shiftDateStr(LA_TODAY, -90), 0, 1), volumeKg: 10_000 }])
    const day91 = run([{ startedAt: clock(shiftDateStr(LA_TODAY, -91), 23, 59), volumeKg: 10_000 }])
    expect(day90.baselineWeeklyKg).not.toBe(none.baselineWeeklyKg)
    expect(day90.spanDays).toBe(90)
    expect(day91.baselineWeeklyKg).toBe(none.baselineWeeklyKg)
    expect(day91.spanDays).toBe(none.spanDays)
  })
})

describe('the 90-day fetch does not move the existing ACWR numbers', () => {
  it('returns identical 7:28 results for 28-day and 90-day inputs of the same sessions', () => {
    const all = history(shiftDateStr(TODAY, -120), TODAY, 2, 5000)
    const mid = dateStrMidnightInTz(TODAY, TZ)
    const from = (n: number) => dateStrMidnightInTz(shiftDateStr(TODAY, -n), TZ).getTime()
    const run = (n: number) => computeVolumeAcwr(all.filter(x => x.startedAt.getTime() >= from(n)), mid, { tz: TZ })
    const a = run(28), b = run(90)
    for (const k of ['acwr', 'acuteLoadKg', 'chronicWeeklyAvgKg', 'dataSpanWeeks', 'todayVolumeKg', 'typicalSessionVolumeKg'] as const) {
      expect(b[k], k).toBe(a[k])
    }
    expect(a.acwr).not.toBeNull()
  })
})
