// Splitting a day's macro target across meals, and timing them around training.
//
// ── What the evidence actually supports (decision D2) ─────────────────────────────────────────
// Meal FREQUENCY has little independent effect on weight change or body composition once daily
// calories and protein are held constant. Any UI built on this must say so; suggesting a count
// without that caveat implies a benefit the evidence does not carry.
//
// What does have support is per-meal protein DISTRIBUTION — roughly 0.4 g/kg bodyweight per meal
// across 3-5 meals is the usual recommendation for maximising the muscle-protein-synthesis
// response across a day. That is what `suggestMealCount` derives from, and it is the honest
// reason to prefer 3-4 meals over 1 or 6.
//
// ── Timing (decision D3) ──────────────────────────────────────────────────────────────────────
// Carbohydrate is biased toward the meals immediately before and after training; protein stays
// even (per above); fat takes the remainder and is skewed AWAY from the pre-workout meal. The
// shift is a redistribution only — daily totals are set by the calorie-balance service and are
// never changed here.

export interface MacroTargets {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealSlot {
  position: number
  /** Minutes past local midnight. */
  timeMinutes: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  /** Set when this slot was boosted or reduced by the training-time shift. */
  timingRole: 'pre_workout' | 'post_workout' | null
}

/** Per-meal protein ceiling used to derive a suggested meal count, g per kg bodyweight. */
export const PROTEIN_G_PER_KG_PER_MEAL = 0.4

/** Suggested counts are clamped here; the user may still pick anything in MEAL_COUNT_RANGE. */
export const SUGGESTED_MEAL_COUNT_MIN = 3
export const SUGGESTED_MEAL_COUNT_MAX = 5
export const MEAL_COUNT_MIN = 1
export const MEAL_COUNT_MAX = 6

/** Fraction of a non-peri meal's carbs moved to the pre/post-training meals. */
export const CARB_SHIFT_FRACTION = 0.25
/** Fraction of the pre-workout meal's fat moved to the other meals (fat slows gastric emptying). */
export const PRE_WORKOUT_FAT_SHIFT_FRACTION = 0.4

/** Default eating window when the user has not given meal times, in minutes past midnight. */
export const DEFAULT_FIRST_MEAL_MIN = 7 * 60
export const DEFAULT_LAST_MEAL_MIN = 21 * 60

/**
 * Meals per day implied by spreading the protein target at ~0.4 g/kg per meal, clamped to 3-5.
 *
 * Returns null when bodyweight or protein is unknown — the caller then shows no suggestion rather
 * than a number derived from a guess.
 */
export function suggestMealCount(proteinTargetG: number, bodyweightKg: number): number | null {
  if (!(proteinTargetG > 0) || !(bodyweightKg > 0)) return null
  const perMeal = PROTEIN_G_PER_KG_PER_MEAL * bodyweightKg
  const raw = Math.round(proteinTargetG / perMeal)
  return Math.max(SUGGESTED_MEAL_COUNT_MIN, Math.min(SUGGESTED_MEAL_COUNT_MAX, raw))
}

/** Evenly spaced meal times across the default eating window. */
export function defaultMealTimes(mealCount: number): number[] {
  if (mealCount <= 0) return []
  if (mealCount === 1) return [Math.round((DEFAULT_FIRST_MEAL_MIN + DEFAULT_LAST_MEAL_MIN) / 2)]
  const span = DEFAULT_LAST_MEAL_MIN - DEFAULT_FIRST_MEAL_MIN
  return Array.from({ length: mealCount }, (_, i) =>
    Math.round(DEFAULT_FIRST_MEAL_MIN + (span * i) / (mealCount - 1)))
}

/** 'HH:MM' → minutes past midnight, or null when malformed. */
export function parseTimeToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Distribute a rounded quantity across `n` slots by weight, guaranteeing the parts sum EXACTLY to
 * `total`. Rounding each share independently drifts by up to n/2 units, which would show up as a
 * plan whose meals do not add up to its own target — the first thing a user would notice.
 */
function distribute(total: number, weights: number[], decimals: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (sum <= 0) return weights.map(() => 0)
  const f = Math.pow(10, decimals)
  const exact = weights.map(w => (total * w) / sum)
  const rounded = exact.map(v => Math.round(v * f) / f)
  // Push the whole residual onto the largest slot, where it is proportionally least visible.
  const residual = Math.round((total - rounded.reduce((s, v) => s + v, 0)) * f) / f
  if (residual !== 0) {
    let idx = 0
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[idx]) idx = i
    rounded[idx] = Math.round((rounded[idx] + residual) * f) / f
  }
  return rounded
}

