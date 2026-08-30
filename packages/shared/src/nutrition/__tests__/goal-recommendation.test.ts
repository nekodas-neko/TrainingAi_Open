import { describe, it, expect } from 'vitest'
import { calculateBaseline, clampRecommendation, carbsFromRemainder, reconcileDailyMacros, type RawRecommendation, type BaselineResult } from '../goal-recommendation'

// Q-401: `ACTIVITY_MULTIPLIERS` is gone, and this is the test that used to pin it. The app ran two
// TDEE models — this one folded a *self-reported* activity level into the calorie target while
// `daily-energy.ts` measured movement and added it — so a `light` user saw 1,892 here against 1,626
// there, 274 kcal apart on one screen, both labelled "left".
//
// The contract now: baseline = BMR × sedentary, everywhere, and activity is only ever ADDED.
describe('calculateBaseline is activity-independent (Q-401)', () => {
  const person = { weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' as const, fitnessGoal: 'maintain' as const }

  it('returns the SAME calories for every activity level — that is the whole point', () => {
    const levels = ['sedentary', 'light', 'moderate', 'active', 'extra_active'] as const
    const results = levels.map(activityLevel => calculateBaseline({ ...person, activityLevel }))
    const calories = new Set(results.map(r => r.calories))

    expect(calories.size).toBe(1)
    // BMR 1780 × 1.2 sedentary, maintain adds 0. Previously 'moderate' gave 2759 (× 1.55).
    expect([...calories][0]).toBe(2136)
  })

  it('still varies step goal and water by activity — those are not double-counted', () => {
    const sedentary = calculateBaseline({ ...person, activityLevel: 'sedentary' })
    const active = calculateBaseline({ ...person, activityLevel: 'active' })

    expect(active.stepsGoal).toBeGreaterThan(sedentary.stepsGoal)
    expect(active.waterMl).toBeGreaterThan(sedentary.waterMl)
  })

  it('agrees with the measured model it used to contradict', () => {
    // `energy-balance-service` computes its formula baseline as `bmr * SEDENTARY_MULTIPLIER`. After
    // this change the two are the same expression, which is what "one TDEE model" means.
    const { bmr, tdee } = calculateBaseline({ ...person, activityLevel: 'light' })
    expect(tdee).toBe(Math.round(bmr * 1.2))
  })
})

describe('calculateBaseline', () => {
  it('computes baseline for a male maintaining weight at moderate activity', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1780, tdee: 2136, calories: 2136,
      proteinG: 128, carbsG: 273, fatG: 59,
      waterMl: 2890, stepsGoal: 10000,
    })
  })

  it('applies the lose_weight calorie deficit and higher protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'lose_weight',
    })
    // 2136 sedentary tdee − 500. Was 2259 (× 1.55 moderate).
    expect(result.calories).toBe(1636)
    expect(result.proteinG).toBe(144)
    expect(result.fatG).toBe(45)
    expect(result.carbsG).toBe(164)
  })

  it('applies the build_muscle calorie surplus and protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'build_muscle',
    })
    expect(result.calories).toBe(2436)
    expect(result.proteinG).toBe(160)
    expect(result.fatG).toBe(68)
    expect(result.carbsG).toBe(296)
  })

  it('applies the recomp deficit with the highest protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'recomp',
    })
    expect(result.calories).toBe(1936)
    expect(result.proteinG).toBe(176)
    expect(result.fatG).toBe(54)
    expect(result.carbsG).toBe(187)
  })

  it('computes baseline for a female at light activity (no water bump)', () => {
    const result = calculateBaseline({
      weightKg: 65, heightCm: 165, ageYears: 28, sex: 'female',
      activityLevel: 'light', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1380, tdee: 1656, calories: 1656,
      proteinG: 104, carbsG: 207, fatG: 46,
      waterMl: 2145, stepsGoal: 8500,
    })
  })

  it('computes baseline for sex "other" at sedentary activity', () => {
    const result = calculateBaseline({
      weightKg: 70, heightCm: 170, ageYears: 25, sex: 'other',
      activityLevel: 'sedentary', fitnessGoal: 'maintain',
    })
    expect(result.bmr).toBe(1560)
    expect(result.tdee).toBe(1872)
    expect(result.calories).toBe(1872)
    expect(result.proteinG).toBe(112)
    expect(result.leanMassKg).toBeUndefined()
  })

  it('uses Katch-McArdle BMR and lean-mass protein when bodyFatPct is provided', () => {
    // 80kg at 20% BF → leanMassKg = 64
    // BMR = 370 + 21.6 × 64 = 1752
    // TDEE = 1752 × 1.2 sedentary = 2102; protein (maintain 1.6g/kg lean) = 102.
    // The activity level is 'moderate' and deliberately does NOT change the TDEE (Q-401) — it is
    // left set here precisely so this test would fail if the multiplier ever came back.
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
      bodyFatPct: 20,
    })
    expect(result.leanMassKg).toBe(64)
    expect(result.bmr).toBe(1752)
    expect(result.tdee).toBe(2102)
    expect(result.proteinG).toBe(102)
  })

  it('Katch-McArdle produces lower BMR and protein at high body fat vs Mifflin', () => {
    // 100kg at 40% BF → leanMassKg = 60
    // Katch-McArdle BMR = 370 + 21.6×60 = 1666 vs Mifflin ≈1733 for same person
    const withBf = calculateBaseline({
      weightKg: 100, heightCm: 175, ageYears: 40, sex: 'female',
      activityLevel: 'light', fitnessGoal: 'lose_weight',
      bodyFatPct: 40,
    })
    const withoutBf = calculateBaseline({
      weightKg: 100, heightCm: 175, ageYears: 40, sex: 'female',
      activityLevel: 'light', fitnessGoal: 'lose_weight',
    })
    expect(withBf.leanMassKg).toBe(60)
    expect(withBf.bmr).toBeLessThan(withoutBf.bmr)
    expect(withBf.proteinG).toBeLessThan(withoutBf.proteinG)
  })
})

