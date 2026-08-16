// How close a meal's actual food is to the macros it was planned for.
//
// This is the one place that decides "on target". The review step, the plan card and the per-meal
// regenerate all need the same answer, and a threshold copy-pasted into each of them is how the
// same meal ends up flagged on one screen and clean on another.
//
// The tolerance is proportional with an absolute floor: 10% of a 90 g carb target is 9 g, which is
// a fair miss, but 10% of a 4 g fat target is 0.4 g, which nothing real would ever hit. The floor
// stops small targets from being permanently red for no useful reason.

export type MacroFitStatus = 'on' | 'under' | 'over'

export const MEAL_FIT_TOLERANCE_FRACTION = 0.1
/** Absolute floors, below which a proportional tolerance is too tight to be meaningful. */
export const MEAL_FIT_FLOOR_KCAL = 50
export const MEAL_FIT_FLOOR_GRAMS = 5

export interface MacroFit {
  actual: number
  target: number
  delta: number
  /** 0-1+, actual as a fraction of target. Infinity is avoided — a zero target reports 0. */
  ratio: number
  status: MacroFitStatus
}

export function macroFit(actual: number, target: number, floor: number): MacroFit {
  const delta = actual - target
  const tolerance = Math.max(floor, Math.abs(target) * MEAL_FIT_TOLERANCE_FRACTION)
  const status: MacroFitStatus = Math.abs(delta) <= tolerance
    ? 'on'
    : delta > 0 ? 'over' : 'under'
  return {
    actual,
    target,
    delta,
    ratio: target > 0 ? actual / target : 0,
    status,
  }
}

export interface MacroTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealFit {
  calories: MacroFit
  protein: MacroFit
  carbs: MacroFit
  fat: MacroFit
  /** True when every macro is within tolerance — what a "this meal is fine" affordance keys off. */
  allOnTarget: boolean
}

export function mealFit(actual: MacroTotals, target: MacroTotals): MealFit {
  const calories = macroFit(actual.calories, target.calories, MEAL_FIT_FLOOR_KCAL)
  const protein = macroFit(actual.proteinG, target.proteinG, MEAL_FIT_FLOOR_GRAMS)
  const carbs = macroFit(actual.carbsG, target.carbsG, MEAL_FIT_FLOOR_GRAMS)
  const fat = macroFit(actual.fatG, target.fatG, MEAL_FIT_FLOOR_GRAMS)
  return {
    calories, protein, carbs, fat,
    allOnTarget: [calories, protein, carbs, fat].every(f => f.status === 'on'),
  }
}

/**
 * How far a meal sits from its target, as one comparable number. Lower is better; 0 is exact.
 *
 * Exists so two candidate versions of the same meal can be compared without a second opinion about
 * what "better" means. The three macros are weighted equally and calories are deliberately left
 * out — calories are a function of the macros, so counting them again would double-weight whichever
 * macro is furthest off.
 *
 * Relative rather than absolute: 10 g short on a 20 g fat target is a worse miss than 10 g short on
 * a 200 g carb target, and an absolute sum would call them equal.
 */
/**
 * How much better a topped-up meal has to fit before the extra food is worth it.
 *
 * Not "any improvement": measured, adding 40 g of celery to a protein ice cream improves the fit by
 * 0.4%, and a bare better-or-not comparison would keep it. Fewer ingredients is a better meal, so
 * a token addition has to lose.
 */
export const TOP_UP_MIN_IMPROVEMENT = 0.1

export function fitDistance(actual: MacroTotals, target: MacroTotals): number {
  const rel = (a: number, t: number) => t > 0 ? Math.abs(a - t) / t : (a > 0 ? 1 : 0)
  return rel(actual.proteinG, target.proteinG)
    + rel(actual.carbsG, target.carbsG)
    + rel(actual.fatG, target.fatG)
}

/** Sum a set of per-meal totals — the running day total the user is really judging a swap against. */
export function sumMacroTotals(totals: (MacroTotals | null | undefined)[]): MacroTotals {
  return totals.reduce<MacroTotals>((acc, t) => t ? {
    calories: acc.calories + t.calories,
    proteinG: acc.proteinG + t.proteinG,
    carbsG: acc.carbsG + t.carbsG,
    fatG: acc.fatG + t.fatG,
  } : acc, { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
}