export interface SplitOptions {
  /** 'HH:MM' local, or null when the user has no usual training time. */
  trainingTime?: string | null
  /** Minutes past midnight per meal; defaults to an even spread across the eating window. */
  mealTimes?: number[]
}

/**
 * Split a day's macro target across `mealCount` meals.
 *
 * Protein is even across meals. Carbohydrate is shifted toward the meals bracketing the training
 * time, and fat away from the pre-workout meal. **Daily totals are preserved exactly** — this
 * function only ever redistributes.
 */
export function splitMacrosAcrossMeals(
  targets: MacroTargets,
  mealCount: number,
  options: SplitOptions = {},
): MealSlot[] {
  const n = Math.max(MEAL_COUNT_MIN, Math.min(MEAL_COUNT_MAX, Math.round(mealCount)))
  const times = options.mealTimes?.length === n
    ? [...options.mealTimes].sort((a, b) => a - b)
    : defaultMealTimes(n)

  const trainingMin = parseTimeToMinutes(options.trainingTime ?? null)
  const roles: (MealSlot['timingRole'])[] = Array.from({ length: n }, () => null)

  if (trainingMin != null && n > 1) {
    // Pre = the last meal at or before training; post = the first meal strictly after it.
    let pre = -1
    for (let i = 0; i < n; i++) if (times[i] <= trainingMin) pre = i
    const post = times.findIndex(t => t > trainingMin)
    if (pre >= 0) roles[pre] = 'pre_workout'
    if (post >= 0) roles[post] = 'post_workout'
    // Training before the first meal or after the last: only one side exists, which is correct —
    // there is genuinely no meal on the other side to load.
  }

  const periCount = roles.filter(r => r !== null).length

  // Protein: flat weights, so an even split (D2).
  const proteinWeights = Array.from({ length: n }, () => 1)

  // Carbs: peri-workout meals take a larger share. With no training time (or no peri meal) the
  // weights stay flat and this reduces to an even split.
  const carbWeights = roles.map(r => {
    if (periCount === 0) return 1
    return r === null ? 1 - CARB_SHIFT_FRACTION : 1 + (CARB_SHIFT_FRACTION * (n - periCount)) / periCount
  })

  // Fat: reduced in the pre-workout meal, the surplus spread over the others.
  const preIdx = roles.indexOf('pre_workout')
  const fatWeights = Array.from({ length: n }, (_, i) => {
    if (preIdx < 0 || n === 1) return 1
    return i === preIdx
      ? 1 - PRE_WORKOUT_FAT_SHIFT_FRACTION
      : 1 + PRE_WORKOUT_FAT_SHIFT_FRACTION / (n - 1)
  })

  const protein = distribute(targets.proteinG, proteinWeights, 1)
  const carbs = distribute(targets.carbsG, carbWeights, 1)
  const fat = distribute(targets.fatG, fatWeights, 1)
  // Calories are distributed against the same shape the macros produced, so a meal's calorie share
  // tracks its actual food rather than being a flat 1/n that contradicts its macros.
  const energyWeights = protein.map((p, i) => Math.max(0.0001, p * 4 + carbs[i] * 4 + fat[i] * 9))
  const calories = distribute(targets.calories, energyWeights, 0)

  return Array.from({ length: n }, (_, i) => ({
    position: i,
    timeMinutes: times[i],
    calories: calories[i],
    proteinG: protein[i],
    carbsG: carbs[i],
    fatG: fat[i],
    timingRole: roles[i],
  }))
}

/** Minutes past midnight → 'HH:MM'. */
export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ── Portion scaling ───────────────────────────────────────────────────────────
//
// The model picks foods and states reference values per 100 g; it is explicitly told not to make
// them add up. Something still has to decide the portions, and that is this.
//
// Two problems, one mechanism. First, a split plan generates ONE ingredient list per meal but gives
// it two targets — more carbs on a training day, fewer on a rest day — so a single fixed portion
// leaves at least one variant permanently short. Second, an unscaled suggestion misses its own
// target badly enough to matter: a measured run came back with meals 200 kcal out in both
// directions.
//
// Each ingredient is assigned to the macro that supplies most of its energy, and each group is
// scaled so that macro lands on target. That models what a person actually does — more rice on a
// training day, a bigger piece of salmon for a bigger protein target — rather than inventing
// different food per variant.

export interface ScalableIngredient {
  name: string
  weightG: number
  caloriesPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
}

