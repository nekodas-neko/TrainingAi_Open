import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * BF-98 — the footer that repeated a group's own macros.
 *
 * `meal-card.tsx` gated its totals footer on `logs.length > 1`, the **flat** list. A section holding
 * one grouped meal of three ingredients passed that, so the card drew the group's macros and then
 * the identical footer beneath them — `P 30g C 7g F 5g` twice, stacked, with the calories doubled
 * too. The rule was already written for the collapsed branch (*"a single row already states its own
 * macros, so a footer would repeat it"*) and a group **is** a single row; the expanded branch was
 * never told.
 *
 * **Two halves, because one of them cannot see the card.** The cases below pin what
 * `groupDiaryEntries` returns — the count the condition must read — and the last test pins that the
 * card reads *that* count and not the flat one. A rendering test would be better and there is not
 * one: both vitest projects are `environment: 'node'`, and an e2e attempt is recorded at the bottom
 * of this block as **not** reproducing the duplication, so it is not here pretending to.
 */
describe('BF-98 — how many rows the card actually draws', () => {
  const MEAL = 'meal-1'
  const known = new Set([MEAL])
  const grouped = (groupId: string, n: number) =>
    Array.from({ length: n }, () => log({ savedMealId: MEAL, mealGroupId: groupId }))

  it('one group of three is ONE entry, so the footer is suppressed', () => {
    const entries = groupDiaryEntries(grouped('g1', 3), known)
    expect(entries).toHaveLength(1)
    expect(entries.length > 1, 'the footer would repeat the group row').toBe(false)
    // The flat count is what the old condition read, and it is why the bug existed.
    expect(grouped('g1', 3).length > 1).toBe(true)
  })

  it('one group plus a loose row is TWO entries, so the footer returns', () => {
    const entries = groupDiaryEntries([...grouped('g1', 3), log()], known)
    expect(entries).toHaveLength(2)
    expect(entries.length > 1).toBe(true)
  })

  it('two loose rows keep their footer — unchanged behaviour', () => {
    expect(groupDiaryEntries([log(), log()], known)).toHaveLength(2)
  })

  it('a single loose row has no footer — unchanged behaviour', () => {
    expect(groupDiaryEntries([log()], known)).toHaveLength(1)
  })

  it('two separate groups are two entries, so the footer is right to show', () => {
    const entries = groupDiaryEntries([...grouped('g1', 2), ...grouped('g2', 2)], known)
    expect(entries).toHaveLength(2)
    expect(entries.length > 1).toBe(true)
  })
})

/**
 * The card must read the entry count, not the log count — the whole of BF-98 in one identifier.
 *
 * **This is a source guard because the rendering could not be made to fail.** An e2e was written
 * against `diary-nested-meal.spec.ts`'s fixture (one saved meal, three ingredients, alone in its
 * section) and it passed **with the fix reverted**: in that fixture the totals footer does not
 * render on either condition, so the duplication the owner photographed did not occur and the test
 * proved nothing. It was deleted rather than kept as a green assertion that cannot fail — this repo
 * has shipped several of those. What in the owner's diary differs from that fixture is unresolved
 * and recorded on the entry; until it is known, this guard is what holds the change.
 */
describe('BF-98 — the card counts rendered entries', () => {
  const card = readFileSync(join(__dirname, '..', 'meal-card.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

  it('gates the totals footer on entries.length, never logs.length', () => {
    expect(card).toMatch(/\{entries\.length > 1 && <MealTotals/)
    expect(card).not.toMatch(/\{logs\.length > 1 && <MealTotals/)
  })

  it('still shows the collapsed summary from the log count, which is a different question', () => {
    // Collapsed, nothing else states the macros, so that branch is right to fire on any log.
    expect(card).toMatch(/!expanded && logs\.length > 0 &&/)
  })
})
