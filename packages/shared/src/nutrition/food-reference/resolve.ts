// #3749. Where an ingredient's per-100 g numbers come from, decided by code.
//
// The model says what a food is and how much of it there is. Its per-100 g figures came from its
// memory on every call, so oats could be one number in Monday's scan and another in Tuesday's meal
// plan. Code now supplies them whenever it knows the food, tried in this order:
//
//   1. the user's own saved food of that name, when it came from a barcode (see
//      `TRUSTED_SAVED_FOOD_SOURCES` for why only a barcode);
//   2. the bundled USDA FoodData Central table (`fdc-sr-legacy.ts`);
//   3. nothing: the model's numbers stand, and the ingredient is marked `estimated`.
//
// A name matches only when it is the same after case and whitespace folding (`text()`, the one
// normalisation `food-item-identity.ts` uses). Never a near match: "chicken breast" does not match
// "chicken breast, cooked", and that is the point. A food whose numbers depend on how it was
// prepared has no bare name in the table, so a wrong guess there stays the model's, marked as one.
//
// PURE: no I/O. The saved foods are passed in, already scoped to the signed-in user.

import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { text } from '../food-item-identity'
import { FDC_SR_LEGACY_ROWS } from './fdc-sr-legacy'
import type { FoodReferenceRow } from './types'

