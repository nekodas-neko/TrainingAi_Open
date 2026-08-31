import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'

/**
 * A meal logged as a group, or a single food. What one diary row draws (BF-39).
 *
 * The owner has raised this three times, most recently as *"we need to sort out meals and
 * ingredients; in a nest. so that when you add a meal it adds the meal and not every ingredient or
 * at least nests in the meal."* A screenshot showed one AI-logged breakfast as **eight** diary rows
 * — flour, protein powder, baking powder, salt, milk, eggs, butter, bacon — filling the whole meal
 * section.
 */
export type DiaryEntry =
  | { kind: 'log'; key: string; log: FoodLogWithItem }
  | {
      kind: 'meal'
      key: string
      /** The meal this group came from, for the name and the photo. */
      savedMealId: string
      logs: FoodLogWithItem[]
    }

/** The four numbers a group's header shows, summed over its rows. */
export interface EntryTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export function sumLogs(logs: FoodLogWithItem[]): EntryTotals {
  return logs.reduce<EntryTotals>(
    (acc, l) => ({
      calories: acc.calories + l.calories,
      proteinG: acc.proteinG + l.proteinG,
      carbsG: acc.carbsG + l.carbsG,
      fatG: acc.fatG + l.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}

/**
 * Group a meal's rows into one entry, leaving everything else alone.
 *
 * **Grouped on `mealGroupId`, never on `savedMealId`.** Two servings of the same meal on one day
 * share the meal but not the group, and merging them would report one helping where two were eaten
 * — which is the verification BF-39 asks for by name.
 *
 * **Rows keep the order of their group's FIRST appearance**, so nothing jumps when a meal's rows
 * are not adjacent in the list. A meal logged at 08:00 whose ingredients were interleaved with a
 * later edit still draws where it was eaten.
 *
 * **A group needs a resolvable meal, and `knownMealIds` is how it is told.** Nothing back-fills:
 * meals logged before the columns shipped carry NULL and render loose, which is correct rather than
 * broken. So does a group whose meal has since been deleted — the rows are still real food, and
 * heading them "Meal" would be inventing a name the app does not have.
 */
export function groupDiaryEntries(
  logs: FoodLogWithItem[],
  knownMealIds: ReadonlySet<string>,
): DiaryEntry[] {
  const out: DiaryEntry[] = []
  const byGroup = new Map<string, Extract<DiaryEntry, { kind: 'meal' }>>()

  for (const log of logs) {
    const groupId = log.mealGroupId
    const mealId = log.savedMealId
    if (!groupId || !mealId || !knownMealIds.has(mealId)) {
      out.push({ kind: 'log', key: log.id, log })
      continue
    }
    const existing = byGroup.get(groupId)
    if (existing) {
      existing.logs.push(log)
      continue
    }
    const entry: Extract<DiaryEntry, { kind: 'meal' }> = {
      kind: 'meal', key: `meal:${groupId}`, savedMealId: mealId, logs: [log],
    }
    byGroup.set(groupId, entry)
    out.push(entry)
  }

  // A "group" of one is a single food wearing a meal's name — the nesting buys nothing and costs a
  // tap. It renders as the plain row it already is.
  return out.map(e => (e.kind === 'meal' && e.logs.length === 1
    ? { kind: 'log' as const, key: e.logs[0].id, log: e.logs[0] }
    : e))
}
