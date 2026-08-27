/**
 * Lowering the meal count after pinning meals (BF-11h, plan §3.2).
 *
 * **This is fixing a live silent drop, not adding a nicety.** `MyMealsPicker` caps pins at
 * `mealCount - 1` *at the moment you pick* — one slot always stays open for the plan to work with.
 * Nothing re-checks that cap when the count changes, and `setMealCount` is the whole handler, so
 * going back and lowering the count leaves more pins than slots. The server then caps them
 * (`kept.slice(mealCount)`) and reports `droppedPins`, which is one threshold looser and, until
 * this entry, nothing on the client read.
 *
 * **There is nothing to "transfer".** Removing a slot redistributes the day's macros automatically,
 * because the split derives from the daily totals rather than from the slots. What the user loses
 * is a meal *choice*, and that is the only thing the prompt is about.
 */

/** A pin, in the order it was picked — which is the order the prompt pre-ticks. */
export interface Pin {
  /** A saved-meal id, or the typed meal's own text, which is what identifies it in that list. */
  key: string
  name: string
  kind: 'saved' | 'typed'
}

export interface ReductionDecision {
  /** How many pins may survive: one slot always stays open for the plan. */
  maxKeepable: number
  /** Pre-ticked, in pick order, so the safe path is one tap. */
  preselected: string[]
  /** The pins that no longer fit if the user does nothing — named, never silently truncated. */
  overflow: Pin[]
}

/**
 * The prompt fires only when `K > M - 1`, matching the picker's own cap rather than the server's.
 *
 * Below that the count change needs no interaction at all: re-run the split and say nothing.
 * Above it, the user has to choose which pins to keep, because picking for them is the silent
 * truncation this exists to replace.
 */
export function reductionNeeded(pins: Pin[], mealCount: number): ReductionDecision | null {
  const maxKeepable = Math.max(0, mealCount - 1)
  if (pins.length <= maxKeepable) return null
  return {
    maxKeepable,
    preselected: pins.slice(0, maxKeepable).map(p => p.key),
    overflow: pins.slice(maxKeepable),
  }
}

/**
 * Split a kept-key set back into the two lists the wizard holds.
 *
 * The wizard keeps saved-meal pins and typed meals in separate state, and a typed meal that is
 * dropped from the plan stays in the list as a *steer* rather than disappearing — untick, don't
 * delete. Losing the text entirely would throw away something the user typed to answer a question
 * they were not asked.
 */
export function applyReduction<T extends { text: string; keep: boolean }>(
  keptKeys: string[],
  selectedIds: string[],
  typedMeals: T[],
): { selectedIds: string[]; typedMeals: T[] } {
  const kept = new Set(keptKeys)
  return {
    selectedIds: selectedIds.filter(id => kept.has(id)),
    typedMeals: typedMeals.map(m => m.keep && !kept.has(m.text) ? { ...m, keep: false } : m),
  }
}
