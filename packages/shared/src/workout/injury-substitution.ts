export interface LibraryEntry {
  name: string;
  muscles: { muscle: string; role: string }[];
  equipment: string[];
  /** Set when a data migration merged this catalogue entry into another (Q-26) — must not be
   *  offered as a substitute. */
  mergedInto?: string;
}

/**
 * Every library entry that does not touch an injured muscle in any role.
 *
 * Extracted from `injurySafeAlternatives` below so the program builder can filter its candidate
 * list with the same predicate the mid-workout swap sheet substitutes by (BF-68). Deciding this in
 * a prompt instead would let the builder and the swap sheet disagree about the same injury — the
 * builder would put an exercise into the program that the swap sheet then offers to replace.
 */
export function excludeInjuredExercises<T extends LibraryEntry>(
  library: T[],
  injuredMuscles: string[],
): T[] {
  const injured = new Set(injuredMuscles.map(m => m.toLowerCase()));
  if (injured.size === 0) return library;
  return library.filter(ex => !ex.muscles.some(m => injured.has(m.muscle.toLowerCase())));
}

// A candidate must share >=1 non-injured main muscle with the original AND
// must not involve any injured muscle in main or secondary roles.
export function injurySafeAlternatives<T extends LibraryEntry>(
  original: { name: string; mainMuscles: string[] },
  injuredMuscles: string[],
  library: T[],
  limit = 8,
): T[] {
  const injured = new Set(injuredMuscles.map(m => m.toLowerCase()));
  const safeMains = new Set(
    original.mainMuscles.map(m => m.toLowerCase()).filter(m => !injured.has(m)),
  );
  if (safeMains.size === 0) return [];
  return excludeInjuredExercises(library, injuredMuscles)
    .filter(ex => {
      if (ex.name === original.name) return false;
      if (ex.mergedInto) return false;
      return ex.muscles.some(m => m.role === "main" && safeMains.has(m.muscle.toLowerCase()));
    })
    .slice(0, limit);
}
