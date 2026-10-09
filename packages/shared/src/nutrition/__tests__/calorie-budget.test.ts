import { describe, it, expect } from 'vitest'
import {
  calorieBudget, goalDeficitKcal, GOAL_RATE_PCT_PER_WEEK, GOAL_EASE_BAND_KG,
  ownTargetFromGoals, validOwnTarget,
} from '@trainingai/shared/nutrition/calorie-budget'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { stepEnergyKcal, STEP_BASE_CREDIT } from '@trainingai/shared/health/daily-energy'

/**
 * #2071 — the owner's final spec (2026-10-05) and his answers of 2026-10-07 (#2071, #2621):
 *
 *   budget = RMR − deficit + (RMR × 0.2 − the first 3,000 steps' energy) + movement,
 *   never below max(RMR, 1,200); the deficit from the goal's weekly rate on the TREND weight, eased
 *   inside 2 kg of the goal weight.
 *
 * His own day is the anchor: 70.3 kg aiming for 60 kg on recomp, RMR 1,304, 237 kcal of movement,
 * and a 3,000-step credit of 100 kcal at his profile (33, male, 70.3 kg) — computed below by the
 * energy model's own `stepEnergyKcal`, never typed in.
 */
const OWNER = { goal: 'recomp' as const, currentWeightKg: 70.3, targetWeightKg: 60 }
const OWNER_PROFILE = { ageYears: 33, weightKg: 70.3, sex: 'male' as const }
const CREDIT = stepEnergyKcal(OWNER_PROFILE, STEP_BASE_CREDIT)
const ownerDay = (movementKcal: number) =>
  calorieBudget({ rmrKcal: 1304, deficitKcal: Math.round(goalDeficitKcal(OWNER)), movementKcal, stepCreditKcal: CREDIT })

describe('goalDeficitKcal', () => {
  it("is 0.3% of the weight a week on recomp, in kcal/day — the owner's 232", () => {
    expect(goalDeficitKcal(OWNER)).toBeCloseTo((0.003 * 70.3 * 7700) / 7, 6)
    expect(Math.round(goalDeficitKcal(OWNER))).toBe(232)
  })

  it('shrinks as weight falls, because it is re-derived from the weight it is given', () => {
    const at703 = goalDeficitKcal(OWNER)
    const at66 = goalDeficitKcal({ ...OWNER, currentWeightKg: 66 })
    const at63 = goalDeficitKcal({ ...OWNER, currentWeightKg: 63 })
    expect(at66).toBeLessThan(at703)
    expect(at63).toBeLessThan(at66)
    expect(Math.round(at66)).toBe(218) // 0.003 × 66 × 7,700 / 7 = 217.8
  })

  it('eases off linearly inside the last 2 kg and reaches 0 at the goal', () => {
    expect(GOAL_EASE_BAND_KG).toBe(2)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 62 })).toBeCloseTo((0.003 * 62 * 7700) / 7, 6) // edge: full
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 61 })).toBeCloseTo((0.003 * 61 * 7700) / 7 / 2, 6)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 60.5 })).toBeCloseTo((0.003 * 60.5 * 7700) / 7 / 4, 6)
    expect(goalDeficitKcal({ ...OWNER, currentWeightKg: 60 })).toBe(0)
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

  // #2621, owner 2026-10-07: a cut at 0.5% and a bulk at 0.25% of body weight a week.
  it('cuts at 0.5% of the weight a week', () => {
    expect(GOAL_RATE_PCT_PER_WEEK.lose_weight).toBe(0.005)
    expect(goalDeficitKcal({ goal: 'lose_weight', currentWeightKg: 90, targetWeightKg: 80 }))
      .toBeCloseTo((0.005 * 90 * 7700) / 7, 6) // 495
  })

  it('bulks at 0.25% of the weight a week, as a surplus, toward a goal ABOVE the weight', () => {
    expect(GOAL_RATE_PCT_PER_WEEK.build_muscle).toBe(-0.0025)
    expect(goalDeficitKcal({ goal: 'build_muscle', currentWeightKg: 70, targetWeightKg: 75 }))
      .toBeCloseTo(-(0.0025 * 70 * 7700) / 7, 6) // −192.5
    expect(goalDeficitKcal({ goal: 'build_muscle', currentWeightKg: 76, targetWeightKg: 75 })).toBe(0)
  })

  it('eases cut and bulk inside 2 kg of the goal exactly as recomp does', () => {
    expect(goalDeficitKcal({ goal: 'lose_weight', currentWeightKg: 81, targetWeightKg: 80 }))
      .toBeCloseTo((0.005 * 81 * 7700) / 7 / 2, 6)
    expect(goalDeficitKcal({ goal: 'build_muscle', currentWeightKg: 74.5, targetWeightKg: 75 }))
      .toBeCloseTo(-(0.0025 * 74.5 * 7700) / 7 / 4, 6)
    expect(goalDeficitKcal({ goal: 'lose_weight', currentWeightKg: 80, targetWeightKg: 80 })).toBe(0)
  })
})

