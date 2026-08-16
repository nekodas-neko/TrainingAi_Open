// Q-24: every numeric on these payloads was bounded (or not) in isolation and the COMBINATION was
// never checked — the same gap that let 3,605 steps in 13 minutes through on the step path. Each
// case below is a payload the routes accepted before this module existed.
import { describe, it, expect } from 'vitest'
import { activityImplausibleReason, sleepImplausibleReason } from '../plausibility'
import { ActivityLogBody } from '../activity-log'

describe('activityImplausibleReason', () => {
  it('rejects the audit’s example payload — 420 km in one minute', () => {
    const r = activityImplausibleReason({ durationMin: 1, distanceKm: 420 })
    expect(r).toMatch(/km\/h/)
  })

  it('rejects 900,000 kcal in a minute', () => {
    expect(activityImplausibleReason({ durationMin: 1, caloriesBurned: 900_000 })).toMatch(/kcal\/min/)
  })

  it('rejects 900,000 steps in a minute', () => {
    expect(activityImplausibleReason({ durationMin: 1, steps: 900_000 })).toMatch(/steps\/min/)
  })

  it('rejects a 4,000 bpm average and a max below the average', () => {
    expect(activityImplausibleReason({ avgHr: 4000 })).toMatch(/avgHr/)
    expect(activityImplausibleReason({ avgHr: 150, maxHr: 120 })).toMatch(/below avgHr/)
  })

  it('accepts a hard but real session', () => {
    // 21 km in 90 min (14 km/h), 1,400 kcal, 18,000 steps, HR 165/188.
    expect(activityImplausibleReason({
      durationMin: 90, distanceKm: 21, caloriesBurned: 1400, steps: 18_000, avgHr: 165, maxHr: 188,
    })).toBeNull()
  })

  it('accepts a fast descent on a bike', () => {
    // 60 km in 60 min — well inside the ceiling, which exists to catch 25,200 km/h.
    expect(activityImplausibleReason({ durationMin: 60, distanceKm: 60 })).toBeNull()
  })

  it('skips every rate check when there is no duration to divide by', () => {
    // Inventing a duration to validate against would be worse than not checking.
    expect(activityImplausibleReason({ distanceKm: 420, caloriesBurned: 900_000 })).toBeNull()
    expect(activityImplausibleReason({ durationMin: 0, distanceKm: 420 })).toBeNull()
  })
})

describe('ActivityLogBody — the check reaches BOTH write paths', () => {
  const base = { date: '2026-07-29', activityType: 'run', title: 'x' }

  it('rejects the impossible payload through the shared schema', () => {
    const res = ActivityLogBody.safeParse({ ...base, durationMin: 1, distanceKm: 420 })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error.issues[0].message).toMatch(/Implausible activity/)
  })

  it('still accepts a normal activity', () => {
    expect(ActivityLogBody.safeParse({
      ...base, durationMin: 45, distanceKm: 8, caloriesBurned: 480, avgHr: 150, maxHr: 172,
    }).success).toBe(true)
  })

  it('still accepts the all-optional guided-walk shape', () => {
    // Regression guard: superRefine must not reject a payload that simply omits the numerics.
    expect(ActivityLogBody.safeParse(base).success).toBe(true)
  })
})

describe('sleepImplausibleReason', () => {
  it('rejects 1,200 staged hours inside a five-minute window', () => {
    const r = sleepImplausibleReason({
      spanHours: 5 / 60, deepSleepHours: 300, remSleepHours: 300, lightSleepHours: 300, awakHours: 300,
    })
    expect(r).toMatch(/stages total/)
  })

  it('rejects a window that ends before it starts', () => {
    expect(sleepImplausibleReason({ spanHours: -2 })).toMatch(/before/)
  })

  it('rejects a duration longer than the window it sits in', () => {
    expect(sleepImplausibleReason({ spanHours: 0.08, durationHours: 400 })).toMatch(/exceeds/)
  })

  it('accepts a real night whose stages round slightly over the span', () => {
    // Stages and span come from different places, so rounding at both ends must not reject.
    expect(sleepImplausibleReason({
      spanHours: 8, durationHours: 7.5, deepSleepHours: 1.5, remSleepHours: 1.8,
      lightSleepHours: 4.2, awakHours: 0.6,
    })).toBeNull()
  })

  it('says nothing when there is no span to compare against', () => {
    expect(sleepImplausibleReason({ deepSleepHours: 300 })).toBeNull()
  })
})

describe('ActivityLogBody — guided-walk segment stats (2026-08-02 owner report)', () => {
  const walk = {
    date: '2026-08-01', activityType: 'walk', title: 'Interval walk',
    startTime: '08:15', endTime: '08:39', durationMin: 24, distanceKm: 2.34,
  }

  // computeWalkSegmentStats rounds means to 1dp, so avgHr is routinely fractional. The schema
  // required an integer, which rejected the WHOLE payload — the walk then dead-lettered in the
  // outbox and never reached the server (or the training calendar).
  it('accepts a segment whose avgHr is a 1dp mean', () => {
    const res = ActivityLogBody.safeParse({
      ...walk,
      segments: [{
        index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 120,
        avgHr: 123.4, maxHr: 140, hrAtStart: 110,
        avgPaceSecPerKm: 600, distanceKm: 0.2, avgCadenceSpm: 112.3,
      }],
    })
    expect(res.success).toBe(true)
  })

  it('still rejects a segment HR that is not a heart rate', () => {
    const res = ActivityLogBody.safeParse({
      ...walk,
      segments: [{
        index: 0, setNumber: 1, kind: 'fast', startSec: 0, endSec: 120,
        avgHr: 0, maxHr: 140, hrAtStart: 110,
        avgPaceSecPerKm: 600, distanceKm: 0.2, avgCadenceSpm: 112.3,
      }],
    })
    expect(res.success).toBe(false)
  })
})
