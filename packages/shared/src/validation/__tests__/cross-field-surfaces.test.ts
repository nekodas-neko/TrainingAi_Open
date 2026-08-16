// Q-24 §7: the cross-field helpers existed, and three more surfaces that needed them didn't call
// them. Each case below is a payload the route accepted before this change.
import { describe, it, expect } from 'vitest'
import { FitnessTestBody, FitnessTestCreateBody } from '../fitness-test'
import { activityImplausibleReason, sleepImplausibleReason } from '../plausibility'

describe('FitnessTestBody — distance against duration', () => {
  const base = { testType: '6mwt' as const, date: '2026-07-29' }

  it('rejects the audit’s example — 100 km in one second', () => {
    const res = FitnessTestBody.safeParse({ ...base, durationSec: 1, distanceM: 100_000 })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/Implausible fitness test.*km\/h/)
  })

  it('accepts a real six-minute walk test', () => {
    // 520 m in 360 s is 5.2 km/h — an ordinary walking pace.
    expect(FitnessTestBody.safeParse({
      ...base, durationSec: 360, distanceM: 520, avgHr: 118, maxHr: 131,
    }).success).toBe(true)
  })

  it('accepts a Cooper test run at a genuinely fast pace', () => {
    // 3,200 m in 12 min is 16 km/h — the ceiling exists to catch 360,000, not to judge a good run.
    expect(FitnessTestBody.safeParse({
      testType: 'cooper12', date: '2026-07-29', durationSec: 720, distanceM: 3200,
    }).success).toBe(true)
  })

  it('rejects a max below the average', () => {
    const res = FitnessTestBody.safeParse({ ...base, avgHr: 150, maxHr: 120 })
    expect(res.success).toBe(false)
  })

  it('still accepts a resting_hrr test, which carries no distance at all', () => {
    // Regression guard: the refinement must not reject a shape that simply omits the numerics.
    expect(FitnessTestBody.safeParse({
      testType: 'resting_hrr', date: '2026-07-29', restingHr: 54, hrr1Bpm: 28,
    }).success).toBe(true)
  })

  it('applies the same rule to the id-bearing create body', () => {
    // The route parses with FitnessTestCreateBody and the outbox with FitnessTestBody; a
    // refinement on only one of them is the drift this project keeps hitting.
    const payload = { ...base, id: '11111111-1111-4111-8111-111111111111', durationSec: 1, distanceM: 100_000 }
    expect(FitnessTestCreateBody.safeParse(payload).success).toBe(false)
    expect(FitnessTestCreateBody.safeParse({ ...payload, distanceM: 520, durationSec: 360 }).success).toBe(true)
  })
})

describe('sync-health exercise sessions', () => {
  // The route's schema shape is exactly ActivityPlausibilityInput's, so the guard is a direct call.
  it('rejects 420 km in a one-minute Health Connect session', () => {
    expect(activityImplausibleReason({
      durationMin: 1, distanceKm: 420, caloriesBurned: 900_000, avgHr: 200, maxHr: 210,
    })).toMatch(/km\/h/)
  })

  it('accepts an ordinary logged walk', () => {
    expect(activityImplausibleReason({
      durationMin: 32, distanceKm: 2.7, caloriesBurned: 140, avgHr: 104, maxHr: 122,
    })).toBeNull()
  })
})

describe('sync-health sleep records', () => {
  // The route derives spanHours from sleepStart/sleepEnd, which the schema only checked were
  // non-empty strings — four ≤24 h stages could sum to 96 hours inside a one-hour window.
  const span = (startIso: string, endIso: string) =>
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000

  it('rejects 96 staged hours inside a one-hour window', () => {
    expect(sleepImplausibleReason({
      spanHours: span('2026-07-29T01:00:00Z', '2026-07-29T02:00:00Z'),
      deepSleepHours: 24, remSleepHours: 24, lightSleepHours: 24, awakHours: 24,
    })).toMatch(/stages total/)
  })

  it('rejects a night that ends before it starts', () => {
    expect(sleepImplausibleReason({
      spanHours: span('2026-07-29T09:00:00Z', '2026-07-29T01:00:00Z'),
    })).toMatch(/before/)
  })

  it('accepts a real night', () => {
    expect(sleepImplausibleReason({
      spanHours: span('2026-07-28T21:40:00Z', '2026-07-29T05:20:00Z'),
      durationHours: 7.1, deepSleepHours: 1.3, remSleepHours: 1.6,
      lightSleepHours: 4.2, awakHours: 0.5,
    })).toBeNull()
  })

  it('flags an unparseable timestamp as NaN rather than silently comparing', () => {
    // The route rejects on Number.isNaN before reaching the helper; this pins that the helper
    // would NOT have caught it, which is why the explicit guard is there.
    expect(Number.isNaN(new Date('not a date').getTime())).toBe(true)
    expect(sleepImplausibleReason({ spanHours: NaN, durationHours: 400 })).toBeNull()
  })
})

describe('activity-log metrics PATCH — patch merged over the stored row', () => {
  // The patch never carries a duration; it lives on the row being enriched. Rate-checking the
  // merge is the only way a 30-minute walk rejects the 420 km someone fills into it.
  const stored = { durationMin: 30, distanceKm: null, caloriesBurned: null, avgHr: null, maxHr: null }
  const merge = (patch: Record<string, number>) => ({
    durationMin: stored.durationMin,
    distanceKm:     patch.distanceKm     ?? stored.distanceKm,
    caloriesBurned: patch.caloriesBurned ?? stored.caloriesBurned,
    avgHr:          patch.avgHr          ?? stored.avgHr,
    maxHr:          patch.maxHr          ?? stored.maxHr,
  })

  it('rejects 420 km filled into a 30-minute log', () => {
    expect(activityImplausibleReason(merge({ distanceKm: 420 }))).toMatch(/km\/h/)
  })

  it('accepts a plausible backfill', () => {
    expect(activityImplausibleReason(merge({ distanceKm: 3.1, caloriesBurned: 190, avgHr: 112, maxHr: 138 }))).toBeNull()
  })

  it('checks the patch against values already on the row, not just against itself', () => {
    // avgHr is already stored; a patch supplying only maxHr must still be ordered against it.
    const withAvg = { ...stored, avgHr: 150 }
    expect(activityImplausibleReason({ ...withAvg, maxHr: 120 })).toMatch(/below avgHr/)
  })
})
