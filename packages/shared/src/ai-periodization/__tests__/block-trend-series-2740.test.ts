// Issue 2740: the 28:90 block trend with a line to draw. Synthetic sessions only.
import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { blockTrendBand, computeBlockTrend, computeBlockTrendSeries, BLOCK_TREND_THRESHOLDS, type AcwrSession } from '../acwr'

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
  const base = history(shiftDateStr(TODAY, -89), shiftDateStr(recentStart, -1), 2, 5000)
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
      expect(s).toEqual({ status: 'not_enough_history', ratio: null, band: null, baselineWeeklyKg: null, points: [] })
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
