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

/** The one caption line under the chips: shown only when a chip actually carries the mark. */
export function readinessMarkCaption(chips: readonly { flagged: boolean }[]): string | null {
  return chips.some((chip) => chip.flagged) ? 'Marked: in today’s session' : null;
}
