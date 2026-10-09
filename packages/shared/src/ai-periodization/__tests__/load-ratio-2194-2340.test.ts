// Issue 2194 (the ACWR acute window from 8 days to 7) and issue 2340 (one `loadRatio` for every
// training-load window, and the additive 28:90 block trend). Both owner-signed.
//
// The replay below is the committed harness for the days-moved figure: it replays a synthetic
// history (fixtures/load-history.ts) day by day, as of the end of each day, and compares against
// the per-day ACWR that `main` produced before this change (fixtures/acwr-main-2194.json, captured
// from the pre-change `computeVolumeAcwr` on the same fixture, rounded to 4 dp).
import { describe, it, expect } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import {
  acwrBand, blockTrendBand, computeBlockTrend, computeVolumeAcwr, loadRatio, LOAD_WINDOW_DAYS,
  ACWR_THRESHOLDS, type AcwrSession,
} from '../acwr'
import { FIXTURE_TZ, fixtureDays, fixtureLoadHistory } from './fixtures/load-history'
import mainAcwr from './fixtures/acwr-main-2194.json'

const DAY = 86_400_000
const round4 = (x: number) => Math.round(x * 1e4) / 1e4

/** ACWR for every fixture day, as of the end of that day, the way every live caller frames it. */
function replay(): Record<string, number | null> {
  const sessions = fixtureLoadHistory()
  const out: Record<string, number | null> = {}
  for (const d of fixtureDays()) {
    const mid = dateStrMidnightInTz(d, FIXTURE_TZ)
    const end = dateStrMidnightInTz(shiftDateStr(d, 1), FIXTURE_TZ)
    const window = sessions.filter(s => s.startedAt.getTime() >= mid.getTime() - 28 * DAY && s.startedAt < end)
    const a = computeVolumeAcwr(window, mid, { tz: FIXTURE_TZ }).acwr
    out[d] = a == null ? null : round4(a)
  }
  return out
}

describe('issue 2194: the acute window is 7 local days, today inclusive', () => {
  const before = mainAcwr as Record<string, number | null>
  const after = replay()
  const trainedDays = new Set(fixtureLoadHistory().filter(s => s.volumeKg > 0).map(s => toAestDay(s.startedAt, FIXTURE_TZ)))

  it('moves exactly the days whose eighth day back held a session, and moves them down', () => {
    for (const d of Object.keys(before)) {
      const was = before[d], now = after[d]
      // The gates read the chronic window only, which did not change, so no day gains or loses a ratio.
      expect(now == null, d).toBe(was == null)
      if (was == null || now == null) continue
      if (trainedDays.has(shiftDateStr(d, -7))) expect(now, d).toBeLessThan(was)
      else expect(now, d).toBe(was)
    }
  })

  it('states the days moved on the fixture history', () => {
    const scored = Object.keys(before).filter(d => before[d] != null)
    const moved = scored.filter(d => before[d] !== after[d])
    const bandChanged = scored.filter(d => acwrBand(before[d]!).key !== acwrBand(after[d]!).key)
    const at = (m: Record<string, number | null>, f: (x: number) => boolean) => scored.filter(d => f(m[d]!)).length
    const early = (x: number) => x >= ACWR_THRESHOLDS.elevatedMin
    const hard = (x: number) => x > ACWR_THRESHOLDS.highMax
    expect({
      scored: scored.length,
      moved: moved.length,
      bandChanged: bandChanged.length,
      earlyDeloadLine: [at(before, early), at(after, early)],
      earlyDeloadCrossed: scored.filter(d => early(before[d]!) !== early(after[d]!)).length,
      hardActionLine: [at(before, hard), at(after, hard)],
      hardActionCrossed: scored.filter(d => hard(before[d]!) !== hard(after[d]!)).length,
    }).toEqual({
      scored: 170,
      moved: 67,
      bandChanged: 40,
      earlyDeloadLine: [54, 29],
      earlyDeloadCrossed: 25,
      hardActionLine: [17, 10],
      hardActionCrossed: 7,
    })
  })

  it('is idempotent: a second replay of the same history gives the same scores', () => {
    expect(replay()).toEqual(after)
  })

  // Brisbane has no DST, so a local midnight is a fixed UTC instant: 2026-07-01 00:00 = 06-30 14:00Z.
  it('counts a session at 00:01 six local days back and not one at 23:59 the night before', () => {
    const tz = 'Australia/Brisbane'
    const today = dateStrMidnightInTz('2026-07-01', tz)
    const at = (day: string, hh: number, mm: number) => new Date(dateStrMidnightInTz(day, tz).getTime() + (hh * 60 + mm) * 60_000)
    const inside: AcwrSession = { startedAt: at('2026-06-25', 0, 1), volumeKg: 1000 }
    const outside: AcwrSession = { startedAt: at('2026-06-24', 23, 59), volumeKg: 500 }
    expect(computeVolumeAcwr([inside, outside], today, { tz }).acuteLoadKg).toBe(1000)
  })

  // The acute window starts at a LOCAL midnight. Across a DST change, `todayMid − 6×24h` lands an
  // hour off it: in spring it would admit the evening before; in autumn drop the first hour.
  it('starts at the local midnight across the spring-forward change (Sydney, 2026-10-04)', () => {
    const tz = 'Australia/Sydney'
    const today = dateStrMidnightInTz('2026-10-08', tz)                    // AEDT, UTC+11
    const windowStart = dateStrMidnightInTz('2026-10-02', tz)              // AEST, UTC+10
    expect(windowStart.toISOString()).toBe('2026-10-01T14:00:00.000Z')
    const lateTheNightBefore: AcwrSession = { startedAt: new Date('2026-10-01T13:30:00.000Z'), volumeKg: 500 }  // 10-01 23:30
    const justAfter: AcwrSession = { startedAt: new Date('2026-10-01T14:30:00.000Z'), volumeKg: 1000 }         // 10-02 00:30
    expect(computeVolumeAcwr([lateTheNightBefore, justAfter], today, { tz }).acuteLoadKg).toBe(1000)
  })

  it('starts at the local midnight across the fall-back change (Sydney, 2026-04-05)', () => {
    const tz = 'Australia/Sydney'
    const today = dateStrMidnightInTz('2026-04-08', tz)                    // AEST, UTC+10
    const windowStart = dateStrMidnightInTz('2026-04-02', tz)              // AEDT, UTC+11
    expect(windowStart.toISOString()).toBe('2026-04-01T13:00:00.000Z')
    const firstHour: AcwrSession = { startedAt: new Date('2026-04-01T13:30:00.000Z'), volumeKg: 1000 }         // 04-02 00:30
    const nightBefore: AcwrSession = { startedAt: new Date('2026-04-01T12:30:00.000Z'), volumeKg: 500 }        // 04-01 23:30
    expect(computeVolumeAcwr([firstHour, nightBefore], today, { tz }).acuteLoadKg).toBe(1000)
  })

  it('keeps every threshold where it was', () => {
    expect(ACWR_THRESHOLDS).toEqual({ veryLowMax: 0.6, lowMax: 0.8, optimalMax: 1.3, elevatedMin: 1.2, highMax: 1.5 })
    expect(LOAD_WINDOW_DAYS).toEqual({ acute: 7, chronic: 28, block: 90 })
  })
})

