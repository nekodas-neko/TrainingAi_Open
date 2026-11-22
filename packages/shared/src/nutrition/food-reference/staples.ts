// #3749 part 4. Closing a meal's protein, carb or fat gap by arithmetic, before any model call.
//
// The top-up (`lib/nutrition/meal-top-up.ts`) asked the model for extra food whenever resizing a
// meal could not reach its target. With a few staples whose numbers come from the bundled USDA
// table, most such gaps are a division: grams short ÷ grams of that macro per gram of the staple.
// The model is asked only when no staple can close the gap.
//
// The model's real advantage was knowing what belongs with the meal: rice in a protein ice cream is
// worse than the gap. Two guards keep that:
//  - **A staple must match the meal's style.** Every staple is either sweet or savoury, and a meal
//    gets one only when the ingredients that resolve against the table are all one style. A meal
//    with no recognised ingredient, or a mix, goes to the model as before.
//  - **A staple is never offered against a recorded restriction.** Each lists the words that rule
//    it out (`excludedBy`), and an allergy, avoid or excluded food that contains one of them, or is
//    contained in one, or names the staple, removes it. Deliberately broad: "dairy-free" removes
//    every dairy staple, and a staple wrongly withheld costs only a model call.
//
// PURE: no I/O.

import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { text } from '../food-item-identity'
import { scaleIngredientsToTargets, dominantMacro } from '../meal-split'
import { mealFit, fitDistance, TOP_UP_MIN_IMPROVEMENT } from '../meal-macro-fit'
import { sumIngredients } from '../scan-totals'
import { FDC_SR_LEGACY_ROWS } from './fdc-sr-legacy'
import { referenceRowFor } from './resolve'
import type { FoodReferenceRow } from './types'

export type MealStyle = 'sweet' | 'savoury'
type Macro = 'protein' | 'carbs' | 'fat'

// Which table rows say a meal is sweet or savoury. Foods that sit in both (avocado, bread, nuts,
// butter, cream) are in neither, so they never decide it.
const SWEET_IDS = new Set([
  171688, 169118, 169097, 167762, 171711, 167755, 173946, 174683, 169910, 169124, 168153, 167765,
  169092, 169928, 169105, 171719, 169949, 171697, 173021, 174673, 173944, 168191, // fruit
  173904, 173905, 171646, // oats, porridge, granola
  170894, 170903, 171304, 171284, 170886, 170888, // yoghurt
  171265, 171267, 170872, 171269, 170880, 174832, 175215, // milk
  169640, 169661, 169655, 169641, 170273, 167575, 170554, 172470, // sweeteners, chocolate, ice cream, chia, peanut butter
])
const SAVOURY_IDS = new Set([
  170379, 169967, 168462, 168463, 170393, 170394, 170457, 170051, 168409, 169247, 169248, 169387,
  170000, 170001, 169230, 170108, 170427, 169251, 169252, 169291, 169986, 169975, 168421, 170017,
  169998, 168482, 168483, 170026, 170438, 170093, 169961, 168389, 169988, 169145, 168448, 169228,
  170383, // vegetables
  171077, 171477, 172388, 171790, 174030, 171796, 174763, 173118, 174370, 172544, 168249, 168250,
  171505, 171506, 168277, 175167, 175168, 173690, 173709, 175159, 171955, 171956, 175176, 175177,
  175179, 175180, // meat and fish
  171287, 173424, 172186, 172187, 173423, // eggs
  168877, 169753, 169703, 169704, 168874, 168917, 169736, 169737, 169731, 168919, 168914, 169699,
  169700, 170287, // rice, grains, pasta, noodles
  173414, 171292, 170845, 170847, 171247, 173420, // cheese
  173735, 173801, 172421, 175194, 175182, 168411, 172475, 174289, // legumes, tofu, hummus
  171413, 172336, 171016, 174277, 168556, 171192, // oils, sauces
])

export interface Staple {
  fdcId: number
  /** One of the row's own names, so the addition resolves to the same numbers anywhere else. */
  name: string
  macro: Macro
  style: MealStyle
  /** Words in a restriction that rule this staple out. */
  excludedBy: readonly string[]
  /** The most of it a top-up will add: a portion, not a nutrition figure. */
  maxG: number
}

