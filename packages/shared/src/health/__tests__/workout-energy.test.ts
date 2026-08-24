import { describe, it, expect } from 'vitest'
import {
  schofieldBmrPerDay,
  bmrPerMinute,
  metForActivity,
  intensityFromRpe,
  estWorkoutKcal,
  estWorkoutKcalFromHr,
  estSessionKcal,
  isKnownActivity,
  isPlausibleSessionDuration,
  MAX_PLAUSIBLE_SESSION_MIN,
  DEFAULT_ACTIVITY_ID,
} from '../workout-energy'
import { COMMON_WORKOUT_ACTIVITIES } from '../workout-activities'
// Relative, not `@/` — packages/shared has no path mapping into the app root.
import { hasRealConstants } from '../../../../../lib/oura-models/__fixtures__/real-constants'

// The Schofield coefficients are in this file's own source, so the whole first describe holds
// without the vendor. What does not are the MET numbers, and the kcal figures derived from them.
// The curated-picker, RPE-band, default-activity and invalid-input blocks read the table's shape
// rather than its values, and stay in CI.
const itVendor = it.skipIf(!hasRealConstants())

// Golden values computed by replicating the model's util.py schofield() from its exact
// coefficients (see docs plan). Cross-checked against published Schofield equations
// (male 18–30: 15.057·W + 692.2).
describe('schofieldBmrPerDay — pinned to the model source', () => {
  const cases: [number, number, 'male' | 'female', number][] = [
    [30, 80, 'male', 1866.5029],
    [40, 65, 'female', 1391.8805],
    [25, 90, 'male', 2040.58],
    [50, 70, 'female', 1413.0993],
    [19, 60, 'male', 1657.49],
    [70, 80, 'male', 1776.2292],
  ]
  it.each(cases)('age %i, %ikg, %s → %f kcal/day', (age, wt, sex, expected) => {
    expect(schofieldBmrPerDay(age, wt, sex)).toBeCloseTo(expected, 2)
  })

  it('bmrPerMinute divides by 24·60', () => {
    expect(bmrPerMinute(30, 80, 'male')).toBeCloseTo(1866.5029 / 1440, 5)
  })
})

describe('metForActivity — 82-activity MET table from the .pt', () => {
  itVendor('strength training (default id 8) tiers', () => {
    expect(DEFAULT_ACTIVITY_ID).toBe(8)
    expect(metForActivity(8, 'easy')).toBe(3.0)
    expect(metForActivity(8, 'moderate')).toBe(5.5)
    expect(metForActivity(8, 'hard')).toBe(6.0)
  })
  itVendor('running (id 12) hard tier', () => {
    expect(metForActivity(12, 'hard')).toBe(12.8)
  })
  it('unknown activity → null', () => {
    expect(metForActivity(9999, 'moderate')).toBeNull()
  })
})

describe('curated activity picker list', () => {
  it('every offered activity id is a real MET-table entry', () => {
    for (const a of COMMON_WORKOUT_ACTIVITIES) {
      expect(isKnownActivity(a.id), `${a.label} (id ${a.id})`).toBe(true)
    }
  })
  it('isKnownActivity rejects an unknown id', () => {
    expect(isKnownActivity(9999)).toBe(false)
  })
})

describe('intensityFromRpe', () => {
  it('maps RPE bands', () => {
    expect(intensityFromRpe(1)).toBe('easy')
    expect(intensityFromRpe(4)).toBe('easy')
    expect(intensityFromRpe(5)).toBe('moderate')
    expect(intensityFromRpe(7)).toBe('moderate')
    expect(intensityFromRpe(8)).toBe('hard')
    expect(intensityFromRpe(10)).toBe('hard')
  })
  it('null RPE defaults to moderate', () => {
    expect(intensityFromRpe(null)).toBe('moderate')
    expect(intensityFromRpe(undefined)).toBe('moderate')
  })
})