export type MacroKey = 'protein' | 'carbs' | 'fat'

/** Portions stay inside this band of what was suggested, cumulatively across every pass. */
export const PORTION_SCALE_MIN = 0.4
export const PORTION_SCALE_MAX = 2.5
/** Passes of the per-macro correction. Each group's fix perturbs the others; this settles it. */
const SCALE_PASSES = 4

const PER_100G: Record<MacroKey, keyof ScalableIngredient> = {
  protein: 'proteinPer100g',
  carbs: 'carbsPer100g',
  fat: 'fatPer100g',
}

/**
 * Protein share of energy above which an ingredient counts as the meal's protein source.
 *
 * Plain energy-dominance gets this wrong for exactly the foods a plan leans on: salmon is 41%
 * protein by energy but 59% fat, so a "biggest share wins" rule files it under fat, leaves the
 * protein group empty, and sizes the fish by the fat target. A measured run did precisely that —
 * 32 g of protein against a 50 g target. Eggs, beef mince and Greek yoghurt fail the same way.
 */
export const PROTEIN_SHARE_THRESHOLD = 0.3

/**
 * Which macro an ingredient is really for.
 *
 * Returns null for anything with no energy (herbs, water, zero-calorie sauces), which is then never
 * rescaled: doubling the parsley does nothing for the target and reads as nonsense.
 */
export function dominantMacro(ing: ScalableIngredient): MacroKey | null {
  const p = Math.max(0, ing.proteinPer100g) * 4
  const c = Math.max(0, ing.carbsPer100g) * 4
  const f = Math.max(0, ing.fatPer100g) * 9
  const total = p + c + f
  if (total <= 0) return null
  if (p / total >= PROTEIN_SHARE_THRESHOLD) return 'protein'
  return c >= f ? 'carbs' : 'fat'
}

function macroGrams(ings: ScalableIngredient[], factors: number[], macro: MacroKey, only?: Set<number>): number {
  const key = PER_100G[macro]
  return ings.reduce((sum, ing, i) => {
    if (only && !only.has(i)) return sum
    return sum + (Math.max(0, ing[key] as number) * ing.weightG * factors[i]) / 100
  }, 0)
}

export interface PortionTargets {
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * Rescale a meal's ingredients so its macros land on `targets`.
 *
 * Weights are clamped to `PORTION_SCALE_MIN`–`PORTION_SCALE_MAX` of what was suggested, so a large
 * gap produces a sensible portion rather than "700 g of rice" — a plan nobody would follow is worse
 * than one that admits a shortfall, and the shortfall is displayed rather than hidden.
 *
 * Returns the list unchanged when there is nothing to work with.
 */
export function scaleIngredientsToTargets(
  ingredients: ScalableIngredient[],
  targets: PortionTargets,
): ScalableIngredient[] {
  if (ingredients.length === 0) return ingredients

  const groups = ingredients.map(dominantMacro)
  const factors = ingredients.map(() => 1)
  const order: MacroKey[] = ['protein', 'carbs', 'fat']

  for (let pass = 0; pass < SCALE_PASSES; pass++) {
    for (const macro of order) {
      const target = macro === 'protein' ? targets.proteinG
        : macro === 'carbs' ? targets.carbsG : targets.fatG
      if (!(target > 0)) continue

      const members = new Set(groups.flatMap((g, i) => g === macro ? [i] : []))
      if (members.size === 0) continue

      const fromGroup = macroGrams(ingredients, factors, macro, members)
      // This macro also rides along in other groups' foods (the carbs in yoghurt), and those are
      // not this group's to move — only the remainder is.
      const fixed = macroGrams(ingredients, factors, macro) - fromGroup
      const needed = target - fixed
      if (!(fromGroup > 0)) continue

      if (needed <= 0) {
        // The other groups already overshoot this macro on their own, so there is no room left for
        // this one. Shrink it as far as the clamp allows rather than leaving it untouched — that
        // was leaving 15 g of olive oil in a meal whose salmon had already passed the fat target.
        for (const i of members) factors[i] = PORTION_SCALE_MIN
        continue
      }

      const k = needed / fromGroup
      for (const i of members) {
        factors[i] = Math.max(PORTION_SCALE_MIN, Math.min(PORTION_SCALE_MAX, factors[i] * k))
      }
    }
  }

  return ingredients.map((ing, i) => factors[i] === 1
    ? ing
    : { ...ing, weightG: Math.max(1, Math.round(ing.weightG * factors[i])) })
}
