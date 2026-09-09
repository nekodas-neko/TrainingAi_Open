import { activeInjuredMuscles } from "@trainingai/shared/workout/injury-context";
import type { Injury } from "@trainingai/shared/types/injury";

/**
 * Which of an exercise's muscles are currently injured, and how to say it (BF-135).
 *
 * A plain `.ts` module rather than part of `injury-notice.tsx` for the reason `calorie-zone-bar`'s
 * sibling already records: vitest cannot parse JSX, so a helper that wants a unit test cannot live
 * beside a component.
 */

/** In the order the exercise lists them — main muscles first, then secondary. */
export function injuredMusclesFor(
  exercise: { mainMuscles?: string[] | null; secondaryMuscles?: string[] | null } | undefined,
  injuries: Injury[],
): string[] {
  if (!exercise) return [];
  // `activeInjuredMuscles` is the shared definition of what is injured — lowercased and
  // de-duplicated there — so this does not hand-roll a second one beside the swap sheet's.
  const injured = new Set(activeInjuredMuscles(injuries));
  const muscles = [...(exercise.mainMuscles ?? []), ...(exercise.secondaryMuscles ?? [])];
  // De-duplicated on the way out too: a muscle listed as both main and secondary printed twice.
  return [...new Set(muscles.filter(m => injured.has(m.toLowerCase())))];
}

const titleCase = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

/** `Lower back` · `Lower back, Glutes` — the muscles, as the user reads them. */
export function injuryLabel(muscles: string[]): string {
  return muscles.map(titleCase).join(", ");
}

/**
 * What the chip says when there is no room for the list — `Back`, `Back +1`.
 *
 * The first muscle in full plus a count, rather than a truncated list: `Lower back, Glutes` clipped
 * to `Lower back, Glu…` loses the second name anyway and costs the reader a moment working out that
 * it was cut. The full list is on the ready screen's banner and in the chip's accessible name.
 */
export function injuryChipLabel(muscles: string[]): string {
  if (muscles.length === 0) return "";
  const first = titleCase(muscles[0]);
  return muscles.length > 1 ? `${first} +${muscles.length - 1}` : first;
}
