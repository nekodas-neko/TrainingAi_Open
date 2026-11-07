import type { RMStyleSet } from '../1rm'

/** One stored `set_logs` row's record of the style its set was planned with. */
export interface LoggedSetPlan {
  set_number: number
  planned_pct: number | null
  planned_reps: number | null
  use_for_1rm: boolean | null
}

/**
 * Issue 3663: the style a logged exercise was scored with, rebuilt from its stored sets.
 *
 * The log path (`logExerciseFromPayload`) scores the payload's `progressionStyle` and stores set
 * i's entry as `planned_pct` / `planned_reps` / `use_for_1rm`. That style is the AI's prescription
 * when the AI drove the session, and Preview sends no `style_id` at all, so these rows are the only
 * faithful record of what the estimate was computed against. An edit re-scores through this so a
 * one-rep correction moves the estimate by that rep, not by the style it lost.
 *
 * Returns `null` when no row carries a plan: the log was styleless, or predates the planned
 * columns, and the caller falls back to `style_id`. Also `null` for a bodyweight exercise: its
 * `planned_pct` is never stored (Q-14), so the rows cannot say which percentage set its target,
 * and it keeps the `style_id` lookup it had before.
 *
 * A set with no stored plan (an extra set the plan did not cover, or one the edit added) is a
 * placeholder that counts only when no set is flagged, which is how the log path treated a set
 * beyond the end of its style.
 */
export function loggedStyleFromSetRows(
  rows: readonly LoggedSetPlan[],
  setCount: number,
  exerciseType: 'weighted' | 'bodyweight',
): RMStyleSet[] | null {
  if (exerciseType === 'bodyweight') return null
  const planned = rows.filter(r => r.planned_reps != null && r.planned_pct != null)
  if (planned.length === 0) return null
  return Array.from({ length: setCount }, (_, i) => {
    const row = planned.find(r => r.set_number === i + 1)
    return row
      ? { pct: row.planned_pct ?? 0, reps: row.planned_reps ?? 0, useFor1rm: row.use_for_1rm === true }
      : { pct: 0, reps: 0, useFor1rm: false }
  })
}