describe('calorieBudget', () => {
  it("takes the energy model's own 3,000-step credit — 100 kcal at the owner's profile", () => {
    expect(CREDIT).toBe(100)
  })

  // Owner 2026-10-07 (a): "only steps above about 3,000 a day count".
  it("is the owner's day: 1,304 − 232 + (261 − 100) + 237 ≈ 1,470", () => {
    const b = ownerDay(237)
    expect(b.metabolicBurnKcal).toBe(261)
    expect(b.stepCreditKcal).toBe(100)
    expect(b.dailyLivingKcal).toBe(161)
    expect(b.deficitKcal).toBe(232)
    expect(b.totalKcal).toBe(1470)
    expect(b.floored).toBe(false)
  })

  it('is 1,333 on a 3,000-step day — exactly what the credit took out comes back', () => {
    const threeThousand = stepEnergyKcal(OWNER_PROFILE, 3000)
    expect(ownerDay(threeThousand).totalKcal).toBe(1333)
  })

  it('is held at the resting rate on a 0-step day (1,304 − 232 + 161 = 1,233 is below the floor)', () => {
    const still = ownerDay(0)
    expect(still.stillDayKcal).toBe(1304)
    expect(still.totalKcal).toBe(1304)
    expect(still.stillDayFloored).toBe(true)
  })

  it('is RMR × 1.2 + movement with no deficit and no credit', () => {
    expect(calorieBudget({ rmrKcal: 1500, deficitKcal: 0, movementKcal: 200 }).totalKcal).toBe(2000)
  })

  it('never falls below the resting rate, and movement past the floor counts from the arithmetic', () => {
    const still = calorieBudget({ rmrKcal: 1304, deficitKcal: 500, movementKcal: 0 })
    expect(still.totalKcal).toBe(1304)
    expect(still.floored).toBe(true)
    const moved = calorieBudget({ rmrKcal: 1304, deficitKcal: 500, movementKcal: 400 })
    expect(moved.totalKcal).toBe(1465) // 1,304 − 500 + 260.8 + 400
    expect(moved.floored).toBe(false)
  })

  it('never falls below 1,200 when the resting rate is lower', () => {
    const b = calorieBudget({ rmrKcal: 1000, deficitKcal: 300, movementKcal: 0 })
    expect(b.floorKcal).toBe(1200)
    expect(b.totalKcal).toBe(1200)
  })

  it('takes whatever RMR it is handed — a measured one moves the budget by the difference × 1.2', () => {
    const formula = calorieBudget({ rmrKcal: 1481, deficitKcal: 232, movementKcal: 237, stepCreditKcal: 100 })
    const measured = calorieBudget({ rmrKcal: 1325, deficitKcal: 232, movementKcal: 237, stepCreditKcal: 100 })
    expect(formula.totalKcal - measured.totalKcal).toBe(Math.round((1481 - 1325) * 1.2))
  })
})

describe('budgetProvenance on the #2071 path', () => {
  const payload = {
    restingBaseKcal: 1462, activeKcal: 237, targetNetKcal: -232, restingRateKcal: 1304,
    deficitKcal: 232, stepCreditKcal: 100,
  }

  it('returns the shared function’s total, split into the still day and what movement added', () => {
    const p = budgetProvenance(payload)
    expect(p.total).toBe(1470)
    expect(p.base + p.earned).toBe(p.total)
    expect(p.chain).toEqual({
      rmr: 1304, deficit: 232, metabolicBurn: 261, stepCredit: 100, dailyLiving: 161, movement: 237,
      floored: true, totalFloored: false,
    })
    // The chain the provenance line prints reaches the total.
    const c = p.chain!
    expect(c.rmr - c.deficit + c.dailyLiving + c.movement).toBe(p.total)
  })

  it('keeps base + earned equal to the total when the floor binds', () => {
    const p = budgetProvenance({ ...payload, deficitKcal: 500, activeKcal: 100 })
    expect(p.total).toBe(1304)
    expect(p.base + p.earned).toBe(p.total)
    expect(p.chain?.floored).toBe(true)
    expect(p.chain?.totalFloored).toBe(true)
  })

  it('reads the chain unfloored when the still day clears the floor', () => {
    const p = budgetProvenance({ ...payload, deficitKcal: 0 })
    expect(p.chain?.floored).toBe(false)
    expect(p.base).toBe(1304 + 161)
    expect(p.total).toBe(1304 + 161 + 237)
  })

  // A payload cached by the server before #2071 has no `deficitKcal`, and its `remainingKcal` was
  // computed against the BF-152 budget. Reading it on its own terms keeps one card from showing two
  // numbers until the revalidation lands.
  it('reads a pre-#2071 cached payload on its own terms', () => {
    const old = { restingBaseKcal: 1462, activeKcal: 237, targetNetKcal: -200, restingRateKcal: 1304 }
    expect(budgetProvenance(old)).toMatchObject({ base: 1304, earned: 237, total: 1541, chain: null })
  })
})

