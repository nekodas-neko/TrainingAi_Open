/**
 * The three exercise roles as the UI shows them: the words, plus the badge colours.
 *
 * The WORDS live in `@trainingai/shared/workout/role-labels` (#2240) — one place for both role axes,
 * exercise (Primary / Secondary / Accessory) and muscle (Target / Assisting) — and are re-exported
 * here so component imports stay put. This file adds what is component-only: the BF-15 fallback for
 * a missing role and the badge classes.
 *
 * BF-125: the builder review screen and the program editor once used two wordings for the same
 * three enum values; BF-124: the long wording overflowed the editor's role row. Both are why the set
 * is short, single words.
 */
import type { ExerciseRole } from '@trainingai/shared/types/program'
import { EXERCISE_ROLE_LABEL } from '@trainingai/shared/workout/role-labels'

export {
  EXERCISE_ROLES,
  EXERCISE_ROLE_LABEL,
  MUSCLE_ROLES,
  MUSCLE_ROLE_LABEL,
} from '@trainingai/shared/workout/role-labels'

/**
 * A missing or unrecognised role reads as the unclassified role (`accessory`, BF-15), matching what
 * the editor's selected-pill logic does with `ex.exerciseRole ?? UNCLASSIFIED_EXERCISE_ROLE`. The two
 * have to agree: a badge that named the raw enum value while the editor highlighted Primary would be
 * the same mismatch this file exists to remove, one layer down.
 */
export function exerciseRoleLabel(role: string | null | undefined): string {
  return EXERCISE_ROLE_LABEL[role as ExerciseRole] ?? EXERCISE_ROLE_LABEL.accessory
}

export const EXERCISE_ROLE_BADGE: Record<ExerciseRole, string> = {
  primary: 'bg-brand/20 text-brand',
  secondary: 'bg-amber-500/20 text-amber-400',
  accessory: 'bg-zinc-500/20 text-zinc-400',
}

export function exerciseRoleBadge(role: string | null | undefined): string {
  return EXERCISE_ROLE_BADGE[role as ExerciseRole] ?? EXERCISE_ROLE_BADGE.accessory
}
