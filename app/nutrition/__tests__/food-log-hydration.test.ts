import { describe, it, expect } from 'vitest'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { toLocalFoodLogs, toLocalFoodItems } from '../food-log-hydration'

const item = {
  id: 'item-1', name: 'Peanut Butter', brand: 'Mayver’s', servingSizeG: 20, calories: 120,
  proteinG: 5, carbsG: 3, fatG: 10, fiberG: 1, sugarG: 1, sodiumMg: 2, satFatG: 2,
  imageDataUri: null, source: 'manual',
} as unknown as FoodLogWithItem['foodItem']

function log(over: Partial<FoodLogWithItem> = {}): FoodLogWithItem {
  return {
    id: 'log-1', userId: 'u1', date: '2026-08-31', mealTypeId: 'mt-1', foodItemId: 'item-1',
    quantityMultiplier: 1, loggedAt: '2026-08-31T07:00:00.000Z',
    savedMealId: 'meal-1', mealGroupId: 'group-1', foodItem: item,
    ...over,
  } as FoodLogWithItem
}

/**
 * BF-72 — the diary's own hydration wiped the grouping it had just drawn.
 *
 * The owner saw a saved meal log as one row with its photo and then break into loose ingredients a
 * moment later. `upsertFoodLog` writes `record.savedMealId ?? null`, so a payload that *omits* the
 * field stores NULL over a correct value — and the hydrate was followed immediately by a re-read and
 * a re-render, so the screen destroyed and then displayed its own damage.
 *
 * These assert the two columns by name. A test on the whole object would pass against an omission
 * as long as the other fields matched, which is exactly the shape that shipped.
 */
describe('food-log hydration carries the meal grouping', () => {
  it('keeps savedMealId and mealGroupId', () => {
    const [row] = toLocalFoodLogs([log()], '2026-08-31', '2026-08-31T08:00:00.000Z')
    expect(row.savedMealId, 'a logged meal without this renders as loose ingredients').toBe('meal-1')
    expect(row.mealGroupId, 'the diary groups on this one').toBe('group-1')
  })

  it('maps a loose row’s absent ids to null rather than undefined', () => {
    // `undefined` and `null` both satisfy the type, and the upsert coalesces either — but a row that
    // genuinely has no meal must round-trip as null so a later read cannot tell it apart from one
    // that was stored that way.
    const [row] = toLocalFoodLogs(
      [log({ savedMealId: undefined, mealGroupId: undefined })],
      '2026-08-31',
      '2026-08-31T08:00:00.000Z',
    )
    expect(row.savedMealId).toBeNull()
    expect(row.mealGroupId).toBeNull()
  })

  it('does not let two servings of one meal collapse into each other', () => {
    // Two rows sharing `savedMealId` and differing on `mealGroupId` are the same meal eaten twice.
    // If the grouping id were dropped they would merge; if it were copied they would too.
    const rows = toLocalFoodLogs(
      [log({ id: 'a', mealGroupId: 'group-1' }), log({ id: 'b', mealGroupId: 'group-2' })],
      '2026-08-31',
      '2026-08-31T08:00:00.000Z',
    )
    expect(rows.map(r => r.mealGroupId)).toEqual(['group-1', 'group-2'])
    expect(new Set(rows.map(r => r.savedMealId)).size).toBe(1)
  })

  it('stamps the screen’s date, not the row’s', () => {
    // The hydrate is for the day being viewed; a server row carrying another date would otherwise
    // be filed under it locally.
    const [row] = toLocalFoodLogs([log({ date: '2026-08-30' })], '2026-08-31', '2026-08-31T08:00:00.000Z')
    expect(row.date).toBe('2026-08-31')
  })

  it('normalises a Date loggedAt to an ISO string', () => {
    const [row] = toLocalFoodLogs(
      [log({ loggedAt: new Date('2026-08-31T07:00:00.000Z') as unknown as FoodLogWithItem['loggedAt'] })],
      '2026-08-31',
      '2026-08-31T08:00:00.000Z',
    )
    expect(row.loggedAt).toBe('2026-08-31T07:00:00.000Z')
  })

  it('carries every food-item field the local table renders offline', () => {
    // The log table stores only a `foodItemId`, so this half is what makes a row renderable with no
    // network — the gap that was the original food-disappearing bug.
    const [row] = toLocalFoodItems([log()], '2026-08-31T08:00:00.000Z')
    expect(row).toMatchObject({ id: 'item-1', name: 'Peanut Butter', calories: 120, proteinG: 5, carbsG: 3, fatG: 10 })
  })
})