describe('clampRecommendation', () => {
  const baseline: BaselineResult = {
    bmr: 1600, tdee: 2000, calories: 1800,
    proteinG: 130, carbsG: 180, fatG: 50,
    waterMl: 2500, stepsGoal: 10000,
  }
  const weightKg = 80

  function raw(overrides: Partial<RawRecommendation> = {}): RawRecommendation {
    return {
      recommendedStepsGoal: 10000,
      recommendedCalories: 1900,
      recommendedProteinG: 140,
      recommendedCarbsG: 999, // always recomputed — value here should be ignored
      recommendedFatG: 60,
      recommendedWaterMl: 2500,
      recommendedActivityLevel: null,
      dataQualityNote: '',
      ...overrides,
    }
  }

  it('passes through a fully valid recommendation, recomputing carbs', () => {
    const result = clampRecommendation(raw({ dataQualityNote: 'Looks good' }), baseline, weightKg)
    expect(result).toEqual({
      recommendedStepsGoal: 10000,
      recommendedCalories: 1900,
      recommendedProteinG: 140,
      recommendedCarbsG: 200,
      recommendedFatG: 60,
      recommendedWaterMl: 2500,
      recommendedActivityLevel: null,
      dataQualityNote: 'Looks good',
    })
  })

  it('clamps calories below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedCalories: 1400 }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(1600)
    expect(result.recommendedCarbsG).toBe(125)
    expect(result.dataQualityNote).toBe('Calories adjusted to safe minimum (1600).')
  })

  it('clamps calories above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedCalories: 2400, recommendedFatG: 80 }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(2160)
    expect(result.recommendedFatG).toBe(80)
    expect(result.recommendedCarbsG).toBe(220)
    expect(result.dataQualityNote).toBe('Calories adjusted to safe maximum (2160).')
  })

  it('clamps protein below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedProteinG: 50 }), baseline, weightKg)
    expect(result.recommendedProteinG).toBe(80)
    expect(result.recommendedCarbsG).toBe(260)
    expect(result.dataQualityNote).toBe('Protein adjusted to minimum (80g).')
  })

  it('clamps protein above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedProteinG: 250 }), baseline, weightKg)
    expect(result.recommendedProteinG).toBe(200)
    expect(result.recommendedCarbsG).toBe(140)
    expect(result.dataQualityNote).toBe('Protein adjusted to maximum (200g).')
  })

  it('clamps fat below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedFatG: 30 }), baseline, weightKg)
    expect(result.recommendedFatG).toBe(48)
    expect(result.recommendedCarbsG).toBe(227)
    expect(result.dataQualityNote).toBe('Fat adjusted to minimum (48g).')
  })

  it('clamps fat above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedFatG: 120 }), baseline, weightKg)
    expect(result.recommendedFatG).toBe(84)
    expect(result.recommendedCarbsG).toBe(146)
    expect(result.dataQualityNote).toBe('Fat adjusted to maximum (84g).')
  })

  it('caps the weight-based fat minimum at the calorie-derived maximum for heavy/low-calorie cases', () => {
    // weightKg=150 -> naive fatMin = round(0.6*150) = 90, but calories=1877 -> fatMax = floor(1877*0.4/9) = 83.
    // Without capping fatMin at fatMax, fatG would be pushed to 90g (43% of calories), violating the <=40% bound.
    const tightBaseline: BaselineResult = {
      bmr: 1877, tdee: 1877, calories: 1877,
      proteinG: 150, carbsG: 150, fatG: 60,
      waterMl: 2500, stepsGoal: 10000,
    }
    const result = clampRecommendation(raw({ recommendedCalories: 1877, recommendedProteinG: 150, recommendedFatG: 60 }), tightBaseline, 150)
    expect(result.recommendedFatG).toBe(83)
    expect(result.recommendedCarbsG).toBe(133)
    expect(result.dataQualityNote).toBe('Fat adjusted to minimum (83g).')
  })

  it('clamps water below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedWaterMl: 1000 }), baseline, weightKg)
    expect(result.recommendedWaterMl).toBe(1500)
    expect(result.dataQualityNote).toBe('Water adjusted to minimum (1500ml).')
  })

  it('clamps water above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedWaterMl: 7000 }), baseline, weightKg)
    expect(result.recommendedWaterMl).toBe(6000)
    expect(result.dataQualityNote).toBe('Water adjusted to maximum (6000ml).')
  })

  it('clamps steps goal below the minimum', () => {
    const result = clampRecommendation(raw({ recommendedStepsGoal: 2000 }), baseline, weightKg)
    expect(result.recommendedStepsGoal).toBe(3000)
    expect(result.dataQualityNote).toBe('Steps goal adjusted to minimum (3000).')
  })

  it('clamps steps goal above the maximum', () => {
    const result = clampRecommendation(raw({ recommendedStepsGoal: 25000 }), baseline, weightKg)
    expect(result.recommendedStepsGoal).toBe(20000)
    expect(result.dataQualityNote).toBe('Steps goal adjusted to maximum (20000).')
  })

  it('passes through a valid recommended activity level', () => {
    const result = clampRecommendation(raw({ recommendedActivityLevel: 'active' }), baseline, weightKg)
    expect(result.recommendedActivityLevel).toBe('active')
    expect(result.dataQualityNote).toBe('')
  })

  it('discards an invalid recommended activity level', () => {
    const result = clampRecommendation(raw({ recommendedActivityLevel: 'super_active' }), baseline, weightKg)
    expect(result.recommendedActivityLevel).toBeNull()
    expect(result.dataQualityNote).toBe('Suggested activity level was invalid and has been ignored.')
  })

  it('combines multiple clamp notes with the AI note', () => {
    const result = clampRecommendation(raw({
      recommendedCalories: 2500, recommendedProteinG: 250, recommendedFatG: 60,
      dataQualityNote: 'Based on baseline.',
    }), baseline, weightKg)
    expect(result.recommendedCalories).toBe(2160)
    expect(result.recommendedProteinG).toBe(200)
    expect(result.recommendedFatG).toBe(60)
    expect(result.recommendedCarbsG).toBe(205)
    expect(result.dataQualityNote).toBe(
      'Based on baseline. Calories adjusted to safe maximum (2160). Protein adjusted to maximum (200g).'
    )
  })
})

