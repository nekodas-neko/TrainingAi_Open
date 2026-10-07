/**
 * #2474 — TN-29's measured-movement ceiling counted the BF-88 step credit twice.
 *
 * `measuredMovementMaintenance = formulaBaseline + avgActiveOverWindow`. `formulaBaseline` still
 * holds the energy of the first 3,000 steps, and since BF-88 the movement total counts steps from the
 * first one, so the same walking was in both terms and the ceiling read about one credit high (about
 * 100 kcal for the owner). The ceiling input is now the CREDITED base the measured activity factor
 * already uses: `formulaRestingBaseKcal + avgActiveOverWindow`. Owner signed off 2026-10-06; the 1.15
 * ratio is unchanged and 0 of 41 days move.
 *
 * The ceiling only shows at the accept/reject edge of the calibration, so the test finds that edge:
 * the highest mean intake the service still accepts as `calibrated`, over a flat-weight window where
 * the calibrated maintenance IS the mean intake.
 */
import { describe, it, expect } from 'vitest'
import { computeEnergyBalance } from '@/lib/health/energy-balance-service'
import { MAX_MEASURED_MOVEMENT_RATIO, MAX_WINDOW_DAYS } from '@trainingai/shared/nutrition/adaptive-tdee'
import { SEDENTARY_MULTIPLIER, STEP_BASE_CREDIT, stepEnergyKcal } from '@trainingai/shared/health/daily-energy'
import { shiftDateStr } from '@trainingai/shared/date-utils'

const TZ = 'Australia/Brisbane'
const DATE = '2026-09-13'
const WEIGHT_KG = 70.2

function repoWithIntake(intake: number) {
  const days = Array.from({ length: MAX_WINDOW_DAYS }, (_, i) => shiftDateStr(DATE, -(i + 1)))
  return {
    // Flat weight: the slope is 0, so the calibrated maintenance is exactly the mean intake.
    listBodyMetrics: async () => [DATE, ...days].map(date => ({ date, weightKg: WEIGHT_KG, bodyFatPct: 25.5 })),
    listFoodLogsSummary: async () => days.map(date => ({ date, calories: intake })),
    listActivityLogs: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getNutritionTargets: async () => ({ calories: 1660, proteinG: 150, carbsG: 141, fatG: 55 }),
    getUserGoals: async () => null,
    getUserById: async () => ({ heightCm: 158, sex: 'male', dateOfBirth: '1993-01-01', fitnessGoal: 'lose_fat' }),
    listDayCheckins: async () => days.map(logDate => ({ logDate, foodLoggingCompletedAt: new Date('2026-09-01T12:00:00Z') })),
    getBodyFatCalibration: async () => null,
    getLatestMeasuredRmr: async () => ({ rmrKcal: 1325, ffmKgAtTest: 51.5, measuredOn: '2026-08-27' }),
    getAvgBpmBySession: async () => new Map<string, number>(),
    listDoseHistory: async () => ({ logs: [], courses: [] }),
  } as unknown as Parameters<typeof computeEnergyBalance>[0]
}

const sourceAt = async (intake: number) =>
  (await computeEnergyBalance(repoWithIntake(intake), 'u-1', TZ, DATE)).maintenance?.source

/** The highest whole-kcal mean intake still accepted as a calibrated maintenance. */
async function highestAccepted(): Promise<number> {
  let lo = 1500, hi = 2400   // 1,500 is accepted, 2,400 is not
  expect(await sourceAt(lo)).toBe('calibrated')
  expect(await sourceAt(hi)).toBe('formula')
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await sourceAt(mid) === 'calibrated') lo = mid; else hi = mid
  }
  return lo
}

describe('the measured-movement ceiling counts the step credit once (#2474)', () => {
  it('sits one step credit below where it sat, at ratio × (credited base + movement)', async () => {
    const accepted = await highestAccepted()
    const r = await computeEnergyBalance(repoWithIntake(1500), 'u-1', TZ, DATE)
    const bmr = r.balance!.restingRateKcal!
    const formulaBaseline = Math.round(bmr * SEDENTARY_MULTIPLIER)
    const credit = stepEnergyKcal({ ageYears: 33, weightKg: WEIGHT_KG, sex: 'male' }, STEP_BASE_CREDIT)
    expect(credit).toBeGreaterThan(50)   // a real credit, so the assertions below discriminate

    // No movement in the window (no steps, no workouts), so the ceiling is ratio × the base alone.
    const creditedCeiling = (formulaBaseline - credit) * MAX_MEASURED_MOVEMENT_RATIO
    const doubleCountedCeiling = formulaBaseline * MAX_MEASURED_MOVEMENT_RATIO
    // Within a couple of kcal of the credited ceiling (rounding of bmr and the credit)...
    expect(Math.abs(accepted - creditedCeiling)).toBeLessThanOrEqual(4)
    // ...and clearly below the old one: at least most of one credit's worth of ratio lower.
    expect(accepted).toBeLessThan(doubleCountedCeiling - 0.8 * credit * MAX_MEASURED_MOVEMENT_RATIO)
  })

  it('rejects an intake the old ceiling accepted, falling back to the formula, not clamping', async () => {
    const r = await computeEnergyBalance(repoWithIntake(1500), 'u-1', TZ, DATE)
    const bmr = r.balance!.restingRateKcal!
    const formulaBaseline = Math.round(bmr * SEDENTARY_MULTIPLIER)
    // Midway between the old and new ceilings: the old rule accepted it, the new one must not.
    const credit = stepEnergyKcal({ ageYears: 33, weightKg: WEIGHT_KG, sex: 'male' }, STEP_BASE_CREDIT)
    const between = Math.floor((formulaBaseline * MAX_MEASURED_MOVEMENT_RATIO) - (credit * MAX_MEASURED_MOVEMENT_RATIO) / 2)
    const out = await computeEnergyBalance(repoWithIntake(between), 'u-1', TZ, DATE)
    expect(out.maintenance?.source).toBe('formula')
    expect(out.maintenance?.gapMessage).toMatch(/higher than your measured movement supports/)
  })

  it('still accepts a calibration comfortably under the new ceiling', async () => {
    expect(await sourceAt(1600)).toBe('calibrated')
  })
})