describe('estWorkoutKcal — MET fallback (pinned)', () => {
  itVendor('strength training, 30yo 80kg male', () => {
    const base = { ageYears: 30, weightKg: 80, sex: 'male' as const, activityId: 8 }
    expect(estWorkoutKcal({ ...base, durationMin: 45, intensity: 'easy' })!).toBeCloseTo(87.49, 1)
    expect(estWorkoutKcal({ ...base, durationMin: 45, intensity: 'moderate' })!).toBeCloseTo(233.31, 1)
    expect(estWorkoutKcal({ ...base, durationMin: 60, intensity: 'hard' })!).toBeCloseTo(349.97, 1)
  })
  itVendor('running, 40yo 65kg female, moderate 30m', () => {
    expect(estWorkoutKcal({ durationMin: 30, ageYears: 40, weightKg: 65, sex: 'female', activityId: 12, intensity: 'moderate' })!)
      .toBeCloseTo(240.68, 1)
  })
  it('defaults to strength training when no activityId given', () => {
    const withDefault = estWorkoutKcal({ durationMin: 45, ageYears: 30, weightKg: 80, sex: 'male', intensity: 'moderate' })
    const explicit = estWorkoutKcal({ durationMin: 45, ageYears: 30, weightKg: 80, sex: 'male', activityId: 8, intensity: 'moderate' })
    expect(withDefault).toBe(explicit)
  })
  it('returns null on missing/invalid inputs', () => {
    expect(estWorkoutKcal({ durationMin: 0, ageYears: 30, weightKg: 80, sex: 'male', intensity: 'moderate' })).toBeNull()
    expect(estWorkoutKcal({ durationMin: 45, ageYears: NaN, weightKg: 80, sex: 'male', intensity: 'moderate' })).toBeNull()
    expect(estWorkoutKcal({ durationMin: 45, ageYears: 30, weightKg: 0, sex: 'male', intensity: 'moderate' })).toBeNull()
  })
})

// LA-21, owner-decided 2026-08-24. Eleven of the owner's 81 completed sessions span 534–845 minutes
// — the app left running — against a p50 of 56 and NOTHING between 92 and 534. They are real
// workouts (5–6 exercises, 13–18 sets), so the exercise and set logs stay and the volume stays; it is
// the clock that is wrong, and the owner's call is to cull the duration-derived numbers rather than
// clamp them, because a clamped figure is still partly fiction.
describe('implausible session durations are culled, not clamped', () => {
  const base = { ageYears: 33, weightKg: 70.9, sex: 'male' as const, intensity: 'moderate' as const }

  it('accepts a real session and rejects one the app was left running through', () => {
    expect(estWorkoutKcal({ ...base, durationMin: 56 })).toBeGreaterThan(0)   // the owner's p50
    expect(estWorkoutKcal({ ...base, durationMin: 92 })).toBeGreaterThan(0)   // longest real session
    expect(estWorkoutKcal({ ...base, durationMin: MAX_PLAUSIBLE_SESSION_MIN })).toBeGreaterThan(0)
    expect(estWorkoutKcal({ ...base, durationMin: 534 })).toBeNull()          // shortest bad session
    expect(estWorkoutKcal({ ...base, durationMin: 845 })).toBeNull()          // longest bad session
  })

  // Null, never a clamped number: `estWorkoutKcal`'s contract is already "returns null when the
  // inputs cannot support an estimate, so the caller shows nothing rather than a wrong number", and
  // a 240-minute stand-in for a 14-hour row is exactly a wrong number.
  it('returns null rather than the value at the bound', () => {
    const atBound = estWorkoutKcal({ ...base, durationMin: MAX_PLAUSIBLE_SESSION_MIN })
    expect(estWorkoutKcal({ ...base, durationMin: 600 })).not.toBe(atBound)
    expect(estWorkoutKcal({ ...base, durationMin: 600 })).toBeNull()
  })

  // The HR path is the one that actually runs for a session with a strap, so a bound on the MET path
  // alone would leave the whole defect in place wherever it matters most.
  it('applies to the heart-rate path too', () => {
    expect(estWorkoutKcalFromHr({ ...base, durationMin: 56, avgBpm: 120 })).toBeGreaterThan(0)
    expect(estWorkoutKcalFromHr({ ...base, durationMin: 600, avgBpm: 120 })).toBeNull()
  })

  it('and therefore to estSessionKcal on both of its branches', () => {
    expect(estSessionKcal({ ...base, durationMin: 600, rpe: 8, avgBpm: 120 }).kcal).toBeNull()
    expect(estSessionKcal({ ...base, durationMin: 600, rpe: 8, avgBpm: null }).kcal).toBeNull()
    expect(estSessionKcal({ ...base, durationMin: 56, rpe: 8, avgBpm: 120 }).kcal).toBeGreaterThan(0)
  })

  it('still rejects the zero and negative cases it always did', () => {
    expect(estWorkoutKcal({ ...base, durationMin: 0 })).toBeNull()
    expect(estWorkoutKcal({ ...base, durationMin: -5 })).toBeNull()
    expect(isPlausibleSessionDuration(null)).toBe(false)
    expect(isPlausibleSessionDuration(NaN)).toBe(false)
  })
})
