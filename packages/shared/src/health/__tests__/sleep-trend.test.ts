import { describe, it, expect } from 'vitest'
import { sleepDurationTrend, sleepScoreTrend } from '@trainingai/shared/health/sleep-trend'
import type { SleepSession } from '@trainingai/shared/types/body'

// daysAgo 0 = last night. sleepEnd 21:00 UTC = 07:00 AEST wake (timing contributor ~ideal).
const night = (daysAgo: number, over: Partial<SleepSession> = {}): SleepSession => {
  const end = new Date(Date.UTC(2026, 6, 16 - daysAgo, 21, 0, 0))
  return {
    id: `s${daysAgo}`, userId: 'u1',
    date: `2026-07-${String(16 - daysAgo).padStart(2, '0')}`,
    sleepStart: new Date(end.getTime() - 8 * 3_600_000), sleepEnd: end,
    durationHours: 8, createdAt: end,
    ...over,
  }
}

describe('sleepDurationTrend', () => {
  it('is recent-3 avg hours over older-window avg hours', () => {
    const sessions = [
      ...[0, 1, 2].map(d => night(d, { durationHours: 6 })),
      ...[3, 4, 5, 6, 7, 8, 9].map(d => night(d, { durationHours: 8 })),
    ]
    expect(sleepDurationTrend(sessions)).toBeCloseTo(0.75, 5)
  })

  it('returns null with fewer than 4 sessions', () => {
    expect(sleepDurationTrend([0, 1, 2].map(d => night(d)))).toBeNull()
  })

  it('sorts by sleepEnd itself (input order must not matter)', () => {
    const sessions = [
      ...[3, 4, 5].map(d => night(d, { durationHours: 8 })),
      ...[0, 1, 2].map(d => night(d, { durationHours: 4 })),
    ]
    expect(sleepDurationTrend(sessions)).toBeCloseTo(0.5, 5)
  })

  // Was "counts a missing durationHours as 0 (legacy parity with signals.ts)". That parity was the
  // bug: a row with no duration is a bed period the recorder never resolved, and zeroing it
  // manufactured the ~33% sleep deficit this ratio exists to detect (Q-76). Now dropped, matching
  // sleepScoreTrend's "skip the unscorable" rule.
  it('drops a row with no durationHours instead of counting it as 0', () => {
    const sessions = [
      night(0, { durationHours: undefined }),
      night(1, { durationHours: 8 }), night(2, { durationHours: 8 }),
      night(3, { durationHours: 8 }), night(4, { durationHours: 8 }),
    ]
    expect(sleepDurationTrend(sessions)).toBeCloseTo(1, 5)
  })
})

// The other half of finding F-1 (Q-76): sleepScoreTrend was given the nap filter and its duration
// sibling was not, even though the duration ratio is the one the periodisation engine and the
// next-session recommender actually gate on.
describe('sleepDurationTrend excludes naps and reassembles split nights (Q-76)', () => {
  // 20-minute afternoon doze: 03:00–03:20 UTC = 13:00–13:20 AEST, midpoint outside the night band.
  const nap = (daysAgo: number): SleepSession => {
    const start = new Date(Date.UTC(2026, 6, 16 - daysAgo, 3, 0, 0))
    return {
      id: `nap${daysAgo}`, userId: 'u1',
      date: `2026-07-${String(16 - daysAgo).padStart(2, '0')}`,
      sleepStart: start, sleepEnd: new Date(start.getTime() + 20 * 60_000),
      durationHours: 0.33, createdAt: start,
    }
  }

  it('three recent naps do not collapse a flat trend', () => {
    const nights = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => night(d))
    // Naively the three newest "nights" are the 0.33 h naps against an 8 h baseline — a ratio of
    // about 0.04, well under the 0.85 low-sleep threshold the AI-dynamic path gates on.
    expect(sleepDurationTrend([...nights, nap(0), nap(1), nap(2)], 'Australia/Brisbane'))
      .toBeCloseTo(1, 5)
  })

  it('a night split by a wake-up counts as one night of its total, not two short ones', () => {
    // 2026-05-29's real shape: 22:06–00:38 then 02:23–06:24, a ~1h45m gap. Both halves sit in the
    // night band, so they merge; unmerged, the newest window is a 4 h "night" against an 8 h
    // baseline and reads as a deficit that never happened.
    const splitEnd = new Date(Date.UTC(2026, 6, 16, 21, 0, 0))       // 07:00 AEST wake
    const firstHalf: SleepSession = {
      id: 'split-a', userId: 'u1', date: '2026-07-16',
      sleepStart: new Date(splitEnd.getTime() - 8 * 3_600_000),       // 23:00 AEST
      sleepEnd: new Date(splitEnd.getTime() - 5 * 3_600_000),         // 02:00 AEST
      durationHours: 3, createdAt: splitEnd,
    }
    const secondHalf: SleepSession = {
      id: 'split-b', userId: 'u1', date: '2026-07-16',
      sleepStart: new Date(splitEnd.getTime() - 4 * 3_600_000),       // 03:00 AEST, 1 h gap
      sleepEnd: splitEnd,
      durationHours: 4, createdAt: splitEnd,
    }
    const baseline = [1, 2, 3, 4, 5, 6, 7].map(d => night(d, { durationHours: 7 }))
    const trend = sleepDurationTrend([firstHalf, secondHalf, ...baseline], 'Australia/Brisbane')!
    // One 7 h night, so the newest value equals the baseline exactly. Split, the newest window
    // would be 4 h and the ratio would land near 0.86.
    expect(trend).toBeCloseTo(1, 5)
  })
})

