import { describe, it, expect } from 'vitest'
import { groupDiaryEntries, sumLogs } from '../diary-groups'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'

/**
 * Grouping a logged meal's rows into one diary entry (BF-39).
 *
 * The owner's report, three times over: logging a saved meal writes one `food_logs` row per
 * ingredient, and the diary drew eight rows where one thing was eaten. The engine half — the
 * `saved_meal_id` and `meal_group_id` columns — shipped separately; this is the pass that reads it.
 */

let seq = 0
function log(over: Partial<FoodLogWithItem> = {}): FoodLogWithItem {
  seq += 1
  return {
    id: `log-${seq}`,
    userId: 'u',
    date: '2026-08-30',
    mealTypeId: 'breakfast',
    foodItemId: `food-${seq}`,
    quantityMultiplier: 1,
    loggedAt: new Date('2026-08-30T08:00:00Z'),
    calories: 100, proteinG: 10, carbsG: 5, fatG: 2,
    savedMealId: null,
    mealGroupId: null,
    foodItem: { id: `food-${seq}`, name: `Food ${seq}` } as FoodLogWithItem['foodItem'],
    ...over,
  } as FoodLogWithItem
}

const known = (...ids: string[]) => new Set(ids)

describe('groupDiaryEntries', () => {
  it('leaves an ordinary food alone', () => {
    const a = log()
    expect(groupDiaryEntries([a], known())).toEqual([{ kind: 'log', key: a.id, log: a }])
  })

  it('folds a meal\'s rows into one entry, in the order the meal first appears', () => {
    const before = log()
    const one = log({ savedMealId: 'meal-1', mealGroupId: 'g1' })
    const two = log({ savedMealId: 'meal-1', mealGroupId: 'g1' })
    const after = log()

    const out = groupDiaryEntries([before, one, two, after], known('meal-1'))
    expect(out.map(e => e.kind)).toEqual(['log', 'meal', 'log'])
    const group = out[1]
    expect(group.kind === 'meal' && group.logs.map(l => l.id)).toEqual([one.id, two.id])
    expect(group.kind === 'meal' && group.savedMealId).toBe('meal-1')
  })

  it('keeps a group together even when its rows are not adjacent', () => {
    const one = log({ savedMealId: 'meal-1', mealGroupId: 'g1' })
    const other = log()
    const two = log({ savedMealId: 'meal-1', mealGroupId: 'g1' })

    const out = groupDiaryEntries([one, other, two], known('meal-1'))
    expect(out.map(e => e.kind)).toEqual(['meal', 'log'])
    expect(out[0].kind === 'meal' && out[0].logs).toHaveLength(2)
  })

  /**
   * The verification BF-39 names outright. Both servings are the SAME meal, so grouping on
   * `savedMealId` would report one helping where two were eaten.
   */
  it('keeps two servings of the same meal on the same day apart', () => {
    const rows = [
      log({ savedMealId: 'meal-1', mealGroupId: 'g1' }),
      log({ savedMealId: 'meal-1', mealGroupId: 'g1' }),
      log({ savedMealId: 'meal-1', mealGroupId: 'g2' }),
      log({ savedMealId: 'meal-1', mealGroupId: 'g2' }),
    ]
    const out = groupDiaryEntries(rows, known('meal-1'))
    expect(out).toHaveLength(2)
    expect(out.every(e => e.kind === 'meal')).toBe(true)
    expect(out[0].key).not.toBe(out[1].key)
  })

  it('leaves pre-BF-39 rows loose — nothing back-fills, and that is correct rather than broken', () => {
    const rows = [log(), log()]
    expect(groupDiaryEntries(rows, known('meal-1')).map(e => e.kind)).toEqual(['log', 'log'])
  })

  it('leaves a deleted meal\'s rows loose rather than heading them with a name it does not have', () => {
    const rows = [
      log({ savedMealId: 'gone', mealGroupId: 'g1' }),
      log({ savedMealId: 'gone', mealGroupId: 'g1' }),
    ]
    expect(groupDiaryEntries(rows, known('meal-1')).map(e => e.kind)).toEqual(['log', 'log'])
  })

  it('does not nest a one-row group — it is a single food wearing a meal\'s name', () => {
    const only = log({ savedMealId: 'meal-1', mealGroupId: 'g1' })
    const out = groupDiaryEntries([only], known('meal-1'))
    expect(out).toEqual([{ kind: 'log', key: only.id, log: only }])
  })

  it('needs BOTH columns — a row with one of them is not a group', () => {
    const rows = [
      log({ savedMealId: 'meal-1', mealGroupId: null }),
      log({ savedMealId: null, mealGroupId: 'g1' }),
    ]
    expect(groupDiaryEntries(rows, known('meal-1')).map(e => e.kind)).toEqual(['log', 'log'])
  })
})

describe('sumLogs', () => {
  it('adds the four numbers a group header shows', () => {
    expect(sumLogs([log({ calories: 100, proteinG: 10, carbsG: 5, fatG: 2 }),
                    log({ calories: 250, proteinG: 3, carbsG: 40, fatG: 8 })]))
      .toEqual({ calories: 350, proteinG: 13, carbsG: 45, fatG: 10 })
  })

  it('is zero for nothing, not NaN', () => {
    expect(sumLogs([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
  })
})
