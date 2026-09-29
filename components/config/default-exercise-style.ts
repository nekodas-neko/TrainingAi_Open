import type { ProgressionStyle } from '@trainingai/shared/types'
import type { ExerciseRole } from '@trainingai/shared/types/program'

type StyledSlot = { styleId?: string; exerciseRole?: ExerciseRole }

/**
 * The progression style a slot that has none should carry (LB-186).
 *
 * A slot saved with `style_id IS NULL` behaves normally for as long as the exercise has styled
 * history — the engine falls back to the style on its last log — and then bites on any path that
 * needs a non-empty style: the deload override skipped one and prescribed an ordinary working
 * weight in a deload week (BF-200).
 *
 * The answer is read off the program being edited rather than a named default, because styles,
 * roles and session names are all user-defined and the program is the only authority on what it
 * uses. Where the role is known it wins, because one exercise legitimately carries different styles
 * in different slots (LA-177).
 */
export function defaultStyleIdForSlot(
  sessions: readonly { exercises: readonly StyledSlot[] }[],
  styles: readonly ProgressionStyle[],
  role?: ExerciseRole,
): string | undefined {
  const known = new Set(styles.map(s => s.id))
  const used = sessions
    .flatMap(s => s.exercises)
    .filter((e): e is StyledSlot & { styleId: string } => !!e.styleId && known.has(e.styleId))
  const forRole = role == null ? [] : used.filter(e => e.exerciseRole === role)
  return mostUsed(forRole.map(e => e.styleId))
    ?? mostUsed(used.map(e => e.styleId))
    ?? styles[0]?.id
}

/** Ties go to whichever style the program lists first, so one program always answers the same way. */
function mostUsed(ids: readonly string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  let best: string | undefined
  let bestCount = 0
  for (const [id, count] of counts) if (count > bestCount) { best = id; bestCount = count }
  return best
}
