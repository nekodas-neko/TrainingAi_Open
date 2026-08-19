import { ACTIVITY_LEVELS, type ActivityLevel, type FitnessGoal } from '../types/user'
import { cunninghamBmr } from '../health/body-composition'
import { SEDENTARY_MULTIPLIER } from '../health/daily-energy'

// Q-401: `ACTIVITY_MULTIPLIERS` used to live here — sedentary 1.2 through extra_active 1.9 — and
// `calculateBaseline` folded the user's *self-reported* level into the calorie target. That made
// this a second TDEE model, and the app ran both:
//
//   goal wizard      BMR × 1.375 (light)      − 200  =  1,892  ≈ the stored 1,900
//   energy balance   BMR × 1.2  (sedentary)   − 200  =  1,626
//
// Gap = BMR × (1.375 − 1.2) = 266 kcal; observed on device: 274, the rest being rounding and weight
// drift. Two budgets on one screen, both labelled "left", with nothing reconciling them.
//
// Neither was wrong — they were different contracts. This one *assumed* your activity and never
// moved; `daily-energy.ts` *measures* it and deliberately starts from sedentary, its comment saying
// exactly why: "measured movement is added explicitly, so a higher activity multiplier here would
// double-count it."
//
// Owner decision (2026-08-18): *"i want the lowest number that assumes no exercise/movement — and
// only has BMR essentially. then we adjust/increase that number [by] activity."* So the baseline is
// BMR × sedentary **everywhere**, and activity is only ever ADDED — one place turns a BMR into a
// daily target, one place adds today's movement. The activity level is still asked for and still
// used, but only where it is not double-counted: step goals and water.

export const STEP_GOAL_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 7000, light: 8500, moderate: 10000, active: 12000, extra_active: 12000,
}

const WATER_BUMP_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 0, light: 0, moderate: 250, active: 400, extra_active: 600,
}

/** Intentional daily calorie offset per goal. Exported so the calorie-balance bands measure
 *  against the same deficit the calorie target was built from (One Formula, One Place). */
export const CALORIE_ADJUSTMENT_BY_GOAL: Record<FitnessGoal, number> = {
  lose_weight: -500, maintain: 0, build_muscle: 300, recomp: -200,
}

const PROTEIN_G_PER_KG_BY_GOAL: Record<FitnessGoal, number> = {
  lose_weight: 1.8, maintain: 1.6, build_muscle: 2.0, recomp: 2.2,
}

export const SEX_OFFSET: Record<string, number> = { male: 5, female: -161, other: -78 }

/**
 * Carbohydrate as whatever the calorie budget has left after protein and fat (One Formula, One
 * Place — this expression was written out three times).
 *
 * Protein and fat are the two that get chosen deliberately; carbs are the remainder by convention
 * throughout this app.
 */
export function carbsFromRemainder(calories: number, proteinG: number, fatG: number): number {
  return Math.round(Math.max(0, calories - proteinG * 4 - fatG * 9) / 4)
}

/**
 * How far a macro set may sit from its calorie goal before the editor points it out.
 *
 * A goal is a set of numbers someone typed, not a measurement, so this is deliberately tight —
 * tighter than the food-row mismatch threshold, which tolerates real-world label rounding. 25 kcal
 * is under a rounding error on a daily total and well under anything worth acting on.
 */
export const MACRO_GOAL_TOLERANCE_KCAL = 25

/**
 * The slack `reconcileDailyMacros` allows before it calls a macro set adjusted.
 *
 * At least 2 kcal, because `carbsFromRemainder` rounds to a **whole gram** and a gram of
 * carbohydrate is 4 kcal — so its own output can land up to 2 kcal from the goal. A tighter
 * tolerance made the reconciler flag its own answer: take the editor's one-tap fix on a
 * 1,750 kcal goal and it produces 153 g of carbs (1,752 kcal implied), which a ±1 kcal check
 * reports as still needing adjustment, and the meal-plan review step then tells the user their
 * saved macros do not add up immediately after they made them add up.
 */
export const MACRO_RECONCILE_TOLERANCE_KCAL = 2

