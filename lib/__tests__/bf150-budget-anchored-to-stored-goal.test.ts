/**
 * BF-150 — the wiring, not the formula.
 *
 * `budgetProvenance` is covered by its own unit tests. What those cannot see is whether the SERVICE
 * actually hands it the stored goal: drop `goalKcal: currentKcal` from the `computeCalorieBalance`
 * call and every formula test still passes while the screen shows the old estimator-anchored number.
 * That mutant survived the first pass, which is why this file exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'

const TZ = 'Australia/Brisbane'
const DATE = '2026-09-12'

// The owner's real profile, so the numbers in the assertions are the ones he sees: 158 cm, 70 kg,
// 33, male, measured RMR 1,325, stored target 1,660 kcal (all read from production 2026-09-12).
let storedCalories: number | null = 1660
let legacyGoal: number | null = null

const repo = {
  listBodyMetrics: async () => [{ date: DATE, weightKg: 70, bodyFatPct: null }],
  listFoodLogsSummary: async () => [],
  listActivityLogs: async () => [],
  getWorkoutSessionsFrom: async () => [],
  getNutritionTargets: async () => (storedCalories == null ? null : {
    calories: storedCalories, proteinG: 150, carbsG: 141, fatG: 55,
  }),
  getUserGoals: async () => (legacyGoal == null ? null : { calorieGoal: legacyGoal }),
  getUserById: async () => ({ heightCm: 158, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'lose_fat' }),
  listDayCheckins: async () => [],
  getBodyFatCalibration: async () => null,
  getLatestMeasuredRmr: async () => ({ rmrKcal: 1325, measuredOn: '2026-08-27' }),
  getAvgBpmBySession: async () => new Map<string, number>(),
} as unknown as Parameters<typeof computeEnergyBalance>[0]

beforeEach(() => { storedCalories = 1660; legacyGoal = null; vi.restoreAllMocks() })

describe('the budget anchors to the stored goal', () => {
  it('carries the stored target onto the balance', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    expect(r.balance?.goalKcal).toBe(1660)
  })

  it('makes the budget the stored goal plus earned movement, whatever the estimator says', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    const b = r.balance!
    expect(budgetProvenance(b)).toMatchObject({ base: 1660, anchoredToGoal: true })
    expect(budgetProvenance(b).total).toBe(1660 + Math.round(b.activeKcal))
  })

  it('falls back to the legacy users.calorie_goal when no nutrition target is stored', async () => {
    storedCalories = null; legacyGoal = 1350
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    expect(r.balance?.goalKcal).toBe(1350)
    expect(budgetProvenance(r.balance!).base).toBe(1350)
  })

  it('leaves a user who has set no goal on the old estimator-anchored budget', async () => {
    storedCalories = null
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    const b = r.balance!
    expect(b.goalKcal).toBeNull()
    expect(budgetProvenance(b).anchoredToGoal).toBe(false)
    expect(budgetProvenance(b).base).toBe(Math.round(b.restingBaseKcal + b.targetNetKcal))
  })

  // The macro grams are stored against the same 1,660, so anchoring the budget to it is what makes
  // the two agree — 150p/141c/55f is 1,659 kcal. BF-150's second bullet needs no separate code.
  it('leaves the macro grams sharing a denominator with the budget', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    const m = r.macroTargets!.base
    const macroKcal = m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9
    expect(Math.abs(macroKcal - budgetProvenance(r.balance!).base)).toBeLessThanOrEqual(5)
  })
})
