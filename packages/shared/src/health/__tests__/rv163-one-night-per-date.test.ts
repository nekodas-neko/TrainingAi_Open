// RV-163 — "last night" was picked by four different rules, so a long daytime rest could become
// the night the scores graded.
//
// `ALWAYS_NIGHT_MIN_HOURS` promotes any window over four hours to "night" wherever it sat on the
// clock, so one wake date can carry two night periods. Production, 2026-09-23: an overnight of
// 21:27–06:01 (7.92 h) and a daytime window of 10:42–17:25 (6.17 h). The stored sleep contributors
// matched the DAYTIME one — score 42 against about 76 — and readiness took that 42 as the previous
// night and came out 44. Body Battery anchored its wake at 17:25 and stored 2 HR samples against
// the ring's 203, which is the unidentified trigger TN-20 was left holding.
//
// This is the second time this class has shipped: `nightPeriodsByDate` exists because the BLE
// rollup kept its own last-wins copy of the rule (PS-17, 2026-08-27).
import { describe, it, expect } from 'vitest'
import {
  nightSessions,
  latestNight,
  nightForDate,
  canonicalNightForDate,
  canonicalLatestNight,
  ALWAYS_NIGHT_MIN_HOURS,
} from '../sleep-night'

const TZ = 'Australia/Brisbane'
const at = (iso: string) => new Date(iso)

/** The 2026-09-23 shape: a real overnight, then a long daytime rest on the same wake date. */
const OVERNIGHT = {
  date: '2026-09-23',
  sleepStart: at('2026-09-22T11:27:00Z'), // 21:27 Brisbane
  sleepEnd: at('2026-09-22T20:01:00Z'),   // 06:01 Brisbane
  durationHours: 7.92,
  efficiency: 92,
}
const DAYTIME = {
  date: '2026-09-23',
  sleepStart: at('2026-09-23T00:42:00Z'), // 10:42 Brisbane
  sleepEnd: at('2026-09-23T07:25:00Z'),   // 17:25 Brisbane
  durationHours: 6.17,
  efficiency: 91,
}
const SESSIONS = [OVERNIGHT, DAYTIME]

describe('the premise: one date really can hold two night periods', () => {
  it('both windows clear the always-night floor, so both are classified as night', () => {
    expect(OVERNIGHT.durationHours).toBeGreaterThanOrEqual(ALWAYS_NIGHT_MIN_HOURS)
    expect(DAYTIME.durationHours).toBeGreaterThanOrEqual(ALWAYS_NIGHT_MIN_HOURS)

    const nights = nightSessions(SESSIONS, TZ)
    const onThatDate = nights.filter(n => n.date === '2026-09-23')
    // If this ever returns one, the defect is fixed upstream and the helpers below are redundant —
    // which is a real possibility worth failing loudly for rather than silently protecting.
    expect(onThatDate).toHaveLength(2)
  })
})

describe('the canonical rule picks the longer window, not the later one', () => {
  it('nightForDate takes the overnight', () => {
    const picked = nightForDate(SESSIONS, '2026-09-23', TZ)
    expect(picked?.windows[0]?.durationHours).toBe(OVERNIGHT.durationHours)
  })

  it('latestNight takes the overnight too — the date is resolved first, then the tie', () => {
    // The old body was `nights[nights.length - 1]`, which is the DAYTIME window: it ran later.
    const picked = latestNight(SESSIONS, TZ)
    expect(picked?.date).toBe('2026-09-23')
    expect(picked?.windows[0]?.durationHours).toBe(OVERNIGHT.durationHours)
  })
})

describe('the aggregated-array helpers agree with it', () => {
  const nights = nightSessions(SESSIONS, TZ)

  it('canonicalNightForDate takes the longer of the two', () => {
    expect(canonicalNightForDate(nights, '2026-09-23')?.durationHours).toBe(7.92)
  })

  it('canonicalLatestNight takes the same one', () => {
    expect(canonicalLatestNight(nights)?.durationHours).toBe(7.92)
  })

  it('and the naive picks every consumer used would have taken the daytime rest', () => {
    // Pinned so the fix cannot be quietly reverted into "it was the same all along".
    expect(nights[nights.length - 1].durationHours).toBe(6.17)            // readiness, progress-summary
    expect(nights.findLast(n => n.date === '2026-09-23')!.durationHours).toBe(6.17) // body battery
    // The earliest-pick sites happened to be right HERE, and only by ordering — `nightSessions` is
    // oldest-first, so `.find` landed on the overnight. That is luck, not a rule: a date whose
    // daytime window is recorded first flips it. Asserting it keeps the accident visible.
    expect(nights.find(n => n.date === '2026-09-23')!.durationHours).toBe(7.92)
  })

  it('a date with one night is unaffected, whichever helper asks', () => {
    const single = nightSessions([OVERNIGHT], TZ)
    expect(canonicalNightForDate(single, '2026-09-23')?.durationHours).toBe(7.92)
    expect(canonicalLatestNight(single)?.durationHours).toBe(7.92)
  })

  it('an empty history is null rather than a throw', () => {
    expect(canonicalLatestNight([])).toBeNull()
    expect(canonicalNightForDate([], '2026-09-23')).toBeNull()
  })

  it('canonicalLatestNight resolves the DATE first, so an older long night never wins', () => {
    // The trap in the other direction: picking the longest across the whole history would return a
    // 9-hour night from last week as "last night".
    // Real timestamps a week earlier, NOT a copy with the `date` field edited: `groupSleepPeriods`
    // derives the date from `sleepEnd` and stitches windows that are close together, so a clone
    // with the same clock times merges into one 17.42 h night instead of being a separate one.
    const lastWeek = {
      date: '2026-09-16',
      sleepStart: at('2026-09-15T11:00:00Z'),
      sleepEnd: at('2026-09-15T20:30:00Z'),
      durationHours: 9.5,
      efficiency: 95,
    }
    const nights2 = nightSessions([lastWeek, OVERNIGHT, DAYTIME], TZ)
    expect(canonicalLatestNight(nights2)?.date).toBe('2026-09-23')
    expect(canonicalLatestNight(nights2)?.durationHours).toBe(7.92)
  })
})
