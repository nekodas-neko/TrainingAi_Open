import { describe, it, expect } from 'vitest'
import {
  suggestMealCount, splitMacrosAcrossMeals, defaultMealTimes, parseTimeToMinutes, minutesToTime,
  SUGGESTED_MEAL_COUNT_MIN, SUGGESTED_MEAL_COUNT_MAX, MEAL_COUNT_MAX,
  scaleIngredientsToTargets, dominantMacro, PORTION_SCALE_MIN, PORTION_SCALE_MAX,
  type MacroTargets,
} from '../meal-split'

const TARGETS: MacroTargets = { calories: 1800, proteinG: 150, carbsG: 180, fatG: 60 }

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 10) / 10

describe('suggestMealCount', () => {
  it('derives the count from per-meal protein, not from preference', () => {
    // 150 g protein at 0.4 g/kg x 71 kg = 28.4 g/meal -> ~5 meals.
    expect(suggestMealCount(150, 71)).toBe(5)
    // A lighter protein target over the same bodyweight needs fewer meals.
    expect(suggestMealCount(90, 71)).toBe(3)
  })

  it('clamps to the 3-5 band the evidence actually speaks to', () => {
    expect(suggestMealCount(400, 60)).toBe(SUGGESTED_MEAL_COUNT_MAX)
    expect(suggestMealCount(20, 100)).toBe(SUGGESTED_MEAL_COUNT_MIN)
  })

  it('returns null rather than guessing when an input is missing', () => {
    expect(suggestMealCount(0, 71)).toBeNull()
    expect(suggestMealCount(150, 0)).toBeNull()
  })
})

describe('splitMacrosAcrossMeals — totals are preserved exactly', () => {
  it('reconciles every macro to the daily target with no training time', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const meals = splitMacrosAcrossMeals(TARGETS, n)
      expect(meals).toHaveLength(n)
      expect(sum(meals.map(m => m.proteinG))).toBe(TARGETS.proteinG)
      expect(sum(meals.map(m => m.carbsG))).toBe(TARGETS.carbsG)
      expect(sum(meals.map(m => m.fatG))).toBe(TARGETS.fatG)
      expect(sum(meals.map(m => m.calories))).toBe(TARGETS.calories)
    }
  })

  it('still reconciles when the training shift is applied', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const meals = splitMacrosAcrossMeals(TARGETS, n, { trainingTime: '17:30' })
      expect(sum(meals.map(m => m.proteinG))).toBe(TARGETS.proteinG)
      expect(sum(meals.map(m => m.carbsG))).toBe(TARGETS.carbsG)
      expect(sum(meals.map(m => m.fatG))).toBe(TARGETS.fatG)
      expect(sum(meals.map(m => m.calories))).toBe(TARGETS.calories)
    }
  })

  it('reconciles awkward totals that do not divide evenly', () => {
    const odd: MacroTargets = { calories: 2077, proteinG: 143.3, carbsG: 191.7, fatG: 57.9 }
    const meals = splitMacrosAcrossMeals(odd, 4, { trainingTime: '06:15' })
    expect(sum(meals.map(m => m.proteinG))).toBe(odd.proteinG)
    expect(sum(meals.map(m => m.carbsG))).toBe(odd.carbsG)
    expect(sum(meals.map(m => m.fatG))).toBe(odd.fatG)
    expect(sum(meals.map(m => m.calories))).toBe(odd.calories)
  })

  it('clamps an out-of-range meal count instead of producing a broken plan', () => {
    expect(splitMacrosAcrossMeals(TARGETS, 0)).toHaveLength(1)
    expect(splitMacrosAcrossMeals(TARGETS, 99)).toHaveLength(MEAL_COUNT_MAX)
  })
})