/** A saved food as the resolver needs it. A `FoodItem` is a superset. */
export interface SavedFoodForDensity {
  id: string
  name: string
  source: string | null | undefined
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * The `food_items.source` values whose numbers did not come from a model.
 *
 * Only `'barcode'`. The issue asks for barcode, label and hand entry, but the column cannot tell a
 * hand-typed food apart:
 *  - `'manual'` is also written for a friend's shared meal copied into the library
 *    (`save-shared-meal.ts`), whose numbers may be that friend's AI scan; it is the default when a
 *    write sends no source (`/api/nutrition/food-items`, the local store's row mapper); and it is
 *    what an edited scan becomes (`sourceAfterEdit`).
 *  - A label has no value of its own.
 *  - `'text'` is a food-database name search, and older rows of it cannot be dated.
 * Treating an unknown origin as an AI estimate is the issue's own rule ("never an earlier AI
 * estimate, or the first guess becomes permanent"). Recording hand entry reliably needs a new
 * source value, which is a migration, and is described on #3749 rather than built here.
 */
export const TRUSTED_SAVED_FOOD_SOURCES: readonly string[] = ['barcode']

export type DensitySource = 'saved-food' | 'reference'

export interface IngredientDensity {
  caloriesPer100g: number
  proteinPer100g: number
  carbsPer100g: number
  fatPer100g: number
  source: DensitySource
  /** The saved food's id, or `fdc:<id>` for a table row: where the number can be traced to. */
  ref: string
}

export interface ResolveContext {
  /** The signed-in user's own saved foods. Never another user's: the caller scopes the read. */
  savedFoods?: readonly SavedFoodForDensity[]
  /** The bundled table. Defaults to the shipped one; tests pass their own. */
  table?: readonly FoodReferenceRow[]
}

const r2 = (n: number) => Math.round(n * 100) / 100

function savedFoodDensity(f: SavedFoodForDensity): IngredientDensity | null {
  const serving = Number(f.servingSizeG)
  if (!(serving > 0)) return null
  const per100 = (v: number) => r2(Math.max(0, Number(v) || 0) * 100 / serving)
  return {
    caloriesPer100g: per100(f.calories),
    proteinPer100g: per100(f.proteinG),
    carbsPer100g: per100(f.carbsG),
    fatPer100g: per100(f.fatG),
    source: 'saved-food',
    ref: f.id,
  }
}

const sameNumbers = (a: IngredientDensity, b: IngredientDensity) =>
  a.caloriesPer100g === b.caloriesPer100g && a.proteinPer100g === b.proteinPer100g
  && a.carbsPer100g === b.carbsPer100g && a.fatPer100g === b.fatPer100g

/** Rows by folded name. Built once per table; the shipped table is cached. */
const indexes = new WeakMap<readonly FoodReferenceRow[], Map<string, FoodReferenceRow>>()
function tableIndex(table: readonly FoodReferenceRow[]): Map<string, FoodReferenceRow> {
  let index = indexes.get(table)
  if (!index) {
    index = new Map()
    for (const row of table) for (const n of row.names) {
      const key = text(n)
      // The build script refuses a name listed twice; first wins if a hand-made table does it.
      if (!index.has(key)) index.set(key, row)
    }
    indexes.set(table, index)
  }
  return index
}

/** The table row a name answers to, by its exact folded name, or null. */
export function referenceRowFor(
  name: string,
  table: readonly FoodReferenceRow[] = FDC_SR_LEGACY_ROWS,
): FoodReferenceRow | null {
  const key = text(name)
  if (!key) return null
  return tableIndex(table).get(key) ?? null
}

/**
 * The per-100 g numbers code knows for this name, or null when it knows none.
 *
 * Saved foods are tried first, and only those whose origin is trusted. When two of them share the
 * name and disagree, neither is used: picking one would be choosing a winner silently, which is
 * the line `food-item-identity.ts` draws too. The table is then tried as if there were none.
 */
export function resolveIngredientDensity(name: string, ctx: ResolveContext = {}): IngredientDensity | null {
  const key = text(name)
  if (!key) return null

  const own = (ctx.savedFoods ?? [])
    .filter(f => f.source != null && TRUSTED_SAVED_FOOD_SOURCES.includes(f.source) && text(f.name) === key)
    .map(savedFoodDensity)
    .filter((d): d is IngredientDensity => d != null)
  if (own.length > 0 && own.every(d => sameNumbers(d, own[0]))) return own[0]

  const row = referenceRowFor(key, ctx.table)
  if (!row) return null
  return {
    caloriesPer100g: row.kcal,
    proteinPer100g: row.proteinG,
    carbsPer100g: row.carbsG,
    fatPer100g: row.fatG,
    source: 'reference',
    ref: `fdc:${row.fdcId}`,
  }
}

export interface AppliedDensities {
  ingredients: NutritionIngredient[]
  /** How many ingredients took their numbers from code. */
  matched: number
  total: number
}

/**
 * Every ingredient with code's numbers where it has them, and `estimated: true` where it does not.
 * Name and weight are the model's and are never changed. An unmatched ingredient's numbers pass
 * through untouched, so with no match anywhere the result is the model's reply plus the marks.
 */
export function applyReferenceDensities(
  ingredients: readonly NutritionIngredient[],
  ctx: ResolveContext = {},
): AppliedDensities {
  let matched = 0
  const out = ingredients.map(ing => {
    const d = resolveIngredientDensity(ing.name, ctx)
    // Rebuilt rather than spread, so a stale `estimated` from an earlier pass cannot survive a match.
    const { estimated: _stale, ...rest } = ing
    if (!d) return { ...rest, estimated: true }
    matched++
    return {
      ...rest,
      caloriesPer100g: d.caloriesPer100g,
      proteinPer100g: d.proteinPer100g,
      carbsPer100g: d.carbsPer100g,
      fatPer100g: d.fatPer100g,
    }
  })
  return { ingredients: out, matched, total: ingredients.length }
}

export type MatchConfidence = 'high' | 'medium' | 'low'

/**
 * The review screen's badge, from code rather than the model's opinion of itself: high when every
 * ingredient's numbers came from code, medium when some did, low when none did.
 */
export function confidenceFromMatches(matched: number, total: number): MatchConfidence {
  if (total > 0 && matched >= total) return 'high'
  if (matched > 0) return 'medium'
  return 'low'
}

/**
 * The badge after `sanitiseNutrition` has run. That function lowers the confidence it is handed
 * exactly when it corrected something, and a correction means the numbers were wrong somewhere,
 * so any change makes the badge low.
 */
export function confidenceAfterSanitise(before: MatchConfidence, after: string | undefined): MatchConfidence {
  return after === before ? before : 'low'
}
