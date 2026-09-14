import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { FoodItem, SavedMeal } from '@trainingai/shared/types/nutrition'
import { savedMealToEntries, matchSavedMeals } from '../saved-meal-flatten'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
/** These files explain the nesting decision in prose, so a raw-source match would pass on comments. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '')

const food = (id: string, name: string, calories: number): FoodItem =>
  ({ id, name, calories, proteinG: 0, carbsG: 0, fatG: 0, servingSizeG: 100 } as unknown as FoodItem)

const meal = (id: string, name: string, items: { item: FoodItem; qty: number }[]): SavedMeal =>
  ({
    id, name, servings: 1,
    items: items.map((e, i) => ({
      id: `${id}-${i}`, savedMealId: id, foodItemId: e.item.id,
      quantityMultiplier: e.qty, foodItem: e.item,
    })),
    totals: { calories: items.reduce((s, e) => s + e.item.calories * e.qty, 0), proteinG: 0, carbsG: 0, fatG: 0 },
  } as unknown as SavedMeal)

/**
 * BF-161 — the owner: *"For the meal builder it should let you add meals/saved items as part of the
 * meal builder."*
 *
 * The schema forbids real nesting (`saved_meal_items.food_item_id` is NOT NULL) and the owner chose
 * flattening over a migration: *"Okay lets go with flatten for now."* So what is pinned here is the
 * flatten's arithmetic, and — because the decision is the expensive part — that no nesting column
 * crept in alongside it.
 */
describe('BF-161 — a saved meal joins the builder as its ingredients', () => {
  it('carries each item through at its stored multiplier', () => {
    const oats = food('f1', 'Oats', 380)
    const milk = food('f2', 'Milk', 64)
    const entries = savedMealToEntries(meal('m1', 'Porridge', [{ item: oats, qty: 0.8 }, { item: milk, qty: 2.5 }]))
    expect(entries).toEqual([{ item: oats, qty: 0.8 }, { item: milk, qty: 2.5 }])
  })

  it('flattens to the WHOLE recipe, which is what makes the entry\'s check true', () => {
    // BF-161's verification: the result must match the SUM OF THE SOURCES. `totals` is documented as
    // the whole recipe and `servings` is what to divide it by, so the multipliers are whole-recipe
    // and must not be divided here.
    const rice = food('f3', 'Rice', 130)
    const m = meal('m2', 'Rice bowl', [{ item: rice, qty: 3 }])
    const flattened = savedMealToEntries(m).reduce((s, e) => s + e.item.calories * e.qty, 0)
    expect(flattened).toBe(m.totals.calories)
  })

  it('an empty meal flattens to nothing rather than a phantom row', () => {
    expect(savedMealToEntries(meal('m3', 'Empty', []))).toEqual([])
  })

  it('filters by name, and an empty query lists them all', () => {
    const a = meal('m4', 'Chicken curry', [])
    const b = meal('m5', 'Porridge', [])
    expect(matchSavedMeals([a, b], '')).toEqual([a, b])
    expect(matchSavedMeals([a, b], 'curry')).toEqual([a])
    expect(matchSavedMeals([a, b], 'CHICK')).toEqual([a])
    expect(matchSavedMeals([a, b], 'zzz')).toEqual([])
  })

  it('no nesting column was added alongside the flatten', () => {
    // The entry is explicit: build the flatten path only. A nullable food_item_id or a
    // nested_saved_meal_id is the migration the owner's decision avoided.
    const schema = read('lib/data/postgres/schema.ts')
    expect(schema).not.toMatch(/nested_saved_meal_id|nestedSavedMealId/)
  })

  it('one mapping, one place — the sheet does not re-derive it', () => {
    // The edit-load path built the same {item, qty} rows inline. Two copies of a mapping is how the
    // whole-recipe-vs-portion question gets answered differently in two places.
    const sheet = code('components/nutrition/saved-meals-sheet.tsx')
    expect(sheet).toContain('savedMealToEntries')
    // Targeted at the BUILDER-ENTRY shape (`item: …foodItem`), not at any items.map: the save path
    // legitimately maps the same rows to the API's `{ foodItemId, quantityMultiplier }` write shape,
    // and a broader pattern flags that as a duplicate when it is a different transformation.
    expect(sheet).not.toMatch(/item:\s*\w+\.foodItem\b/)
  })

  it('the row does not present itself as a live link back to the source', () => {
    // Flattening is a SNAPSHOT: editing the source meal later does not change what was added. The
    // entry says nothing on screen may imply otherwise.
    const results = code('components/nutrition/saved-meal-results.tsx')
    expect(results).not.toMatch(/from ["'`]?\$\{?meal\.name/)
  })
})