describe('reconcileDailyMacros', () => {
  const kcal = (m: { proteinG: number; carbsG: number; fatG: number }) =>
    m.proteinG * 4 + m.carbsG * 4 + m.fatG * 9

  it('leaves a macro set that already adds up alone', () => {
    const r = reconcileDailyMacros(1860, { proteinG: 150, carbsG: 180, fatG: 60 })
    expect(r.adjusted).toBe(false)
    expect(r).toMatchObject({ proteinG: 150, carbsG: 180, fatG: 60 })
  })

  it('refits carbs when the saved macros overshoot the calorie goal', () => {
    // The seeded account: 150P/180C/60F is 1,860 kcal beside a 1,750 kcal goal.
    const r = reconcileDailyMacros(1750, { proteinG: 150, carbsG: 180, fatG: 60 })
    expect(r.adjusted).toBe(true)
    expect(r.proteinG).toBe(150)
    expect(r.fatG).toBe(60)
    expect(kcal(r)).toBeCloseTo(1750, -1)
  })

  it('refits carbs upward when the saved macros undershoot', () => {
    const r = reconcileDailyMacros(2400, { proteinG: 150, carbsG: 180, fatG: 60 })
    expect(r.carbsG).toBeGreaterThan(180)
    expect(kcal(r)).toBeCloseTo(2400, -1)
  })

  it('scales protein and fat together when they alone overrun the budget', () => {
    const r = reconcileDailyMacros(1000, { proteinG: 200, carbsG: 100, fatG: 80 })
    expect(r.carbsG).toBe(0)
    expect(r.proteinG).toBeLessThan(200)
    expect(r.fatG).toBeLessThan(80)
    expect(kcal(r)).toBeCloseTo(1000, -2)
  })

  it('never returns a negative carb target', () => {
    for (const cal of [0, 500, 1200, 3000]) {
      const r = reconcileDailyMacros(cal, { proteinG: 180, carbsG: 50, fatG: 70 })
      expect(r.carbsG).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('carbsFromRemainder', () => {
  it('is the calorie budget left after protein and fat', () => {
    expect(carbsFromRemainder(2000, 150, 60)).toBe(Math.round((2000 - 600 - 540) / 4))
  })

  it('floors at zero rather than going negative', () => {
    expect(carbsFromRemainder(800, 150, 60)).toBe(0)
  })
})

/**
 * Q-527 — a scale misread must not become a calorie and protein target.
 *
 * `calculateBaseline` used to derive lean mass with its own inline `weight × (1 − bf/100)`, which is
 * the same arithmetic `bodyComposition` does but **without the plausibility band**. So a no-contact
 * weigh-in floored to 3% body fat (impedance 0 — see `lib/scale-ble/composition.ts`) put lean mass
 * at 97% of bodyweight and drove Katch-McArdle from it, on the surface that sets what the user eats.
 *
 * The band lives in exactly one place now, and these pin that this function reads it.
 */
describe('calculateBaseline refuses an implausible body-fat reading (Q-527)', () => {
  const person = { weightKg: 72.55, heightCm: 180, ageYears: 30, sex: 'male' as const, fitnessGoal: 'maintain' as const, activityLevel: 'sedentary' as const }

  it('does not report a lean mass for the floored 3% reading', () => {
    expect(calculateBaseline({ ...person, bodyFatPct: 3 }).leanMassKg).toBeUndefined()
  })

  it('falls through to Mifflin-St Jeor rather than Katch-McArdle from a misread', () => {
    const misread = calculateBaseline({ ...person, bodyFatPct: 3 })
    const noReading = calculateBaseline(person)
    // Identical, because both take the Mifflin branch. Inline-derived lean mass gave 70.4 kg here,
    // a Cunningham BMR of ~1,890 against Mifflin's 1,708 — a ~180 kcal error in the daily target.
    expect(misread.bmr).toBe(noReading.bmr)
    expect(misread.calories).toBe(noReading.calories)
  })

  it('still uses Katch-McArdle for a real reading', () => {
    const real = calculateBaseline({ ...person, bodyFatPct: 24 })
    expect(real.leanMassKg).toBeCloseTo(55.1, 1)
    expect(real.bmr).not.toBe(calculateBaseline(person).bmr)
  })
})