describe('sleepScoreTrend', () => {
  it('is ~1.0 across identical nights', () => {
    const sessions = [0, 1, 2, 3, 4, 5].map(d => night(d, { efficiency: 92 }))
    expect(sleepScoreTrend(sessions, 'Australia/Brisbane')).toBeCloseTo(1, 5)
  })

  it('drops below 1 when recent nights are worse than baseline', () => {
    const sessions = [
      ...[0, 1, 2].map(d => night(d, {
        durationHours: 4.5, efficiency: 70,
        sleepStart: new Date(Date.UTC(2026, 6, 16 - d, 16, 30, 0)),
      })),
      ...[3, 4, 5, 6, 7, 8, 9].map(d => night(d, { efficiency: 93 })),
    ]
    const trend = sleepScoreTrend(sessions, 'Australia/Brisbane')!
    expect(trend).toBeLessThan(0.85)
  })

  it('skips unscorable nights (no duration) instead of zeroing them', () => {
    const sessions = [
      night(0, { durationHours: undefined }), // computeSleepScore → null, skipped
      night(1), night(2), night(3), night(4),
    ]
    expect(sleepScoreTrend(sessions, 'Australia/Brisbane')).toBeCloseTo(1, 5)
  })

  it('returns null with fewer than 4 scorable nights', () => {
    expect(sleepScoreTrend([0, 1, 2].map(d => night(d)), 'Australia/Brisbane')).toBeNull()
  })
})

// A residual of finding F-1: `computeSleepScore` has no minimum-duration guard, so before this
// fix the trend scored naps alongside nights and a single doze dragged the ratio.
describe('sleepScoreTrend excludes naps (F-1 residual)', () => {
  // A 20-minute afternoon doze: 03:00–03:20 UTC = 13:00–13:20 AEST, midpoint well outside the
  // night band, so `nightSessions` classifies it as a nap.
  const nap = (daysAgo: number): SleepSession => {
    const start = new Date(Date.UTC(2026, 6, 16 - daysAgo, 3, 0, 0))
    return {
      id: `nap${daysAgo}`, userId: 'u1',
      date: `2026-07-${String(16 - daysAgo).padStart(2, '0')}`,
      sleepStart: start, sleepEnd: new Date(start.getTime() + 20 * 60_000),
      durationHours: 0.33, createdAt: start,
    }
  }

  it('is unchanged when naps are interleaved with identical nights', () => {
    const nights = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => night(d))
    const withNaps = [...nights, nap(0), nap(1), nap(2)]
    expect(sleepScoreTrend(withNaps, 'Australia/Brisbane'))
      .toBeCloseTo(sleepScoreTrend(nights, 'Australia/Brisbane')!, 5)
  })

  it('does not let recent naps collapse the trend', () => {
    const withNaps = [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => night(d)), nap(0), nap(1), nap(2)]
    // Scored naively the three most recent "nights" are the naps, which score near zero against a
    // ~90 baseline — a ratio around 0.06. Anything above 0.9 proves they were excluded.
    // (The value sits a little ABOVE 1 because the earliest nights have no HRV/HR/schedule
    // baseline yet, so later nights score marginally higher — baseline maturation, not a nap.)
    expect(sleepScoreTrend(withNaps, 'Australia/Brisbane')).toBeGreaterThan(0.9)
  })
})
