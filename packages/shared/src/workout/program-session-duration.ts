import {
  estimateSessionDurationSec,
  transitionSecForEquipment,
  type DurationExercise,
} from './duration-model'

/** The few fields of a progression style's sets the duration model reads. */
export interface StyleSetForDuration {
  reps: number
  restSec: number
}

/**
 * A program session's duration from what exists BEFORE a prescription does: each exercise's
 * assigned progression style (its sets / reps / rest) and its equipment (the gap before it).
 * One reps/rest figure per exercise (the mean of the style's sets), summed through
 * `estimateSessionDurationSec` — the model the prescription itself is fitted and shown with, so
 * a session card and the session screen read one formula (#2362: the cards multiplied the
 * exercise count by a flat 9 min while the screen read ~21 min of work one tap later).
 *
 * Returns the SECONDS (callers round), or `null` when no exercise has a style to price — a card
 * then shows no number rather than a guess. An exercise with no style is skipped, so a partly
 * styled session understates rather than invents a shape.
 */
export function estimateProgramSessionSec(
  exercises: ReadonlyArray<{ exerciseName: string; styleId?: string | null }>,
  styleSetsById: ReadonlyMap<string, ReadonlyArray<StyleSetForDuration>>,
  equipmentOf: (exerciseName: string) => string[] | undefined,
): number | null {
  const inputs: DurationExercise[] = []
  for (const ex of exercises) {
    const sets = ex.styleId ? styleSetsById.get(ex.styleId) : undefined
    if (!sets || sets.length === 0) continue
    inputs.push({
      sets: sets.length,
      reps: Math.round(sets.reduce((n, s) => n + s.reps, 0) / sets.length),
      restSec: Math.round(sets.reduce((n, s) => n + s.restSec, 0) / sets.length),
      transitionSec: transitionSecForEquipment(equipmentOf(ex.exerciseName)),
    })
  }
  return inputs.length === 0 ? null : estimateSessionDurationSec(inputs)
}

/** The card label's number: whole minutes, or `null` when there is nothing to price. */
export function estimateProgramSessionMin(
  exercises: ReadonlyArray<{ exerciseName: string; styleId?: string | null }>,
  styleSetsById: ReadonlyMap<string, ReadonlyArray<StyleSetForDuration>>,
  equipmentOf: (exerciseName: string) => string[] | undefined,
): number | null {
  const sec = estimateProgramSessionSec(exercises, styleSetsById, equipmentOf)
  return sec === null ? null : Math.round(sec / 60)
}
