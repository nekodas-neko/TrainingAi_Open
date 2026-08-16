export interface LibraryEntry {
  name: string;
  muscles: { muscle: string; role: string }[];
  equipment: string[];
  /** Set when a data migration merged this catalogue entry into another (Q-26) — must not be
   *  offered as a substitute. */
  mergedInto?: string;
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
  return library
    .filter(ex => {
      if (ex.name === original.name) return false;
      if (ex.mergedInto) return false;
      const hitsInjured = ex.muscles.some(m => injured.has(m.muscle.toLowerCase()));
      if (hitsInjured) return false;
      return ex.muscles.some(m => m.role === "main" && safeMains.has(m.muscle.toLowerCase()));
    })
    .slice(0, limit);
}