describe('splitMacrosAcrossMeals — distribution shape', () => {
  it('keeps protein even across meals', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 4, { trainingTime: '17:30' })
    const p = meals.map(m => m.proteinG)
    // Only rounding separates them.
    expect(Math.max(...p) - Math.min(...p)).toBeLessThanOrEqual(0.2)
  })

  it('gives an even split when there is no training time', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 4)
    const c = meals.map(m => m.carbsG)
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(0.2)
    expect(meals.every(m => m.timingRole === null)).toBe(true)
  })

  it('loads carbs onto the meals bracketing training', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 4, { trainingTime: '17:30' })
    const peri = meals.filter(m => m.timingRole !== null)
    const rest = meals.filter(m => m.timingRole === null)
    expect(peri.length).toBeGreaterThan(0)
    expect(rest.length).toBeGreaterThan(0)
    const minPeri = Math.min(...peri.map(m => m.carbsG))
    const maxRest = Math.max(...rest.map(m => m.carbsG))
    expect(minPeri).toBeGreaterThan(maxRest)
  })

  it('identifies the meal before and the meal after training', () => {
    // Default 4-meal times are 07:00, 11:40, 16:20, 21:00 — training at 17:30 sits between 3 and 4.
    const meals = splitMacrosAcrossMeals(TARGETS, 4, { trainingTime: '17:30' })
    expect(meals[2].timingRole).toBe('pre_workout')
    expect(meals[3].timingRole).toBe('post_workout')
  })

  it('reduces fat in the pre-workout meal', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 4, { trainingTime: '17:30' })
    const pre = meals.find(m => m.timingRole === 'pre_workout')!
    const others = meals.filter(m => m.timingRole !== 'pre_workout')
    expect(pre.fatG).toBeLessThan(Math.min(...others.map(m => m.fatG)))
  })

  it('handles training before the first meal — only a post-workout meal exists', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 3, { trainingTime: '05:00' })
    expect(meals.filter(m => m.timingRole === 'pre_workout')).toHaveLength(0)
    expect(meals.filter(m => m.timingRole === 'post_workout')).toHaveLength(1)
    expect(sum(meals.map(m => m.carbsG))).toBe(TARGETS.carbsG)
  })

  it('handles training after the last meal — only a pre-workout meal exists', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 3, { trainingTime: '23:30' })
    expect(meals.filter(m => m.timingRole === 'post_workout')).toHaveLength(0)
    expect(meals.filter(m => m.timingRole === 'pre_workout')).toHaveLength(1)
    expect(sum(meals.map(m => m.carbsG))).toBe(TARGETS.carbsG)
  })

  it('ignores a malformed training time rather than throwing', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 3, { trainingTime: 'half five' })
    expect(meals.every(m => m.timingRole === null)).toBe(true)
    expect(sum(meals.map(m => m.carbsG))).toBe(TARGETS.carbsG)
  })

  it('never emits a negative macro', () => {
    const lean: MacroTargets = { calories: 1200, proteinG: 140, carbsG: 60, fatG: 30 }
    for (const t of [null, '06:00', '12:00', '20:00']) {
      for (const n of [1, 2, 3, 4, 5, 6]) {
        for (const m of splitMacrosAcrossMeals(lean, n, { trainingTime: t })) {
          expect(m.proteinG).toBeGreaterThanOrEqual(0)
          expect(m.carbsG).toBeGreaterThanOrEqual(0)
          expect(m.fatG).toBeGreaterThanOrEqual(0)
          expect(m.calories).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('respects caller-supplied meal times', () => {
    const meals = splitMacrosAcrossMeals(TARGETS, 3, {
      trainingTime: '13:00', mealTimes: [8 * 60, 12 * 60, 19 * 60],
    })
    expect(meals.map(m => m.timeMinutes)).toEqual([480, 720, 1140])
    expect(meals[1].timingRole).toBe('pre_workout')
    expect(meals[2].timingRole).toBe('post_workout')
  })
})

describe('time helpers', () => {
  it('spreads default meal times across the eating window', () => {
    expect(defaultMealTimes(3)).toEqual([420, 840, 1260])
    expect(defaultMealTimes(1)).toEqual([840])
    expect(defaultMealTimes(0)).toEqual([])
  })

  it('parses and rejects times', () => {
    expect(parseTimeToMinutes('17:30')).toBe(1050)
    expect(parseTimeToMinutes('7:05')).toBe(425)
    expect(parseTimeToMinutes('25:00')).toBeNull()
    expect(parseTimeToMinutes('17:99')).toBeNull()
    expect(parseTimeToMinutes('')).toBeNull()
    expect(parseTimeToMinutes(null)).toBeNull()
  })

  it('round-trips minutes to HH:MM', () => {
    for (const m of [0, 425, 840, 1050, 1439]) {
      expect(parseTimeToMinutes(minutesToTime(m))).toBe(m)
    }
  })
})

describe('scaleIngredientsToTargets', () => {
  const oats    = { name: 'Rolled oats', weightG: 50, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 7 }
  const whey    = { name: 'Whey isolate', weightG: 30, caloriesPer100g: 370, proteinPer100g: 85, carbsPer100g: 5, fatPer100g: 2 }
  const oil     = { name: 'Olive oil', weightG: 10, caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 }
  const parsley = { name: 'Parsley', weightG: 5, caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 }

  const macros = (xs: typeof oats[]) => ({
    proteinG: xs.reduce((s, i) => s + (i.proteinPer100g * i.weightG) / 100, 0),
    carbsG: xs.reduce((s, i) => s + (i.carbsPer100g * i.weightG) / 100, 0),
    fatG: xs.reduce((s, i) => s + (i.fatPer100g * i.weightG) / 100, 0),
  })
  const weightOf = (xs: typeof oats[], name: string) => xs.find(i => i.name === name)!.weightG

  it('assigns each ingredient to the macro it is really for', () => {
    expect(dominantMacro(oats)).toBe('carbs')
    expect(dominantMacro(whey)).toBe('protein')
    expect(dominantMacro(oil)).toBe('fat')
    expect(dominantMacro(parsley)).toBeNull()
  })

  it('files a fatty protein as protein, not fat', () => {
    // Salmon is 59% fat by energy. A biggest-share rule calls it fat, empties the protein group and
    // then sizes the fish by the fat target — 32 g of protein against a 50 g target, measured.
    expect(dominantMacro({ name: 'Salmon', weightG: 150, caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 })).toBe('protein')
    expect(dominantMacro({ name: 'Egg', weightG: 100, caloriesPer100g: 143, proteinPer100g: 13, carbsPer100g: 1, fatPer100g: 11 })).toBe('protein')
    // Nuts and avocado stay fat — protein is a token share of their energy.
    expect(dominantMacro({ name: 'Almonds', weightG: 30, caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50 })).toBe('fat')
    expect(dominantMacro({ name: 'Avocado', weightG: 80, caloriesPer100g: 160, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15 })).toBe('fat')
  })

  it('sizes a fatty protein by the protein target', () => {
    const salmon = { name: 'Salmon', weightG: 100, caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 }
    const potato = { name: 'Potato', weightG: 200, caloriesPer100g: 77, proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0.1 }
    const scaled = scaleIngredientsToTargets([salmon, potato], { proteinG: 45, carbsG: 60, fatG: 22 })
    expect(macros(scaled).proteinG).toBeCloseTo(45, 0)
    expect(macros(scaled).carbsG).toBeCloseTo(60, 0)
  })

  it('lands every macro on target', () => {
    const scaled = scaleIngredientsToTargets([oats, whey, oil], { proteinG: 40, carbsG: 60, fatG: 20 })
    const m = macros(scaled)
    expect(m.proteinG).toBeCloseTo(40, 0)
    expect(m.carbsG).toBeCloseTo(60, 0)
    expect(m.fatG).toBeCloseTo(20, 0)
  })

  it('gives a training day bigger carb portions than a rest day, same meal', () => {
    const training = scaleIngredientsToTargets([oats, whey, oil], { proteinG: 38, carbsG: 90, fatG: 15 })
    const rest = scaleIngredientsToTargets([oats, whey, oil], { proteinG: 38, carbsG: 44, fatG: 15 })
    expect(weightOf(training, 'Rolled oats')).toBeGreaterThan(weightOf(rest, 'Rolled oats'))
    // Protein is held even between variants by design. The whey WEIGHT differs — the bigger oat
    // portion brings more protein with it, so the whey gives some back — but the protein TOTAL is
    // what the design holds, and that is what must match.
    expect(macros(training).proteinG).toBeCloseTo(macros(rest).proteinG, 0)
  })

  it('accounts for a macro riding along in another group\'s food', () => {
    // The oats already supply 6.5 g of protein, so the whey must cover the remainder, not all 40 g.
    const scaled = scaleIngredientsToTargets([oats, whey], { proteinG: 32, carbsG: 30, fatG: 5 })
    expect(macros(scaled).proteinG).toBeCloseTo(32, 0)
  })

  it('never rescales a zero-energy ingredient', () => {
    const scaled = scaleIngredientsToTargets([oats, parsley], { proteinG: 20, carbsG: 90, fatG: 10 })
    expect(weightOf(scaled, 'Parsley')).toBe(parsley.weightG)
  })

  it('shrinks a group whose macro is already overshot by the others', () => {
    // A 50 g protein target forces 250 g of salmon, which brings 32 g of fat with it — past a 24 g
    // fat target before the oil is counted. Leaving the oil at its suggested weight made the meal
    // 43 g of fat; the oil has to come down as far as the clamp allows.
    const salmon = { name: 'Salmon', weightG: 200, caloriesPer100g: 208, proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 }
    const oil = { name: 'Olive oil', weightG: 15, caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 }
    const scaled = scaleIngredientsToTargets([salmon, oil], { proteinG: 50, carbsG: 0, fatG: 24 })
    expect(weightOf(scaled, 'Olive oil')).toBe(Math.round(15 * PORTION_SCALE_MIN))
    expect(macros(scaled).fatG).toBeLessThan(
      (salmon.fatPer100g * 250) / 100 + (oil.fatPer100g * oil.weightG) / 100)
  })

  it('clamps rather than prescribing an absurd portion', () => {
    // 700 g of carbs out of 50 g of oats would be a plan nobody follows.
    const scaled = scaleIngredientsToTargets([oats], { proteinG: 0, carbsG: 700, fatG: 0 })
    expect(scaled[0].weightG).toBeLessThanOrEqual(Math.round(oats.weightG * PORTION_SCALE_MAX))
    expect(scaled[0].weightG).toBeGreaterThanOrEqual(Math.round(oats.weightG * PORTION_SCALE_MIN))
  })

  it('keeps every portion inside the clamp band however the targets are set', () => {
    for (const t of [
      { proteinG: 5, carbsG: 5, fatG: 2 },
      { proteinG: 200, carbsG: 400, fatG: 120 },
      { proteinG: 0, carbsG: 0, fatG: 0 },
    ]) {
      for (const ing of scaleIngredientsToTargets([oats, whey, oil], t)) {
        const original = [oats, whey, oil].find(o => o.name === ing.name)!
        expect(ing.weightG).toBeGreaterThanOrEqual(Math.round(original.weightG * PORTION_SCALE_MIN))
        expect(ing.weightG).toBeLessThanOrEqual(Math.round(original.weightG * PORTION_SCALE_MAX))
      }
    }
  })

  it('returns the list unchanged when there is nothing to work with', () => {
    expect(scaleIngredientsToTargets([], { proteinG: 40, carbsG: 60, fatG: 20 })).toEqual([])
    expect(scaleIngredientsToTargets([oats], { proteinG: 0, carbsG: 0, fatG: 0 })).toEqual([oats])
  })
})
