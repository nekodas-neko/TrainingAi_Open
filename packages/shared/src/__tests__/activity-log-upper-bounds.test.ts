import { describe, it, expect } from 'vitest'
import { ActivityLogBody, addMinutes } from '../validation/activity-log'
import {
  MAX_ACTIVITY_DURATION_MIN, MAX_ACTIVITY_DISTANCE_KM, MAX_ACTIVITY_KCAL,
  MAX_ACTIVITY_STEPS, MAX_ACTIVITY_ELEVATION_M,
} from '../validation/plausibility'

/**
 * Q-164: every numeric in this schema was bounded below and open above, so
 * `POST /api/activity-logs { durationMin: 100000 }` returned 201 and stored a 69.4-day walk.
 *
 * The cross-field plausibility refine could not catch it: every rate check divides by `durationMin`
 * and is skipped when it is absent or zero, so a single field on its own met nothing. These tests
 * cover that gap specifically — the combination cases belong to `activityImplausibleReason`.
 */

const base = { date: '2026-08-09', activityType: 'walk', title: 'Walk' }
const parse = (extra: Record<string, unknown>) => ActivityLogBody.safeParse({ ...base, ...extra })

describe('activity-log upper bounds (Q-164)', () => {
  it('rejects the reported 69-day walk', () => {
    expect(parse({ durationMin: 100_000 }).success).toBe(false)
  })

  it('does NOT catch a plausible typo, and that is the accepted limitation', () => {
    // The backlog entry argued the dangerous case is a typo like 1000 for 100, because nothing
    // looks wrong afterwards. A ceiling set from physiology cannot catch it: 1000 minutes is
    // 16.7 hours, which a real ultra reaches, so rejecting it would reject a good day. These
    // bounds exist to reject the physically impossible, and 16.7 hours of walking is not that.
    //
    // Pinned as a passing test rather than left unsaid: whoever reads this next should know the
    // limitation is deliberate, not an oversight, and that catching typos needs a different
    // mechanism (a confirmation on unusually long entries, say) rather than a tighter ceiling.
    expect(parse({ durationMin: 1000 }).success).toBe(true)
  })

  it('rejects each field on its own, with no duration to trigger a rate check', () => {
    expect(parse({ distanceKm: 99_999 }).success).toBe(false)
    expect(parse({ caloriesBurned: 900_000 }).success).toBe(false)
    expect(parse({ steps: 99_999_999 }).success).toBe(false)
    expect(parse({ elevationGainM: 999_999 }).success).toBe(false)
    expect(parse({ elevationLossM: 999_999 }).success).toBe(false)
    expect(parse({ avgPaceSecPerKm: 999_999 }).success).toBe(false)
  })

  it('rejects out-of-range values nested in the series and segment arrays', () => {
    // A 2,000-point pace series of unbounded numbers is the same hole with more rows.
    expect(parse({ paceSeries: [{ tSec: 10, paceSec: 999_999 }] }).success).toBe(false)
    expect(parse({ splits: [{ km: 99_999, paceSec: 300 }] }).success).toBe(false)
    expect(parse({ cadenceSeries: [{ tSec: 10, spm: 9_999 }] }).success).toBe(false)
    expect(parse({ elevationProfile: [{ distKm: 1, eleM: 999_999 }] }).success).toBe(false)
  })

  it('accepts a real activity, and a hard one at that', () => {
    // The bounds must never reject a good day — a 24 h ultra sits exactly at the ceiling.
    expect(parse({
      durationMin: 90, distanceKm: 18.2, caloriesBurned: 1180, steps: 13_000,
      elevationGainM: 640, elevationLossM: 640, avgPaceSecPerKm: 297, avgHr: 148, maxHr: 176,
    }).success).toBe(true)

    expect(parse({
      durationMin: MAX_ACTIVITY_DURATION_MIN, distanceKm: 265, caloriesBurned: 14_500,
      steps: 310_000, elevationGainM: 6_800,
    }).success).toBe(true)
  })

  it('accepts a below-sea-level altitude in an elevation profile', () => {
    // `eleM` is altitude, not gain — the Dead Sea shore is about -430 m, so this one is signed.
    expect(parse({ elevationProfile: [{ distKm: 2, eleM: -430 }] }).success).toBe(true)
  })

  it('keeps each ceiling above the last value it should accept', () => {
    expect(parse({ durationMin: MAX_ACTIVITY_DURATION_MIN }).success).toBe(true)
    expect(parse({ durationMin: MAX_ACTIVITY_DURATION_MIN + 1 }).success).toBe(false)
    expect(parse({ distanceKm: MAX_ACTIVITY_DISTANCE_KM + 1 }).success).toBe(false)
    expect(parse({ caloriesBurned: MAX_ACTIVITY_KCAL + 1 }).success).toBe(false)
    expect(parse({ steps: MAX_ACTIVITY_STEPS + 1 }).success).toBe(false)
    expect(parse({ elevationGainM: MAX_ACTIVITY_ELEVATION_M + 1 }).success).toBe(false)
  })

  it('bounds duration where addMinutes stops being able to represent it', () => {
    // The chosen ceiling is not a round number for its own sake: `addMinutes` wraps at 1440, so a
    // longer duration derives an end time EARLIER the same day. The backlog entry claimed an
    // over-long duration "produces an end timestamp days later and can push an activity into the
    // wrong day bucket" — it does not, it wraps. Pinning that here so the reasoning is not
    // re-litigated from the entry's version.
    expect(addMinutes('08:00', 100_000)).toBe('18:40')
    expect(addMinutes('08:00', MAX_ACTIVITY_DURATION_MIN)).toBe('08:00')
  })
})
