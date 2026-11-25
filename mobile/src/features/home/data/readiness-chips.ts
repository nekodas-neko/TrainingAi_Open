import { moodMuscleMatches } from '@trainingai/shared/muscles';

export type ReadinessChip = { value: string; marked: boolean; flagged: boolean; label: string };

/**
 * The sore-muscle chips of the readiness sheet: `marked` is a suggestion from the app, `flagged`
 * means today's session works that muscle. The sheet speaks and draws the flag; the text is the
 * muscle's name alone.
 */
export function readinessChips(
  muscles: readonly string[],
  suggestions: readonly string[],
  sessionMuscles: readonly string[],
): ReadinessChip[] {
  return muscles.map((value) => ({
    value,
    marked: suggestions.includes(value),
    flagged: sessionMuscles.some((target) => moodMuscleMatches(target, value)),
    label: value,
  }));
}

/** The one caption line under the chips: shown when today's session has muscles to mark. */
export function readinessMarkCaption(sessionMuscles: readonly string[]): string | null {
  return sessionMuscles.length > 0 ? 'Marked: in today’s session' : null;
}
