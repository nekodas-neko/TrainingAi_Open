import { describe, it, expect } from 'vitest'
import {
  calorieBudget, goalDeficitKcal, GOAL_RATE, GOAL_EASE_BAND_KG,
} from '@trainingai/shared/nutrition/calorie-budget'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { CALORIE_ADJUSTMENT_BY_GOAL } from '@trainingai/shared/nutrition/goal-recommendation'

/**
 * #2071 — the owner's final spec (2026-10-05): budget = RMR − deficit + metabolic burn + movement,
 * floored at max(RMR, 1,200), the deficit derived from the goal and today's weight.
 *
 * His own day is the anchor: 70.3 kg aiming for 60 kg on recomp, RMR 1,304, 237 kcal of movement.
 * "deficit ≈ 0.003 × 70.3 × 7,700 / 7 ≈ 232 kcal. RMR 1,304 − 232 + 261 + movement 237 ≈ 1,570. A
 * still day ≈ 1,333."
 */
const OWNER = { goal: 'recomp' as const, currentWeightKg: 70.3, targetWeightKg: 60 }

describe('goalDeficitKcal', () => {
  it("is 0.3% of today's weight a week on recomp, in kcal/day — the owner's 232", () => {
    expect(goalDeficitKcal(OWNER)).toBeCloseTo((0.003 * 70.3 * 7700) / 7, 6)
    expect(Math.round(goalDeficitKcal(OWNER))).toBe(232)
  })

  it('shrinks as weight falls, because it is re-derived from the current weight', () => {
    const at703 = goalDeficitKcal(OWNER)
    const at66 = goalDeficitKcal({ ...OWNER, currentWeightKg: 66 })
    const at63 = goalDeficitKcal({ ...OWNER, currentWeightKg: 63 })
    expect(at66).toBeLessThan(at703)
    expect(at63).toBeLessThan(at66)
    expect(Math.round(at66)).toBe(218) // 0.003 × 66 × 7,700 / 7 = 217.8
  })

  it('eases off linearly inside the last 2 kg and reaches 0 at the goal', () => {
    const full = (0.003 * 61 * 7700) / 7
    expect(GOAL_EASE_BAND_KG).toBe(2)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 62 })).toBeCloseTo((0.003 * 62 * 7700) / 7, 6) // edge: full
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 61 })).toBeCloseTo(full / 2, 6)              // 1 kg out: half
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 60.5 })).toBeCloseTo((0.003 * 60.5 * 7700) / 7 / 4, 6)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 60 })).toBe(0)                                // at goal
  })

  it('is 0 past the goal, rather than turning into a surplus', () => {
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 59 })).toBe(0)
  })

  it('is 0 with no goal weight set, no current weight, or no goal', () => {
    expect(goalDeficitKcal({ ...OWNER, targetWeightKg: null })).toBe(0)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: null })).toBe(0)
    expect(goalDeficitKcal({ ...OWNER, goal: null })).toBe(0)
  })

  it('is 0 on maintain', () => {
    expect(goalDeficitKcal({ ...OWNER, goal: 'maintain' })).toBe(0)
  })

  // The tuning follow-up owns these values. This pins that the build introduced NO new number for
  // them: they are the recommender's existing offsets, sign-flipped into a deficit.
  it('keeps the existing offsets for cut and bulk, as placeholders', () => {
    expect(GOAL_RATE.lose_weight).toEqual({ kind: 'kcal_per_day', kcal: -CALORIE_ADJUSTMENT_BY_GOAL.lose_weight })
    expect(GOAL_RATE.build_muscle).toEqual({ kind: 'kcal_per_day', kcal: -CALORIE_ADJUSTMENT_BY_GOAL.build_muscle })
    expect(goalDeficitKcal({ goal: 'lose_weight', currentWeightKg: 90, targetWeightKg: 80 })).toBe(500)
    // A bulk is a surplus (negative deficit), and its goal weight lies ABOVE today's.
    expect(goalDeficitKcal({ goal: 'build_muscle', currentWeightKg: 70, targetWeightKg: 75 })).toBe(-300)
    expect(goalDeficitKcal({ goal: 'build_muscle', currentWeightKg: 76, targetWeightKg: 75 })).toBe(0)
  })
})

