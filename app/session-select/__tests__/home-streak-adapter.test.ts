// LA-156 — Home's streak reads the shared formula, and its keys survive the trip.
//
// The card used to carry its own copy of the calendar-day rule with the rest gap hardcoded to 2.
// That is the FLOOR, not the answer: `streakRestGapFor` raises it from the user's schedule, so a
// Mon+Tue week gets 5 (BF-122a) — and Home, never reading the schedule, under-reported against
// `/api/achievements` for a weekly user.
//
// **The slash case is the one that would have shipped silently.** Home's keys come from
// `dayKeyInTz`, which ends `.replace(/-/g, '/')`, while `computeDayStreak` parses
// `${d}T00:00:00Z` — and `Date.parse('2026/09/27T00:00:00Z')` is NaN. Nothing throws; every gap
// is NaN, every comparison is false, and the card prints a wrong number.
import { describe, it, expect } from 'vitest'
import { computeStreak } from '../compute-streak'

/** Home's own key format — slashes, from `dayKeyInTz`. */
const days = (...keys: string[]) => Object.fromEntries(keys.map(k => [k, ['Push']]))

describe("Home's streak adapter", () => {
  it('counts calendar days from slash keys, which is the format Home actually holds', () => {
    // Three consecutive trained days ending today: the span is 3 calendar days.
    expect(computeStreak(days('2026/09/25', '2026/09/26', '2026/09/27'), '2026/09/27', null)).toBe(3)
  })

  it('does not silently return 0 or NaN when the separator is a slash', () => {
    const n = computeStreak(days('2026/09/26', '2026/09/27'), '2026/09/27', null)
    expect(Number.isNaN(n)).toBe(false)
    expect(n).toBeGreaterThan(0)
  })

  it('accepts dashes too, so a caller that normalises first is not punished', () => {
    expect(computeStreak(days('2026-09-26', '2026-09-27'), '2026-09-27', null)).toBe(2)
  })

  it('ignores a date whose session list is empty', () => {
    const mixed = { ...days('2026/09/26', '2026/09/27'), '2026/09/20': [] as string[] }
    expect(computeStreak(mixed, '2026/09/27', null)).toBe(2)
  })

  // The point of the change: the gap comes from the schedule, floored at the banner's two days.
  it('raises the rest gap from a weekly schedule instead of assuming 2', () => {
    const monTue = {
      type: 'weekly' as const,
      days: [{ dayOfWeek: 1, sessionId: 's' }, { dayOfWeek: 2, sessionId: 's' }],
    }
    // Mon 21st + Tue 22nd, then Mon 28th: a five-day hole. At a flat gap of 2 the span breaks and
    // only today survives (1); with the schedule read, the whole fortnight is one streak.
    const trained = days('2026/09/21', '2026/09/22', '2026/09/28')
    expect(computeStreak(trained, '2026/09/28', null)).toBe(1)
    expect(computeStreak(trained, '2026/09/28', monTue)).toBe(8)
  })

  it('a rotation still gets the banner floor of 2, not maxCompliantRestGapFor 1', () => {
    const rotation = { type: 'rotation' as const, restAfterN: 3, days: [] }
    // One trained day, then two rest days: the banner promises this survives.
    expect(computeStreak(days('2026/09/25'), '2026/09/27', rotation)).toBeGreaterThan(0)
  })
})
