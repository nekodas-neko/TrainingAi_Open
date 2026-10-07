/**
 * BF-152 — the wiring, not the formula.
 *
 * `budgetProvenance` has its own unit tests. What those cannot see is WHICH number the service hands
 * it, and that is the whole change: swap `restingRateKcal: bmr` for `restingRateKcal: restingBaseKcal`
 * and every formula test still passes while the screen shows the estimator-inflated figure BF-150 was
 * escaping. BF-150's own version of this file existed because the equivalent mutant survived a first
 * pass; this is its replacement, pinned to the opposite anchor.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'

const TZ = 'Australia/Brisbane'
const DATE = '2026-09-13'

// The owner's real profile, so the assertions are the numbers he sees: 158 cm, 33, male, 70.2 kg at
// 25.5% on 2026-09-13, RMR 1,325 measured 2026-08-27 on 51.5 kg of fat-free mass, stored target
// 1,660 kcal. All read from production 2026-09-13.
let storedCalories: number | null = 1660
let bodyFatPct: number | null = 25.5
let measuredRmr: { rmrKcal: number; ffmKgAtTest: number | null; measuredOn: string } | null =
  { rmrKcal: 1325, ffmKgAtTest: 51.5, measuredOn: '2026-08-27' }

const repo = {
  listBodyMetrics: async () => [{ date: DATE, weightKg: 70.2, bodyFatPct }],
  listFoodLogsSummary: async () => [],
  listActivityLogs: async () => [],
  getWorkoutSessionsFrom: async () => [],
  getNutritionTargets: async () => (storedCalories == null ? null : {
    calories: storedCalories, proteinG: 150, carbsG: 141, fatG: 55,
  }),
  getUserGoals: async () => null,
  getUserById: async () => ({ heightCm: 158, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'lose_fat' }),
  listDayCheckins: async () => [],
  getBodyFatCalibration: async () => null,
  getLatestMeasuredRmr: async () => measuredRmr,
  getAvgBpmBySession: async () => new Map<string, number>(),
} as unknown as Parameters<typeof computeEnergyBalance>[0]

beforeEach(() => {
  storedCalories = 1660
  bodyFatPct = 25.5
  measuredRmr = { rmrKcal: 1325, ffmKgAtTest: 51.5, measuredOn: '2026-08-27' }
})

describe('the budget anchors to the measured resting rate', () => {
  // 1,325 measured on 51.5 kg FFM; today's FFM is 70.2 × (1 − 0.255) = 52.3 kg. The Cunningham
  // residual is 1325 − (51.5 × 21.6 + 370) = −157, so today reads 52.3 × 21.6 + 370 − 157 = 1,342.
  // That is the owner's own *"should start at 1350"* to within 8 kcal, and it is a re-scaling rather
  // than the stored measurement — which is the point of anchoring here instead of to a typed number.
  // Whole kcal on the wire, so the field and the figure the card prints are the same number.
  it('carries the re-scaled measurement onto the balance', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    expect(r.balance?.restingRateKcal).toBe(1342)
  })

  // #2071 kept the anchor and changed what is built on it: RMR − the goal's deficit + the 20% metabolic
  // burn + movement. This fixture has no goal weight (`getUserGoals` → null), so the deficit is 0 and
  // the still-day budget is 1,342 × 1.2 = 1,610.4 → 1,610.
  it('builds the budget on the resting rate plus earned movement, whatever the estimator says', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    const b = r.balance!
    expect(b.deficitKcal).toBe(0)
    expect(budgetProvenance(b)).toMatchObject({ base: 1610, anchoredToRestingRate: true })
    expect(budgetProvenance(b).chain).toMatchObject({ rmr: 1342, deficit: 0, metabolicBurn: 268 })
    expect(budgetProvenance(b).total).toBe(1610 + Math.round(b.activeKcal))
  })

  // The anchor must NOT be `restingBaseKcal`. On a no-food fixture the two are far apart, and the
  // whole defect BF-152 fixes is the budget following the maintenance estimator.
  it('does not anchor to the resting base the estimator produces', async () => {
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(budgetProvenance(b).base).not.toBe(Math.round(b.restingBaseKcal))
    expect(budgetProvenance(b).base).not.toBe(Math.round(b.restingBaseKcal + b.targetNetKcal))
  })

  // BF-152's fallback order: re-scaled measurement → prediction → the old expression. With no
  // measurement the prediction takes over, and it must still be an anchor rather than a fall-through
  // to the estimator — a user with no RMR test must not land on a worse number than they have today.
  it('falls back to the predicted BMR when no RMR has been measured', async () => {
    measuredRmr = null
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    // Cunningham on 52.3 kg of fat-free mass, with no residual to carry: 52.3 × 21.6 + 370 = 1,500,
    // and the still-day budget on it (#2071, no deficit here) 1,500 × 1.2 = 1,800.
    expect(b.restingRateKcal).toBe(1500)
    expect(budgetProvenance(b).base).toBe(1800)
    expect(budgetProvenance(b).anchoredToRestingRate).toBe(true)
  })

  // The stored target stops anchoring anything and goes back to being a target.
  it('leaves the stored target out of the budget entirely', async () => {
    const withGoal = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    storedCalories = 1350
    const withOther = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(budgetProvenance(withOther).total).toBe(budgetProvenance(withGoal).total)
  })

  it('still reports the stored target as the target', async () => {
    const r = await computeEnergyBalance(repo, 'u-1', TZ, DATE)
    expect(r.target.currentKcal).toBe(1660)
  })

  // #2413. The explainer called the rate "measured" whenever one was set, but it is
  // `measuredBmr ?? formula`, and the payload did not say which.
  it('says the rate is measured, and from which test, when a measurement produced it', async () => {
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(b.restingRateSource).toBe('measured')
    expect(b.restingRateMeasuredOn).toBe('2026-08-27')
  })

  it('says the rate is a formula, with no test date, when nothing was measured', async () => {
    measuredRmr = null
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(b.restingRateSource).toBe('formula')
    expect(b.restingRateMeasuredOn).toBeNull()
  })

  // `personalRmr` declines a measurement it cannot use (a non-positive rate). The rate is then the
  // formula, and calling it measured because a row exists is the exact mislabel this fixes.
  it('says formula when a measurement exists but could not be used', async () => {
    measuredRmr = { rmrKcal: 0, ffmKgAtTest: 51.5, measuredOn: '2026-08-27' }
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(b.restingRateSource).toBe('formula')
    expect(b.restingRateMeasuredOn).toBeNull()
  })

  // Without a fat-free mass at the test it is carried as measured, unscaled — still the test.
  it('still says measured when the test has no fat-free mass to re-scale from', async () => {
    measuredRmr = { rmrKcal: 1325, ffmKgAtTest: null, measuredOn: '2026-08-27' }
    const b = (await computeEnergyBalance(repo, 'u-1', TZ, DATE)).balance!
    expect(b.restingRateKcal).toBe(1325)
    expect(b.restingRateSource).toBe('measured')
  })
})