// Issue 2622 — the override lives inside the one function: `ownTarget ?? derived`.
describe('calorieBudget — the user own target', () => {
  const worked = ownerDay(237)

  it('is the budget when set, for the total and the still day', () => {
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 237, stepCreditKcal: CREDIT, ownTargetKcal: 1800 })
    expect(b.totalKcal).toBe(1800)
    expect(b.stillDayKcal).toBe(1800)
    expect(b.ownTarget).toBe(true)
  })

  it('still reports what the worked-out budget would be (the "would be" line)', () => {
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 237, stepCreditKcal: CREDIT, ownTargetKcal: 1800 })
    expect(b.workedOutKcal).toBe(worked.totalKcal)
    expect(b.workedOutStillDayKcal).toBe(worked.stillDayKcal)
    expect(b.workedOutKcal).not.toBe(1800)
  })

  it('does not grow with movement', () => {
    const a = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 0, ownTargetKcal: 1800 })
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 900, ownTargetKcal: 1800 })
    expect(a.totalKcal).toBe(1800)
    expect(b.totalKcal).toBe(1800)
  })

  it('is not floored: the target is the owner choice, even below max(RMR, 1,200)', () => {
    const b = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 237, ownTargetKcal: 900 })
    expect(b.totalKcal).toBe(900)
    expect(b.workedOutKcal).toBeGreaterThanOrEqual(1304)
  })

  it('falls back to the derived budget when cleared (null, absent, zero, NaN)', () => {
    for (const ownTargetKcal of [null, undefined, 0, -5, Number.NaN]) {
      const b = calorieBudget({ rmrKcal: 1304, deficitKcal: 232, movementKcal: 237, stepCreditKcal: CREDIT, ownTargetKcal })
      expect(b.totalKcal).toBe(worked.totalKcal)
      expect(b.ownTarget).toBe(false)
      expect(b.workedOutKcal).toBe(b.totalKcal)
    }
  })

  it('passes through budgetProvenance: total and base are the target, workedOutTotal is the rest', () => {
    const p = budgetProvenance({
      restingBaseKcal: 1200, activeKcal: 237, targetNetKcal: -232, restingRateKcal: 1304, deficitKcal: 232,
      stepCreditKcal: CREDIT, ownTargetKcal: 1800,
    })
    expect(p.total).toBe(1800)
    expect(p.base).toBe(1800)
    expect(p.earned).toBe(0)
    expect(p.ownTarget).toBe(true)
    expect(p.workedOutTotal).toBe(worked.totalKcal)
  })

  it('reads the flag from users.calorie_goal / calorie_goal_type in one place', () => {
    expect(ownTargetFromGoals({ calorieGoal: 1800, calorieGoalType: 'own' })).toBe(1800)
    // A retired typed goal is not an override, whatever its unit.
    expect(ownTargetFromGoals({ calorieGoal: 2400, calorieGoalType: 'daily' })).toBeNull()
    expect(ownTargetFromGoals({ calorieGoal: 2400, calorieGoalType: 'weekly' })).toBeNull()
    expect(ownTargetFromGoals({ calorieGoal: 2400, calorieGoalType: null })).toBeNull()
    expect(ownTargetFromGoals({ calorieGoal: null, calorieGoalType: 'own' })).toBeNull()
    expect(ownTargetFromGoals(null)).toBeNull()
    expect(validOwnTarget(1800)).toBe(1800)
    expect(validOwnTarget(0)).toBeNull()
  })
})