/** What a macro set actually comes to, by Atwater. */
export function caloriesFromMacros(macros: DailyMacros): number {
  return macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9
}

export interface DailyMacros {
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * Make a saved macro set add up to a calorie target.
 *
 * Nothing stops the targets screen from holding macros that do not sum to its own calorie goal —
 * 150P/180C/60F is 1,860 kcal beside a 1,750 kcal goal, which is what the seeded account actually
 * holds. Anything that plans meals against both numbers is then unsatisfiable by construction, and
 * would show a permanent "over by 110 kcal" that is nothing to do with the food.
 *
 * Calories win, because that is the number the weight-change calibration produces. Protein and fat
 * are kept as chosen and carbs take the remainder — the same precedence `calculateBaseline` uses.
 * If protein and fat alone overrun the budget, everything scales down together instead.
 *
 * Reports `adjusted` so a caller can say so rather than silently disagreeing with the targets
 * screen. Never writes anything: the user's saved targets are theirs.
 */
export function reconcileDailyMacros(
  calories: number,
  macros: DailyMacros,
): DailyMacros & { adjusted: boolean } {
  const asGiven = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9
  if (!(calories > 0) || Math.abs(asGiven - calories) <= MACRO_RECONCILE_TOLERANCE_KCAL) {
    return { ...macros, adjusted: false }
  }

  const fromProteinAndFat = macros.proteinG * 4 + macros.fatG * 9
  if (fromProteinAndFat > calories) {
    const k = calories / fromProteinAndFat
    return {
      proteinG: Math.round(macros.proteinG * k),
      fatG: Math.round(macros.fatG * k),
      carbsG: 0,
      adjusted: true,
    }
  }
  return {
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    carbsG: carbsFromRemainder(calories, macros.proteinG, macros.fatG),
    adjusted: true,
  }
}

/** Mifflin-St Jeor BMR (kcal/day), unrounded. The single copy of this formula — the health-page
 *  energy-balance widget imports it instead of re-hardcoding the sex offsets (One Formula, One
 *  Place). Sex offset: male +5, female −161, other/unknown −78. Callers round as needed. */
export function mifflinStJeorBmr(weightKg: number, heightCm: number, ageYears: number, sex: string): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + (SEX_OFFSET[sex] ?? SEX_OFFSET.other)
}

export interface BaselineInput {
  weightKg: number
  heightCm: number
  ageYears: number
  sex: string
  activityLevel: ActivityLevel
  fitnessGoal: FitnessGoal
  bodyFatPct?: number  // when present, uses Katch-McArdle BMR + lean-mass protein dosing
}

export interface BaselineResult {
  bmr: number
  tdee: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  waterMl: number
  stepsGoal: number
  leanMassKg?: number  // set when bodyFatPct was provided
}

export function calculateBaseline(input: BaselineInput): BaselineResult {
  const leanMassKg = input.bodyFatPct != null
    ? Math.round(input.weightKg * (1 - input.bodyFatPct / 100) * 10) / 10
    : undefined

  // Katch-McArdle (Cunningham) when lean mass is known; Mifflin-St Jeor otherwise
  const bmr = leanMassKg != null
    ? Math.round(cunninghamBmr(leanMassKg))
    : Math.round(mifflinStJeorBmr(input.weightKg, input.heightCm, input.ageYears, input.sex))

  // The rest-day floor, not "what you burn on an average day". Today's measured movement is added
  // on top of this by `computeCalorieBalance`; folding an activity multiplier in here as well is
  // the double-count that produced Q-401.
  const tdee = Math.round(bmr * SEDENTARY_MULTIPLIER)
  const calories = tdee + CALORIE_ADJUSTMENT_BY_GOAL[input.fitnessGoal]

  // Protein dosed per kg of lean mass when available; total weight otherwise
  const proteinBase = leanMassKg ?? input.weightKg
  const proteinG = Math.round(proteinBase * PROTEIN_G_PER_KG_BY_GOAL[input.fitnessGoal])

  const fatG = Math.round(calories * 0.25 / 9)
  const carbsG = carbsFromRemainder(calories, proteinG, fatG)
  const waterMl = Math.round(input.weightKg * 33) + WATER_BUMP_BY_ACTIVITY[input.activityLevel]
  const stepsGoal = STEP_GOAL_BY_ACTIVITY[input.activityLevel]
  return { bmr, tdee, calories, proteinG, carbsG, fatG, waterMl, stepsGoal, leanMassKg }
}

