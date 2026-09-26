/**
 * TN-81 — the verdict the app announces, and the evidence it has to keep.
 *
 * The cases that matter most are the refusals. This feeds a label that the tuning models have
 * never had, and a verdict produced off a thin baseline, or one that judges a night against
 * itself, is worse than no verdict at all — it looks like data.
 */
import { describe, it, expect } from 'vitest'
import {
  sleepVerdictForNight,
  onsetMinutesForNight,
  VERDICT_BASELINE_NIGHTS,
  SLEEP_VERDICT_MODEL_VERSION,
  type VerdictNight,
} from '@trainingai/shared/health/sleep-verdict'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const TARGET = '2026-09-26'

/** `n` ordinary nights ending the day before TARGET. Deliberately not all identical: an IQR of 0
 *  makes every band degenerate, which would let any deviation trigger and hide real bugs. */
function ordinaryNights(n = VERDICT_BASELINE_NIGHTS): VerdictNight[] {
  return Array.from({ length: n }, (_, i) => ({
    date: shiftDateStr(TARGET, -(i + 1)),
    durationHours: 7.5 + (i % 4) * 0.25,     // 7.50 – 8.25
    onsetMinutes: -60 + (i % 4) * 10,        // 23:00 – 23:30
    efficiency: 88 + (i % 4),                // 88 – 91
  }))
}

const night = (over: Partial<VerdictNight> = {}): VerdictNight => ({
  date: TARGET, durationHours: 7.8, onsetMinutes: -45, efficiency: 89, ...over,
})

describe('sleepVerdictForNight', () => {
  it('calls an ordinary night normal, and names no component', () => {
    const r = sleepVerdictForNight(night(), ordinaryNights())
    expect(r?.verdict).toBe('normal')
    expect(r?.triggered).toEqual([])
    expect(r?.modelVersion).toBe(SLEEP_VERDICT_MODEL_VERSION)
  })

  it('calls a short night poor and says which component said so', () => {
    const r = sleepVerdictForNight(night({ durationHours: 5.2 }), ordinaryNights())
    expect(r?.verdict).toBe('poor')
    expect(r?.triggered).toEqual(['duration'])
  })

  it('calls a late night poor even when its LENGTH is ordinary — the composite trap', () => {
    // 01:30, 90 minutes past the usual, at a perfectly normal duration and efficiency.
    const r = sleepVerdictForNight(night({ onsetMinutes: 90 }), ordinaryNights())
    expect(r?.verdict).toBe('poor')
    expect(r?.triggered).toEqual(['onset'])
  })

  it('calls an unusually early, long night good', () => {
    const r = sleepVerdictForNight(night({ durationHours: 9.6, onsetMinutes: -180 }), ordinaryNights())
    expect(r?.verdict).toBe('good')
    expect(r?.triggered).toEqual([])
  })

  it('lets a poor signal outrank a good one, and reports both components honestly', () => {
    // Long, but started two hours late. Flag it; he can disagree in one tap.
    const r = sleepVerdictForNight(night({ durationHours: 9.6, onsetMinutes: 90 }), ordinaryNights())
    expect(r?.verdict).toBe('poor')
    expect(r?.triggered).toEqual(['onset'])
  })

  it('snapshots the values AND the bands it judged them against', () => {
    const r = sleepVerdictForNight(night({ durationHours: 5.2 }), ordinaryNights())
    // Without these a later scoring change rewrites what the correction disagreed with.
    expect(r?.components).toEqual({ duration: 5.2, onset: -45, efficiency: 89 })
    expect(r?.bands.duration?.nights).toBe(VERDICT_BASELINE_NIGHTS)
    expect(r!.bands.duration!.low).toBeGreaterThan(5.2)
    expect(r!.bands.duration!.median).toBeCloseTo(7.875, 3)
  })

  it('refuses to judge anything on a thin baseline', () => {
    expect(sleepVerdictForNight(night(), ordinaryNights(VERDICT_BASELINE_NIGHTS - 1))).toBeNull()
    expect(sleepVerdictForNight(night(), [])).toBeNull()
  })

  it('counts a component window after dropping nulls, not before', () => {
    // 28 nights, but efficiency is missing on four of them: duration is ready, efficiency is not.
    const thin = ordinaryNights().map((n, i) => (i < 4 ? { ...n, efficiency: null } : n))
    const r = sleepVerdictForNight(night({ efficiency: 20 }), thin)
    expect(r?.bands.duration).toBeDefined()
    expect(r?.bands.efficiency).toBeUndefined()
    // A catastrophic efficiency cannot trigger while its own window is short.
    expect(r?.triggered).toEqual([])
  })

  it('never judges a night against itself', () => {
    // Asserted as band EQUALITY, not just a surviving verdict: a single outlier barely moves a
    // 28-value p25, so "still poor" passes whether or not the night is in its own window and
    // proves nothing. The bands are what must be untouched.
    const target = night({ durationHours: 5.2 })
    const clean = sleepVerdictForNight(target, ordinaryNights())
    const contaminated = sleepVerdictForNight(target, [...ordinaryNights(), target])
    expect(contaminated?.bands).toEqual(clean?.bands)
    expect(contaminated?.verdict).toBe('poor')
  })

  it('ignores nights AFTER the one it is judging', () => {
    const future = Array.from({ length: 5 }, (_, i) => ({
      date: shiftDateStr(TARGET, i + 1), durationHours: 4, onsetMinutes: 300, efficiency: 50,
    }))
    const clean = sleepVerdictForNight(night({ durationHours: 5.2 }), ordinaryNights())
    const withFuture = sleepVerdictForNight(night({ durationHours: 5.2 }), [...ordinaryNights(), ...future])
    expect(withFuture?.bands).toEqual(clean?.bands)
  })

  it('uses only the most recent window, so an old regime stops counting', () => {
    const recent = ordinaryNights()
    const ancient = Array.from({ length: 40 }, (_, i) => ({
      date: shiftDateStr(TARGET, -(100 + i)),
      durationHours: 4, onsetMinutes: 240, efficiency: 50,
    }))
    const r = sleepVerdictForNight(night({ durationHours: 5.2 }), [...ancient, ...recent])
    expect(r?.verdict).toBe('poor')
    expect(r?.bands.duration?.nights).toBe(VERDICT_BASELINE_NIGHTS)
  })

  it('tolerates a night whose own value is missing rather than calling it strange', () => {
    const r = sleepVerdictForNight(night({ durationHours: null }), ordinaryNights())
    expect(r?.verdict).toBe('normal')
    expect(r?.components.duration).toBeNull()
  })
})

