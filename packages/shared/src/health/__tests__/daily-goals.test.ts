import { describe, it, expect } from 'vitest'
import { getDailyGoals, DEFAULT_STEP_GOAL, DEFAULT_ACTIVE_ENERGY_GOAL } from '@trainingai/shared/health/daily-goals'

describe('getDailyGoals', () => {
  it('derives an active-energy goal from BMR when the profile is complete', () => {
    // 70 kg / 179 cm / 30 y / male → Mifflin BMR ≈ 1674 → 24% ≈ 402 kcal.
    const g = getDailyGoals({ weightKg: 70, heightCm: 179, ageYears: 30, sex: 'male', activityLevel: 'moderate' })
    expect(g.activeEnergyGoal).toBeGreaterThan(380)
    expect(g.activeEnergyGoal).toBeLessThan(430)
    expect(g.stepGoal).toBe(10000) // moderate activity level
    expect(g.zoneMinutesGoal).toBe(22)
    expect(g.strengthFreqGoal).toBe(5)
  })

  it('falls back to sensible defaults when the profile is incomplete', () => {
    const g = getDailyGoals({})
    expect(g.stepGoal).toBe(DEFAULT_STEP_GOAL)
    expect(g.activeEnergyGoal).toBe(DEFAULT_ACTIVE_ENERGY_GOAL)
  })

  // Q-137 (2026-08-11): 3 was the WHO floor, and a floor is not a target. Against a measured
  // 4.9 sessions/wk it made `strengthFreq` — the largest weight (25) — exactly 100 on all 91
  // measured days. These two pin the properties that chose 5, so a future edit has to argue with
  // the behaviour rather than just the number.
  it('sets the strength goal above the WHO floor, so a short week is distinguishable', () => {
    const goal = getDailyGoals({}).strengthFreqGoal
    expect(goal).toBeGreaterThan(2)  // WHO muscle-strengthening minimum

    // The property that matters: a typical week saturates the curve, a short one must not.
    // STRENGTH_FREQ_CURVE caps at 100 from ratio 1.0, so anything at-or-above goal reads 100.
    expect(5 / goal).toBeGreaterThanOrEqual(1)   // a 5-session week still reaches the target
    expect(3 / goal).toBeLessThan(0.7)           // a 3-session week lands well down the curve
  })

  it('keeps the strength goal at a trainable optimum, not an ever-higher stretch', () => {
    // Deliberately NOT set above typical, unlike the other goals. The model already tapers past
    // the ACWR optimal band, so a higher goal would have one part of it rewarding what another
    // punishes. If this ever exceeds 6, that trade-off has been forgotten.
    expect(getDailyGoals({}).strengthFreqGoal).toBeLessThanOrEqual(6)
  })

  it('scales the energy goal with body weight (heavier → higher)', () => {
    const light = getDailyGoals({ weightKg: 55, heightCm: 165, ageYears: 30, sex: 'female', activityLevel: 'light' })
    const heavy = getDailyGoals({ weightKg: 95, heightCm: 185, ageYears: 30, sex: 'male', activityLevel: 'light' })
    expect(heavy.activeEnergyGoal).toBeGreaterThan(light.activeEnergyGoal)
  })
})