export interface RawRecommendation {
  recommendedStepsGoal: number
  recommendedCalories: number
  recommendedProteinG: number
  recommendedCarbsG: number
  recommendedFatG: number
  recommendedWaterMl: number
  recommendedActivityLevel: string | null
  dataQualityNote: string
}

export interface ClampedRecommendation {
  recommendedStepsGoal: number
  recommendedCalories: number
  recommendedProteinG: number
  recommendedCarbsG: number
  recommendedFatG: number
  recommendedWaterMl: number
  recommendedActivityLevel: ActivityLevel | null
  dataQualityNote: string
}

export function clampRecommendation(
  ai: RawRecommendation,
  baseline: BaselineResult,
  weightKg: number,
): ClampedRecommendation {
  const notes: string[] = []

  const calorieMin = Math.max(1200, baseline.bmr)
  const calorieMax = Math.round(baseline.calories * 1.2)
  let calories = ai.recommendedCalories
  if (calories < calorieMin) {
    calories = calorieMin
    notes.push(`Calories adjusted to safe minimum (${calorieMin}).`)
  } else if (calories > calorieMax) {
    calories = calorieMax
    notes.push(`Calories adjusted to safe maximum (${calorieMax}).`)
  }

  const proteinMin = Math.round(1.0 * weightKg)
  const proteinMax = Math.round(2.5 * weightKg)
  let proteinG = ai.recommendedProteinG
  if (proteinG < proteinMin) {
    proteinG = proteinMin
    notes.push(`Protein adjusted to minimum (${proteinMin}g).`)
  } else if (proteinG > proteinMax) {
    proteinG = proteinMax
    notes.push(`Protein adjusted to maximum (${proteinMax}g).`)
  }

  const fatMax = Math.floor(calories * 0.4 / 9)
  // For very heavy + short + older users, the weight-based floor can exceed the
  // calorie-derived ceiling — cap it so fatMin never exceeds fatMax.
  const fatMin = Math.min(Math.round(0.6 * weightKg), fatMax)
  let fatG = ai.recommendedFatG
  if (fatG < fatMin) {
    fatG = fatMin
    notes.push(`Fat adjusted to minimum (${fatMin}g).`)
  } else if (fatG > fatMax) {
    fatG = fatMax
    notes.push(`Fat adjusted to maximum (${fatMax}g).`)
  }

  const carbsG = carbsFromRemainder(calories, proteinG, fatG)

  let waterMl = ai.recommendedWaterMl
  if (waterMl < 1500) {
    waterMl = 1500
    notes.push('Water adjusted to minimum (1500ml).')
  } else if (waterMl > 6000) {
    waterMl = 6000
    notes.push('Water adjusted to maximum (6000ml).')
  }

  let stepsGoal = ai.recommendedStepsGoal
  if (stepsGoal < 3000) {
    stepsGoal = 3000
    notes.push('Steps goal adjusted to minimum (3000).')
  } else if (stepsGoal > 20000) {
    stepsGoal = 20000
    notes.push('Steps goal adjusted to maximum (20000).')
  }

  let activityLevel: ActivityLevel | null = null
  if (ai.recommendedActivityLevel != null) {
    if ((ACTIVITY_LEVELS as readonly string[]).includes(ai.recommendedActivityLevel)) {
      activityLevel = ai.recommendedActivityLevel as ActivityLevel
    } else {
      notes.push('Suggested activity level was invalid and has been ignored.')
    }
  }

  const dataQualityNote = [ai.dataQualityNote, ...notes].filter(n => n.length > 0).join(' ')

  return {
    recommendedStepsGoal: stepsGoal,
    recommendedCalories: calories,
    recommendedProteinG: proteinG,
    recommendedCarbsG: carbsG,
    recommendedFatG: fatG,
    recommendedWaterMl: waterMl,
    recommendedActivityLevel: activityLevel,
    dataQualityNote,
  }
}
