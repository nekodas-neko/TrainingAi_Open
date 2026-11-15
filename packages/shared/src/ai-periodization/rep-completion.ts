/**
 * How much of what a session asked for the lifter did (#3800).
 *
 * Each set is measured against the reps the app asked for on THAT set (`set_logs.planned_reps`,
 * written when it was logged). It used to divide by the session type's stored prescription, which
 * at any generation after the workout is already the NEXT plan: a bigger plan made a finished
 * session read as missed reps, and fired the emergency deload's "missing reps" rule.
 *
 * A set with no planned reps (a freeform or extra set, or one logged before the column existed) is
 * left out of both sides. When no set carries one, there is nothing to compare with and the rate is
 * null, so the rule cannot fire. A planned set that was skipped outright leaves no row, so it is not
 * counted as missed: the stored rows cannot tell it from a set that was never planned.
 */
export interface RepCompletion {
  /** Done ÷ asked across every set that carries a planned figure; null when none does. */
  rate: number | null
  /** The same ratio per exercise name, for exercises with at least one planned set. */
  perExercise: Map<string, number>
}

export function repCompletionFromSetLogs(
  setLogs: ReadonlyArray<{ exerciseName: string; reps: number; plannedReps?: number | null }>,
): RepCompletion {
  const byExercise = new Map<string, { planned: number; done: number }>()
  for (const sl of setLogs) {
    if (sl.plannedReps == null || sl.plannedReps <= 0) continue
    const row = byExercise.get(sl.exerciseName) ?? { planned: 0, done: 0 }
    row.planned += sl.plannedReps
    row.done += sl.reps
    byExercise.set(sl.exerciseName, row)
  }
  let planned = 0
  let done = 0
  const perExercise = new Map<string, number>()
  for (const [name, row] of byExercise) {
    planned += row.planned
    done += row.done
    perExercise.set(name, row.done / row.planned)
  }
  return { rate: planned > 0 ? done / planned : null, perExercise }
}
