// RV-216. Home said a 111-day streak and More said the best was 49, which looks impossible and
// was not: the two functions named `computeStreak` counted different quantities. Home's added
// `1 + consecutiveRest` (calendar days, rest included); achievements' added 1 per dated entry
// (sessions). On the owner's real history those read 111 and 83 for the same input, and the 49
// was the session count at BF-122a's rotation gap of 1.
import { describe, it, expect } from 'vitest'
import { computeDayStreak, streakRestGapFor, DEFAULT_MAX_REST_GAP } from '../day-streak'

// A fixed January day as a plain string. Deliberately not built from a `Date` — the UTC-slicing
// rule bans that shape everywhere, and a fixture has no need of a clock: both sides of every
// comparison below are literals, which is the only condition under which a hardcoded date is safe.
const d = (n: number) => `2026-01-${String(n).padStart(2, '0')}`

describe('computeDayStreak', () => {
  it('counts the rest days inside a streak, which is what makes it a DAY count', () => {
    // Trained the 1st and the 4th: two rest days between, bridged. Four calendar days, not two
    // sessions — this single assertion is the whole difference between the two old functions.
    expect(computeDayStreak([d(1), d(4)], d(4)).best).toBe(4)
  })

  /**
   * The best span counted in DAYS, when it is not also the current one — which is the case that
   * actually separates the two old functions. The mutation pass caught this: asserting `best` on
   * a streak that runs up to today passes even when `best` counts sessions, because
   * `Math.max(best, current)` hands back the day-counted `current` instead.
   */
  it('counts a PAST best in days, not sessions', () => {
    // Trained the 1st, 4th, 7th and 10th: two rest days between each, all bridged at gap 2, so
    // one span of 10 calendar days built from 4 sessions. Then a clean break, and a short recent
    // streak so `current` cannot mask the answer. (7th -> 11th would be THREE rest days and
    // would break the span — the first draft of this fixture got that wrong and read 7.)
    const past = [d(1), d(4), d(7), d(10)]
    const recent = [d(25), d(26)]
    const { best, current } = computeDayStreak([...past, ...recent], d(26))
    expect(best).toBe(10)   // days, Jan 1 -> Jan 10. Sessions would be 4.
    expect(current).toBe(2)
  })

  it('breaks when the gap exceeds the allowance', () => {
    // Three rest days between the 1st and the 5th, one over the default of 2.
    expect(computeDayStreak([d(1), d(5)], d(5)).best).toBe(1)
  })

  // The invariant RV-216 asks for, and the one that made the report look impossible.
  it('never reports a best below the current, for any allowance', () => {
    const days = [d(1), d(2), d(3), d(6), d(9), d(10), d(11), d(12)]
    for (const gap of [0, 1, 2, 3, 5]) {
      for (const today of [d(12), d(13), d(14), d(20)]) {
        const { best, current } = computeDayStreak(days, today, gap)
        expect(best, `gap=${gap} today=${today}`).toBeGreaterThanOrEqual(current)
      }
    }
  })

  it('keeps the streak alive across an untrained today, and counts it', () => {
    // Trained through the 10th, today is the 11th and untrained: the streak is not broken, and
    // the 11th is inside it — an owner who trains tomorrow should not see the number drop today.
    expect(computeDayStreak([d(9), d(10)], d(11)).current).toBe(3)
  })

  it('breaks the current streak once today is out of reach', () => {
    expect(computeDayStreak([d(9), d(10)], d(14)).current).toBe(0)
    // …while the best still remembers it.
    expect(computeDayStreak([d(9), d(10)], d(14)).best).toBe(2)
  })

  it('is indifferent to order and duplicates', () => {
    const a = computeDayStreak([d(3), d(1), d(2)], d(3))
    const b = computeDayStreak([d(1), d(2), d(2), d(3)], d(3))
    expect(a).toEqual(b)
    expect(a.best).toBe(3)
  })

  it('answers zero for no history rather than one', () => {
    expect(computeDayStreak([], d(5))).toEqual({ current: 0, best: 0 })
  })
})

describe('streakRestGapFor', () => {
  // The rotation case is the owner's, and it is why More read 49 against Home's 111:
  // `maxCompliantRestGapFor` alone answers 1 here, against a banner promising two rest days.
  it('floors a rotation at the banner\'s promise', () => {
    expect(streakRestGapFor({ type: 'rotation', restAfterN: 3, days: [] })).toBe(DEFAULT_MAX_REST_GAP)
  })

  it('does not floor away BF-122a — Mon+Tue keeps its five-day hole', () => {
    const monTue = {
      type: 'weekly' as const,
      restAfterN: undefined,
      days: [{ dayOfWeek: 1, sessionId: 's' }, { dayOfWeek: 2, sessionId: 's' }],
    }
    // Tue -> Mon is six calendar days, five of them rest. A flat 2 would break this user's
    // streak every week, which is the exact bug BF-122a exists to fix.
    expect(streakRestGapFor(monTue)).toBe(5)
  })

  it('gives an unscheduled user the promise rather than the old 1', () => {
    expect(streakRestGapFor(null)).toBe(DEFAULT_MAX_REST_GAP)
  })
})