const MEAT = ['meat', 'poultry', 'chicken', 'vegetarian', 'vegan', 'pescatarian', 'plant-based', 'plant based']
const FISH = ['fish', 'seafood', 'tuna', 'vegetarian', 'vegan', 'plant-based', 'plant based']
const DAIRY = ['dairy', 'milk', 'lactose', 'casein', 'whey', 'vegan', 'plant-based', 'plant based']

/** In the order they are tried, per macro and style. */
export const TOP_UP_STAPLES: readonly Staple[] = [
  { fdcId: 171477, name: 'chicken breast, cooked', macro: 'protein', style: 'savoury', excludedBy: MEAT, maxG: 250 },
  { fdcId: 173709, name: 'tuna in water', macro: 'protein', style: 'savoury', excludedBy: FISH, maxG: 200 },
  { fdcId: 172475, name: 'firm tofu', macro: 'protein', style: 'savoury', excludedBy: ['soy', 'soya', 'tofu'], maxG: 250 },
  { fdcId: 170894, name: 'nonfat greek yogurt', macro: 'protein', style: 'sweet', excludedBy: [...DAIRY, 'yogurt', 'yoghurt'], maxG: 300 },
  { fdcId: 172182, name: 'low fat cottage cheese', macro: 'protein', style: 'sweet', excludedBy: [...DAIRY, 'cheese'], maxG: 250 },
  { fdcId: 169753, name: 'white rice, cooked', macro: 'carbs', style: 'savoury', excludedBy: ['rice', 'grain', 'low carb', 'keto'], maxG: 300 },
  { fdcId: 170438, name: 'potatoes, boiled', macro: 'carbs', style: 'savoury', excludedBy: ['potato', 'nightshade', 'low carb', 'keto'], maxG: 300 },
  { fdcId: 173944, name: 'banana', macro: 'carbs', style: 'sweet', excludedBy: ['banana', 'fruit', 'low carb', 'keto'], maxG: 150 },
  { fdcId: 173904, name: 'rolled oats', macro: 'carbs', style: 'sweet', excludedBy: ['oat', 'gluten', 'grain', 'coeliac', 'celiac', 'low carb', 'keto'], maxG: 100 },
  { fdcId: 171413, name: 'olive oil', macro: 'fat', style: 'savoury', excludedBy: ['olive', 'oil'], maxG: 20 },
  { fdcId: 171705, name: 'avocado', macro: 'fat', style: 'savoury', excludedBy: ['avocado'], maxG: 100 },
  { fdcId: 170567, name: 'almonds', macro: 'fat', style: 'sweet', excludedBy: ['nut', 'almond'], maxG: 40 },
  { fdcId: 170554, name: 'chia seeds', macro: 'fat', style: 'sweet', excludedBy: ['seed', 'chia'], maxG: 30 },
  { fdcId: 172470, name: 'peanut butter', macro: 'fat', style: 'sweet', excludedBy: ['peanut', 'nut', 'legume'], maxG: 32 },
]

/** A meal's style from the ingredients the table recognises, or null when it cannot say. */
export function mealStyle(
  ingredients: readonly NutritionIngredient[],
  table: readonly FoodReferenceRow[] = FDC_SR_LEGACY_ROWS,
): MealStyle | null {
  let sweet = false
  let savoury = false
  for (const ing of ingredients) {
    const row = referenceRowFor(ing.name, table)
    if (!row) continue
    if (SWEET_IDS.has(row.fdcId)) sweet = true
    if (SAVOURY_IDS.has(row.fdcId)) savoury = true
  }
  if (sweet === savoury) return null
  return sweet ? 'sweet' : 'savoury'
}

/** True when any recorded restriction rules this staple out. */
export function stapleRestricted(staple: Staple, restrictions: readonly string[]): boolean {
  const words = [...staple.excludedBy, staple.name].map(text)
  return restrictions.map(text).filter(r => r.length >= 3).some(r =>
    words.some(w => r.includes(w) || w.includes(r)))
}

