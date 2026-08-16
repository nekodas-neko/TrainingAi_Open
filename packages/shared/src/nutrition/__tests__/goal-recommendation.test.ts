import { describe, it, expect } from 'vitest'
import { calculateBaseline, ACTIVITY_MULTIPLIERS, clampRecommendation, carbsFromRemainder, reconcileDailyMacros, type RawRecommendation, type BaselineResult } from '../goal-recommendation'

describe('ACTIVITY_MULTIPLIERS', () => {
  it('has all five activity levels', () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, extra_active: 1.9,
    })
  })
})

describe('calculateBaseline', () => {
  it('computes baseline for a male maintaining weight at moderate activity', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1780, tdee: 2759, calories: 2759,
      proteinG: 128, carbsG: 389, fatG: 77,
      waterMl: 2890, stepsGoal: 10000,
    })
  })

  it('applies the lose_weight calorie deficit and higher protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'lose_weight',
    })
    expect(result.calories).toBe(2259)
    expect(result.proteinG).toBe(144)
    expect(result.fatG).toBe(63)
    expect(result.carbsG).toBe(279)
  })

  it('applies the build_muscle calorie surplus and protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'build_muscle',
    })
    expect(result.calories).toBe(3059)
    expect(result.proteinG).toBe(160)
    expect(result.fatG).toBe(85)
    expect(result.carbsG).toBe(414)
  })

  it('applies the recomp deficit with the highest protein target', () => {
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'recomp',
    })
    expect(result.calories).toBe(2559)
    expect(result.proteinG).toBe(176)
    expect(result.fatG).toBe(71)
    expect(result.carbsG).toBe(304)
  })

  it('computes baseline for a female at light activity (no water bump)', () => {
    const result = calculateBaseline({
      weightKg: 65, heightCm: 165, ageYears: 28, sex: 'female',
      activityLevel: 'light', fitnessGoal: 'maintain',
    })
    expect(result).toEqual({
      bmr: 1380, tdee: 1898, calories: 1898,
      proteinG: 104, carbsG: 251, fatG: 53,
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
    // TDEE (moderate 1.55) = 2716; protein (maintain 1.6g/kg lean) = 102
    const result = calculateBaseline({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      activityLevel: 'moderate', fitnessGoal: 'maintain',
      bodyFatPct: 20,
    })
    expect(result.leanMassKg).toBe(64)
    expect(result.bmr).toBe(1752)
    expect(result.tdee).toBe(2716)
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