describe('onsetMinutesForNight', () => {
  const TZ = 'Australia/Brisbane' // UTC+10, no DST

  it('reads a pre-midnight start as negative minutes', () => {
    // 23:10 Brisbane on the 25th = 13:10 UTC on the 25th; wake date is the 26th.
    expect(onsetMinutesForNight('2026-09-25T13:10:00Z', '2026-09-26', TZ)).toBe(-50)
  })

  it('reads an after-midnight start as positive minutes', () => {
    // 00:30 Brisbane on the 26th = 14:30 UTC on the 25th.
    expect(onsetMinutesForNight('2026-09-25T14:30:00Z', '2026-09-26', TZ)).toBe(30)
  })

  it('keeps a 23:50 and a 00:10 start twenty minutes apart, not 1,420', () => {
    const before = onsetMinutesForNight('2026-09-25T13:50:00Z', '2026-09-26', TZ)!
    const after = onsetMinutesForNight('2026-09-25T14:10:00Z', '2026-09-26', TZ)!
    expect(after - before).toBe(20)
  })

  it('reads the USER\'s timezone, not the machine\'s', () => {
    const instant = '2026-09-25T13:10:00Z'
    expect(onsetMinutesForNight(instant, '2026-09-26', 'Australia/Brisbane')).toBe(-50)
    // The same instant is 09:10 the previous morning in New York — a different day entirely.
    expect(onsetMinutesForNight(instant, '2026-09-26', 'America/New_York'))
      .toBe(9 * 60 + 10 - 1440)
  })

  it('returns null for an unparseable timestamp rather than a plausible number', () => {
    expect(onsetMinutesForNight('not-a-date', '2026-09-26', TZ)).toBeNull()
  })
})