export interface StapleTopUpInput {
  ingredients: readonly NutritionIngredient[]
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number }
  /** Allergies, avoids and excluded foods, as recorded. */
  restrictions: readonly string[]
  table?: readonly FoodReferenceRow[]
}

const MACROS: readonly { key: Macro; per100: 'proteinPer100g' | 'carbsPer100g' | 'fatPer100g'; fit: 'protein' | 'carbs' | 'fat' }[] = [
  { key: 'protein', per100: 'proteinPer100g', fit: 'protein' },
  { key: 'carbs', per100: 'carbsPer100g', fit: 'carbs' },
  { key: 'fat', per100: 'fatPer100g', fit: 'fat' },
]

/**
 * The meal with staples added and re-portioned, when that closes every short macro; null when it
 * cannot (no style, no eligible staple for a short macro, or the result still falls short or does
 * not improve the fit by `TOP_UP_MIN_IMPROVEMENT`). Null means "ask the model", never "give up".
 */
export function planStapleTopUp(input: StapleTopUpInput): NutritionIngredient[] | null {
  const table = input.table ?? FDC_SR_LEGACY_ROWS
  const { targets } = input
  const ingredients = [...input.ingredients]
  if (ingredients.length === 0) return null

  const scaled = scaleIngredientsToTargets(ingredients, targets) as NutritionIngredient[]
  const before = sumIngredients(scaled)
  const fit = mealFit(before, targets)
  const short = MACROS.filter(m => fit[m.fit].status === 'under')
  if (short.length === 0) return null

  const style = mealStyle(ingredients, table)
  if (!style) return null

  const present = new Set(ingredients.map(i => referenceRowFor(i.name, table)?.fdcId).filter(Boolean))
  const additions: NutritionIngredient[] = []
  for (const m of short) {
    // Staples of the meal's style are taken in order, each up to its cap, until the gap is covered.
    let gramsShort = -fit[m.fit].delta
    const per100Key = m.key === 'protein' ? 'proteinG' : m.key === 'carbs' ? 'carbsG' : 'fatG'
    for (const staple of TOP_UP_STAPLES) {
      if (!(gramsShort > 0)) break
      if (staple.macro !== m.key || staple.style !== style) continue
      if (present.has(staple.fdcId) || stapleRestricted(staple, input.restrictions)) continue
      const row = table.find(r => r.fdcId === staple.fdcId)
      if (!row || !(row[per100Key] > 0)) continue
      const addition: NutritionIngredient = {
        name: staple.name,
        weightG: 0,
        caloriesPer100g: row.kcal,
        proteinPer100g: row.proteinG,
        carbsPer100g: row.carbsG,
        fatPer100g: row.fatG,
      }
      // The scaler files a food by its dominant macro; a staple filed elsewhere would be portioned
      // against the wrong target.
      if (dominantMacro(addition) !== m.key) continue
      addition.weightG = Math.max(5, Math.min(staple.maxG, Math.round(gramsShort / (row[per100Key] / 100))))
      gramsShort -= addition.weightG * row[per100Key] / 100
      additions.push(addition)
      present.add(staple.fdcId)
    }
    if (gramsShort > fit[m.fit].target * 0.1) return null
  }

  const caps = new Map(additions.map(a => [a.name, TOP_UP_STAPLES.find(s => s.name === a.name)!.maxG]))
  // The scaler portions the additions with the rest of the meal, and may stretch one past its cap
  // when the gap is wide. Held to the cap, and the fit judged on what is actually offered.
  const merged = (scaleIngredientsToTargets([...ingredients, ...additions], targets) as NutritionIngredient[])
    .map(i => {
      const cap = caps.get(i.name)
      return cap != null && i.weightG > cap ? { ...i, weightG: cap } : i
    })
  const after = sumIngredients(merged)
  const afterFit = mealFit(after, targets)
  if (MACROS.some(m => afterFit[m.fit].status === 'under')) return null
  if (!(fitDistance(after, targets) < fitDistance(before, targets) * (1 - TOP_UP_MIN_IMPROVEMENT))) return null
  return merged
}