describe('calorieBudget', () => {
  it("reproduces the owner's day: 1,304 − 232 + 261 + 237 ≈ 1,570", () => {
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: goalDeficitKcal(OWNER), movementKcal: 237 })
    expect(b.metabolicBurnKcal).toBe(261)
    expect(b.deficitKcal).toBe(232)
    expect(b.totalKcal).toBe(1570)
    expect(b.floored).toBe(false)
  })

  it("is the owner's still day, ≈ 1,333, with no movement", () => {
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: goalDeficitKcal(OWNER), movementKcal: 0 })
    expect(b.totalKcal).toBe(1333)
    expect(b.stillDayKcal).toBe(1333)
  })

  it('is RMR × 1.2 + movement with no deficit', () => {
    expect(calorieBudget({ rmrKcal: 1500, deficitKcal: 0, movementKcal: 200 }).totalKcal).toBe(2000)
  })

  it('never falls below the resting rate', () => {
    // A 500 cut on a 1,304 RMR: 1,304 − 500 + 261 = 1,065, below the RMR.
    const still = calorieBudget({ rmrKcal: 1304, deficitKcal: 500, movementKcal: 0 })
    expect(still.totalKcal).toBe(1304)
    expect(still.floored).toBe(true)
    expect(still.stillDayFloored).toBe(true)
    // Movement past the floor is counted again from the arithmetic, not stacked on the floor.
    const moved = calorieBudget({ rmrKcal: 1304, deficitKcal: 500, movementKcal: 400 })
    expect(moved.totalKcal).toBe(1465)
    expect(moved.floored).toBe(false)
  })

  it('never falls below 1,200 when the resting rate is lower', () => {
    const b = calorieBudget({ rmrKcal: 1000, deficitKcal: 300, movementKcal: 0 })
    expect(b.floorKcal).toBe(1200)
    expect(b.totalKcal).toBe(1200)
  })

  it('takes whatever RMR it is handed — a measured one moves the budget by the difference', () => {
    // The resolution (measured test re-scaled, else formula) happens once in the service; the
    // function itself has one input for it, so a measured and a formula RMR differ only there.
    const formula = calorieBudget({ rmrKcal: 1481, deficitKcal: 232, movementKcal: 237 })
    const measured = calorieBudget({ rmrKcal: 1325, deficitKcal: 232, movementKcal: 237 })
    expect(formula.totalKcal - measured.totalKcal).toBe(Math.round((1481 - 1325) * 1.2))
  })
})

describe('budgetProvenance on the #2071 path', () => {
  const payload = {
    restingBaseKcal: 1462, activeKcal: 237, targetNetKcal: -232, restingRateKcal: 1304, deficitKcal: 232,
  }

  it('returns the shared function’s total, split into the still day and what movement added', () => {
    const p = budgetProvenance(payload)
    expect(p.total).toBe(1570)
    expect(p.base).toBe(1333)
    expect(p.earned).toBe(237)
    expect(p.base + p.earned).toBe(p.total)
    expect(p.chain).toEqual({ rmr: 1304, deficit: 232, metabolicBurn: 261, floored: false })
  })

  it('keeps base + earned equal to the total when the floor binds', () => {
    const p = budgetProvenance({ ...payload, deficitKcal: 500, activeKcal: 100 })
    expect(p.total).toBe(1304)
    expect(p.base + p.earned).toBe(p.total)
    expect(p.chain?.floored).toBe(true)
  })

  // A payload cached by the server before #2071 has no `deficitKcal`, and its `remainingKcal` was
  // computed against the BF-152 budget. Reading it on its own terms keeps one card from showing two
  // numbers until the revalidation lands.
  it('reads a pre-#2071 cached payload on its own terms', () => {
    const old = { restingBaseKcal: 1462, activeKcal: 237, targetNetKcal: -200, restingRateKcal: 1304 }
    expect(budgetProvenance(old)).toMatchObject({ base: 1304, earned: 237, total: 1541, chain: null })
  })
})
