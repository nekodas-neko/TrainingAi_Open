import { describe, it, expect } from 'vitest'
import { ActivityLogBody } from '@trainingai/shared/validation/activity-log'

// Q-351. `activity-store.ts` rounds durationMin to one decimal, so anything under 3 real seconds
// becomes exactly 0. `.positive()` rejected it, the route answered a bare 400, and the UI said
// "Failed to save activity" — the recording was discarded and the user was told the wrong thing.
// Measured on the Q-450 E2E spec: 2 s → 400 with activity_logs empty; 5 s → 201, duration_min 0.1.
const base = { date: '2026-08-17', activityType: 'walk', title: 'Walk' }

describe('ActivityLogBody — a sub-3-second activity is saved, not lost (Q-351)', () => {
  it('accepts the zero duration that rounding produces', () => {
    expect(ActivityLogBody.safeParse({ ...base, durationMin: 0 }).success).toBe(true)
  })

  it('still accepts the shortest representable real duration, and absence', () => {
    expect(ActivityLogBody.safeParse({ ...base, durationMin: 0.1 }).success).toBe(true)
    expect(ActivityLogBody.safeParse({ ...base }).success).toBe(true)
  })

  it('rejects a negative duration — nonnegative is not "anything goes"', () => {
    expect(ActivityLogBody.safeParse({ ...base, durationMin: -1 }).success).toBe(false)
  })

  it('keeps the upper bound', () => {
    expect(ActivityLogBody.safeParse({ ...base, durationMin: 100_000 }).success).toBe(false)
  })

  // The reason this is safe: the cross-field rate checks divide by duration, and they skip zero.
  // If that ever stopped being true, a zero would produce Infinity km/h rather than a clean pass.
  it('does not let a zero duration turn a real distance into an implausible rate', () => {
    const parsed = ActivityLogBody.safeParse({ ...base, durationMin: 0, distanceKm: 5, caloriesBurned: 300, steps: 6000 })
    expect(parsed.success).toBe(true)
  })

  it('still catches an implausible rate once the duration is non-zero', () => {
    const parsed = ActivityLogBody.safeParse({ ...base, durationMin: 1, distanceKm: 420 })
    expect(parsed.success).toBe(false)
  })
})
