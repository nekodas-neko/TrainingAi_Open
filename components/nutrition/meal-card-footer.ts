import type { DiaryEntry } from '@/components/nutrition/diary-groups'

/** Taken from `DiaryEntry` rather than restated: writing the union out by hand got it wrong once
 *  already ('group' for what the source calls 'meal'), and it typechecked because the wrong name
 *  was declared here too. */
export type DiaryEntryKind = DiaryEntry['kind']

export interface MealFooter {
  /** Draw the totals footer at all. */
  show: boolean
  /** Include the calorie total in it. Macros are the reason the footer exists; the calorie number
   *  is the part that can already be on screen twice. */
  showCalories: boolean
}

/**
 * Whether a section's totals footer is redundant — BF-120 / OR-101.
 *
 * **A `'meal'` entry is not simply "a saved meal".** `groupDiaryEntries` demotes a group holding one
 * log back to a `'log'`, so a saved meal with a single ingredient arrives here as a loose row and is
 * treated as one — correctly, because that is what gets rendered and it states no macros.
 *
 * The gate used to be a COUNT (`entries.length > 1`) and the question is a KIND. Both comments in
 * `meal-card.tsx` reached for it and neither expressed it: *"a single row already states its own
 * macros, so a footer would repeat it"* — true of a group row, and false of a loose one ever since
 * Q-406 moved the per-item P/C/F out of the diary row and into the sheet. So a section holding one
 * loose food showed protein, carbs and fat **nowhere**, while the section above it showed all three.
 *
 * The two reports disagreed about the cause and BF-120's reading is the one that does not hold:
 * BF-98 did not regress this. Its own case table lists *"one loose row → no footer (unchanged)"* —
 * it moved the gate from `logs.length` to `entries.length` to stop a single GROUP drawing its macros
 * twice, which it did correctly. This case has never had a footer.
 *
 * The calorie half is left gated, per BF-120: with one entry the section total *is* that row's
 * number, and the header prints it already, so repeating it is the redundancy BF-98 removed.
 */
export function mealFooter(kinds: DiaryEntryKind[]): MealFooter {
  if (kinds.length === 0) return { show: false, showCalories: false }
  if (kinds.length === 1) {
    // A group row states its own macros AND calories; a loose row states neither.
    return kinds[0] === 'meal'
      ? { show: false, showCalories: false }
      : { show: true, showCalories: false }
  }
  return { show: true, showCalories: true }
}
