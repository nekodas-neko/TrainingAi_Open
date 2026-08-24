import { describe, it, expect } from 'vitest'
import {
  computeActiveEnergy, ouraIdForActivityType, SEDENTARY_MULTIPLIER, STEP_BASELINE, STEPS_PER_KM,
} from './daily-energy'
// Relative, not `@/` — this file sits under packages/shared/src (not in a `__tests__` folder, so
// the package's own tsconfig compiles it) and that tsconfig has no path mapping into the app root.
import { hasRealConstants } from '../../../../lib/oura-models/__fixtures__/real-constants'

// Every kcal figure here comes through `estWorkoutKcal`, which reads the MET table. The synthetic
// fixtures carry METs below 1.0 — physiologically impossible, since 1 MET is rest — so the
// estimator's net-MET guard returns null and even the ordering and summation assertions have
// nothing to compare. The multiplier, id-mapping and incomplete-profile blocks do not touch it.
const itVendor = it.skipIf(!hasRealConstants())

const profile = { ageYears: 30, weightKg: 82.5, sex: 'male' as const }

describe('daily-energy', () => {
  it('exposes a sedentary base multiplier', () => {
    expect(SEDENTARY_MULTIPLIER).toBe(1.2)
  })

  it('maps activity types to Oura MET ids with a generic fallback', () => {
    expect(ouraIdForActivityType('run')).toBe(12)
    expect(ouraIdForActivityType('walk')).toBe(14)
    expect(ouraIdForActivityType('cycle')).toBe(5)
    expect(ouraIdForActivityType('unknown-type')).toBe(79) // cardiovascular fallback
    expect(ouraIdForActivityType(null)).toBe(79)
  })

  it('returns zeros when the profile is incomplete (never fabricates)', () => {
    const r = computeActiveEnergy({
      profile: { ageYears: null, weightKg: 82.5, sex: 'male' },
      strengthSessions: [{ durationMin: 55 }], activities: [], pedometerSteps: 10000,
    })
    expect(r).toEqual({ workoutKcal: 0, activityKcal: 0, stepsKcal: 0, total: 0, workoutKcalBySession: [] })
  })

  // Still vendor-gated after Q-312, and deliberately: this asserts a MAGNITUDE, which is exactly
  // what the synthetic constants do not carry. The floor makes the number non-zero; it cannot make
  // it 200–400.
  itVendor('estimates a strength session in a sane range (~200-400 kcal for 55 min)', () => {
    const r = computeActiveEnergy({ profile, strengthSessions: [{ durationMin: 55 }], activities: [], pedometerSteps: null })
    expect(r.workoutKcal).toBeGreaterThan(200)
    expect(r.workoutKcal).toBeLessThan(400)
    expect(r.activityKcal).toBe(0)
    expect(r.stepsKcal).toBe(0)
    expect(r.total).toBe(r.workoutKcal)
  })

  // Still vendor-gated, and this one is the interesting case. It PASSES on the synthetic table
  // today — running lands at met_easy 2.6 against walking's 2.2 — but only by accident: the scrub
  // ramps within a band on `seq % 10`, and running (id 12, position 11) and walking (id 14,
  // position 13) happen to land 0.4 apart in the right direction. Insert one activity above
  // position 11 in the vendor's dict and the offsets shift; the ordering can invert with no code
  // change at all.
  //
  // A key-based synthetic table structurally cannot guarantee an ordering between two NAMED
  // activities — that ordering is a fact about the vendor's table, which is what `itVendor` is for.
  // Unguarding it would buy a test that passes by luck and fails one day for a reason unrelated to
  // anything anyone changed, which is the same trap as a hardcoded timestamp.
  itVendor('counts a logged run and it burns more than an equal-duration walk', () => {
    const run = computeActiveEnergy({ profile, strengthSessions: [], activities: [{ activityType: 'run', durationMin: 30 }], pedometerSteps: null })
    const walk = computeActiveEnergy({ profile, strengthSessions: [], activities: [{ activityType: 'walk', durationMin: 30 }], pedometerSteps: null })
    expect(run.activityKcal).toBeGreaterThan(walk.activityKcal)
    expect(walk.activityKcal).toBeGreaterThan(0)
  })

  it('estimates a logged activity duration from distance when duration is missing', () => {
    const withDur = computeActiveEnergy({ profile, strengthSessions: [], activities: [{ activityType: 'run', durationMin: 30 }], pedometerSteps: null })
    const withDist = computeActiveEnergy({ profile, strengthSessions: [], activities: [{ activityType: 'run', distanceKm: 4.5 }], pedometerSteps: null }) // ~30 min at 9km/h
    expect(withDist.activityKcal).toBeGreaterThan(0)
    // 4.5km/9kmh = 30min → roughly the same as the explicit-30-min case
    expect(Math.abs(withDist.activityKcal - withDur.activityKcal)).toBeLessThan(withDur.activityKcal * 0.15)
  })

  it('only counts steps above the sedentary baseline', () => {
    const below = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: STEP_BASELINE - 500 })
    expect(below.stepsKcal).toBe(0)
    const above = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: STEP_BASELINE + 7000 })
    expect(above.stepsKcal).toBeGreaterThan(0)
  })

  it('subtracts a logged outdoor walk\'s steps from the passive total (no double-count)', () => {
    // 10000 pedometer steps, but a logged 5km walk (~6500 steps) happened outdoors.
    const noLog = computeActiveEnergy({ profile, strengthSessions: [], activities: [], pedometerSteps: 10000 })
    const withLog = computeActiveEnergy({
      profile, strengthSessions: [],
      activities: [{ activityType: 'walk', distanceKm: 5, durationMin: 60 }],
      pedometerSteps: 10000,
    })
    // The walk's own energy is counted (activityKcal), but its ~6500 steps are removed from stepsKcal.
    expect(withLog.activityKcal).toBeGreaterThan(0)
    expect(withLog.stepsKcal).toBeLessThan(noLog.stepsKcal)
    // 10000 - 3000 baseline - 5*1300 = 500 net steps → tiny; confirm the subtraction magnitude.
    expect(5 * STEPS_PER_KM).toBe(6500)
  })

  it('sums the three sources into total', () => {
    const r = computeActiveEnergy({
      profile,
      strengthSessions: [{ durationMin: 45 }],
      activities: [{ activityType: 'run', durationMin: 20 }],
      pedometerSteps: 12000,
    })
    expect(r.total).toBe(r.workoutKcal + r.activityKcal + r.stepsKcal)
    expect(r.workoutKcal).toBeGreaterThan(0)
    expect(r.activityKcal).toBeGreaterThan(0)
    expect(r.stepsKcal).toBeGreaterThan(0)
  })
})
