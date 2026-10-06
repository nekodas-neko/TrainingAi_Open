/**
 * The words the user reads for the two role axes — named once, read by every screen.
 *
 * There are two different "roles" in this app and they used to share vocabulary (#2240):
 *
 * - the EXERCISE role (`ExerciseRole`: `primary | secondary | accessory`) — how an exercise is
 *   prescribed in its session;
 * - the MUSCLE role (`MuscleAssignment['role']`: `main | secondary`) — whether a muscle is the one an
 *   exercise is for, or one that helps.
 *
 * The program editor shows both a few lines apart, and it labelled the exercise value `primary` as
 * "Main Compound" while labelling the muscle value `main` as "Primary" — each axis wearing the other's
 * word. The agreed vocabulary is one word per concept: **Primary / Secondary / Accessory** for the
 * exercise, **Target / Assisting** for the muscle. "Main", "Compound" and the long "… Compound" forms
 * are retired — "Compound" was wrong for `secondary` anyway, since an accessory can be a compound too.
 *
 * Only the LABELS changed. The stored values stay `main` / `secondary` / `primary` …; renaming
 * `main` → `target` in storage was declined (#2240: dozens of call sites, catalogue rows and three
 * raw-SQL copies of `muscle_entry->>'role' = 'main'`, any one of which missed halves every
 * muscle-volume number). So a label here never round-trips into storage — it is display only.
 */
import type { ExerciseRole, MuscleAssignment } from '@trainingai/shared/types/program'

/** Ordered for display. */
export const EXERCISE_ROLES: readonly ExerciseRole[] = ['primary', 'secondary', 'accessory']

export const EXERCISE_ROLE_LABEL: Record<ExerciseRole, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accessory: 'Accessory',
}

/** The label for a known exercise role, or `null` for a missing or unrecognised one. Callers that
 *  want the unclassified fallback (BF-15) choose it themselves — see `exerciseRoleLabel` in
 *  `components/workout/exercise-role-labels.ts`. */
export function knownExerciseRoleLabel(role: string | null | undefined): string | null {
  return (EXERCISE_ROLES as readonly string[]).includes(role ?? '')
    ? EXERCISE_ROLE_LABEL[role as ExerciseRole]
    : null
}

export type MuscleRole = MuscleAssignment['role']

/** Ordered for display. */
export const MUSCLE_ROLES: readonly MuscleRole[] = ['main', 'secondary']

export const MUSCLE_ROLE_LABEL: Record<MuscleRole, string> = {
  main: 'Target',
  secondary: 'Assisting',
}
