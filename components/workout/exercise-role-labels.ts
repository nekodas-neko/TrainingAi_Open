/**
 * The three exercise roles, named once.
 *
 * BF-125: the builder review screen said *Main / Compound / Accessory* and the program editor said
 * *Main Compound / Secondary Compound / Accessory* — same three enum values, two wordings, and the
 * user meets both while doing one thing (spot a bad role on review, go to the editor to change it).
 *
 * The wording is the short set, for two reasons. *Main* and *Compound* were not parallel — a main
 * lift **is** a compound, so the old review labels read as two different axes rather than a
 * ranking. And the long set is what overflowed the editor's role row (BF-124): three buttons in a
 * non-wrapping flex, the longest wrapping to two lines and `Accessory` clipped at the right edge.
 */
import type { ExerciseRole } from '@trainingai/shared/types/program'

/** Ordered for display. The type stays the canonical one in `types/program` — this file names the
 *  words the user reads, not the values the app stores. */
export const EXERCISE_ROLES: readonly ExerciseRole[] = ['primary', 'secondary', 'accessory']

export const EXERCISE_ROLE_LABEL: Record<ExerciseRole, string> = {
  primary: 'Main',
  secondary: 'Secondary',
  accessory: 'Accessory',
}

/**
 * A missing or unrecognised role reads as `primary`, matching what the editor's selected-pill logic
 * already does with `ex.exerciseRole ?? 'primary'`. The two have to agree: a badge that named the
 * raw enum value while the editor highlighted Main would be the same mismatch this file exists to
 * remove, one layer down.
 */
export function exerciseRoleLabel(role: string | null | undefined): string {
  return EXERCISE_ROLE_LABEL[role as ExerciseRole] ?? EXERCISE_ROLE_LABEL.primary
}

export const EXERCISE_ROLE_BADGE: Record<ExerciseRole, string> = {
  primary: 'bg-brand/20 text-brand',
  secondary: 'bg-amber-500/20 text-amber-400',
  accessory: 'bg-zinc-500/20 text-zinc-400',
}

export function exerciseRoleBadge(role: string | null | undefined): string {
  return EXERCISE_ROLE_BADGE[role as ExerciseRole] ?? EXERCISE_ROLE_BADGE.primary
}
