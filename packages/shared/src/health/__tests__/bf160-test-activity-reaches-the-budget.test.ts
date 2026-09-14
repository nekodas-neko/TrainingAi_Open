import { describe, it, expect } from 'vitest'
import { computeActiveEnergy } from '../daily-energy'
import { buildTestActivity } from '@trainingai/shared/fitness-tests/test-activity'
import { getProtocol } from '@trainingai/shared/fitness-tests/protocols'
import { hasRealConstants } from '@/lib/oura-models/__fixtures__/real-constants'

/**
 * BF-160 — the point of writing an activity is that `computeActiveEnergy` has exactly three
 * sources (strength sessions, logged activities, passive steps) and no fourth. These assertions run
 * the owner's measured 2026-09-14 Cooper through the real energy path rather than through the
 * builder alone, because "it earns calories now" is a claim about this function, not that one.
 *
 * Magnitudes are guarded on `hasRealConstants()` for the reason documented in
 * `daily-energy-per-session.test.ts`: CI's synthetic MET table can put an estimate at 0, which
 * makes a `> 0` assertion fail on fixtures and pass vacuously about zeros. The two claims that
 * matter at any MET — the run appears as its own term, and it never adds steps — are ungated.
 */
const profile = { ageYears: 33, weightKg: 80, sex: 'male' as const }
const START = 1_757_800_000_000

// The measured run: 1,975 m in 720 s, avg HR 156, peak 175, with 894 pedometer steps that day.
const cooperActivity = buildTestActivity({
  protocol: getProtocol('cooper12')!,
  startMs: START, endMs: START + 720_000,
  distanceM: 1975, avgHr: 156, maxHr: 175,
})!
const PEDOMETER_STEPS = 894

const withoutTest = { profile, strengthSessions: [], activities: [], pedometerSteps: PEDOMETER_STEPS }
const withTest = {
  ...withoutTest,
  activities: [{
    activityType: cooperActivity.activityType,
    durationMin: cooperActivity.durationMin,
    distanceKm: cooperActivity.distanceKm,
  }],
}

describe('BF-160 — the logged test reaches the calorie budget', () => {
  it('was earning nothing at all before: no strength session, no activity, only the day\'s steps', () => {
    expect(computeActiveEnergy(withoutTest).activityKcal).toBe(0)
  })

  it('never credits the run as steps as well — the passive term can only fall', () => {
    const before = computeActiveEnergy(withoutTest)
    const after = computeActiveEnergy(withTest)
    expect(after.stepsKcal).toBeLessThanOrEqual(before.stepsKcal)
  })

  it('zeroes the passive term outright here, because 1.98 km implies more steps than the day recorded', () => {
    // Not a coincidence worth hiding: the pedometer missed the run (894 steps for the whole day),
    // so the overlap subtraction takes the passive term to nothing and the run's own estimate is
    // the entire credit. This is what makes the change a real gain rather than a reshuffle.
    expect(computeActiveEnergy(withTest).stepsKcal).toBe(0)
  })

  it.runIf(hasRealConstants())('raises the day\'s active energy overall', () => {
    const before = computeActiveEnergy(withoutTest)
    const after = computeActiveEnergy(withTest)
    expect(after.activityKcal).toBeGreaterThan(0)
    expect(after.total).toBeGreaterThan(before.total)
  })
})