describe('issue 2340: one loadRatio for every window', () => {
  const tz = FIXTURE_TZ
  const today = dateStrMidnightInTz('2026-09-30', tz)
  /** One session at local 07:00 on each of `days` days back (1 = yesterday), at `kg(daysBack)`. */
  const history = (days: number, kg: (daysBack: number) => number): AcwrSession[] =>
    Array.from({ length: days }, (_, i) => ({
      startedAt: new Date(dateStrMidnightInTz(shiftDateStr('2026-09-30', -(i + 1)), tz).getTime() + 7 * 3_600_000),
      volumeKg: kg(i + 1),
    }))

  it('the ACWR is the 7:28 loadRatio', () => {
    const sessions = fixtureLoadHistory()
    for (const d of fixtureDays().filter((_, i) => i % 9 === 0)) {
      const mid = dateStrMidnightInTz(d, tz)
      const window = sessions.filter(s => s.startedAt < new Date(mid.getTime() + DAY))
      expect(computeVolumeAcwr(window, mid, { tz }).acwr).toBe(loadRatio(window, 7, 28, mid, { tz }).ratio)
    }
  })

  it('28:90 reads a block falling by a third as detraining', () => {
    // 9 000 kg/week for the older 62 days, then 6 000 kg/week for the last 28.
    const r = computeBlockTrend(history(90, back => (back <= 28 ? 6000 : 9000) / 7), today, { tz })
    expect(r.ratio).not.toBeNull()
    expect(r.ratio!).toBeLessThan(0.8)
    expect(r.band).toBe('detraining')
  })

  it('28:90 reads steady training as steady and a rising block as building', () => {
    expect(computeBlockTrend(history(90, () => 1000), today, { tz }).band).toBe('steady')
    expect(computeBlockTrend(history(90, back => (back <= 28 ? 2000 : 1000)), today, { tz }).band).toBe('building')
  })

  it('28:90 ignores sessions older than its 90-day window', () => {
    const recent = history(90, () => 1000)
    const ancient = history(200, () => 50_000).slice(100)
    expect(computeBlockTrend([...recent, ...ancient], today, { tz })).toEqual(computeBlockTrend(recent, today, { tz }))
  })

  it('28:90 is withheld until about three quarters of the 90 days hold history', () => {
    expect(computeBlockTrend(history(60, () => 1000), today, { tz })).toEqual({ ratio: null, band: null })
    expect(computeBlockTrend(history(70, () => 1000), today, { tz }).ratio).not.toBeNull()
  })

  it('bands 28:90 at the owner-approved starting points', () => {
    expect(blockTrendBand(0.79)).toBe('detraining')
    expect(blockTrendBand(0.8)).toBe('steady')
    expect(blockTrendBand(1.2)).toBe('steady')
    expect(blockTrendBand(1.21)).toBe('building')
  })
})
