import { normalizeExerciseName } from '../exercise-gif-matcher'
import type { MuscleAssignment } from '../types/program'

/** Anything with a name — the library entry itself is returned, so the caller gets its
 *  canonical spelling and its muscle assignments from one lookup. */
export interface NamedExercise {
  name: string
}

export interface ExerciseNameResolver<T extends NamedExercise> {
  /** The library entry this name refers to, or null when nothing matches unambiguously. */
  resolve(name: string): T | null
}

/**
 * `normalizeExerciseName` DELETES punctuation rather than replacing it, so "Cable-Row" becomes
 * "cablerow" and never meets "cable row". That behaviour is load-bearing there — the GIF matcher's
 * `DIRECT_URL_OVERRIDES` keys are stored in its output — so the separator is split here instead,
 * symmetrically on both the library name and the query.
 */
function normalise(name: string): string {
  return normalizeExerciseName(name.replace(/[-/]+/g, ' '))
    .split(' ')
    .map(depluralise)
    .join(' ')
}

/**
 * `normalizeExerciseName` de-pluralises only a fixed list of head words, so it reaches "Rows" but
 * not "Deadlifts", "Pull-Ups" or "Planks" — measured against the real catalogue, 49 of 142 rows
 * were unreachable from their own plural, and a model asked for exercise names writes plurals
 * constantly. With this, 0 of the 121 pluralisable rows are. Applied to the library name and the
 * query alike, so it can only widen matching symmetrically — a word it mangles is mangled on both
 * sides and still matches. That symmetry is why it carries no "ss" exception and no length floor:
 * both were written, and both measured inert against the real catalogue and every test here, so
 * keeping them would have been a guard that reads as protection while providing none. The one
 * condition left is structural — never emit an empty token, which would collapse distinct names.
 */
function depluralise(word: string): string {
  if (word.length < 2 || !word.endsWith('s')) return word
  return word.slice(0, -1)
}

/** Word-order-insensitive key: "Bench Press Barbell" and "Barbell Bench Press" share one. */
function wordSetKey(normalised: string): string {
  return normalised.split(' ').filter(Boolean).sort().join(' ')
}

/**
 * Resolve a generated exercise name against the library in three widening tiers: exact, then
 * `normalizeExerciseName` (case, punctuation, abbreviations, plurals), then word order.
 *
 * It deliberately stops there. A subset or edit-distance tier would match "Barbell Back Squat" to
 * "Back Squat", but it would equally match "Incline Bench Press" to "Bench Press" — two different
 * lifts whose histories must not merge. `personal_records` and `exercise_estimates` are unique on
 * `(user_id, exercise_name)`, so a wrong merge writes one lift's PR onto another's and there is no
 * way back; a miss only costs the exercise. Under-merging is the safe direction, the same call
 * `food-item-identity.ts` makes.
 *
 * Two library entries that collapse to the same widened key make that key ambiguous, and an
 * ambiguous key resolves to null rather than to whichever was indexed last.
 */
export function buildExerciseNameResolver<T extends NamedExercise>(
  library: readonly T[],
): ExerciseNameResolver<T> {
  const exact = new Map<string, T>()
  for (const entry of library) {
    if (!exact.has(entry.name)) exact.set(entry.name, entry)
  }

  const normalised = new Map<string, T | null>()
  const byWordSet = new Map<string, T | null>()
  for (const entry of library) {
    const norm = normalise(entry.name)
    for (const [index, key] of [[normalised, norm], [byWordSet, wordSetKey(norm)]] as const) {
      const existing = index.get(key)
      if (existing === undefined) index.set(key, entry)
      else if (existing !== null && existing.name !== entry.name) index.set(key, null)
    }
  }

  return {
    resolve(name: string): T | null {
      const direct = exact.get(name)
      if (direct) return direct
      const norm = normalise(name)
      // `has` rather than `??` on purpose: a key present with a null value is AMBIGUOUS, and must
      // stop the search rather than fall through to a wider tier that could answer it.
      if (normalised.has(norm)) return normalised.get(norm) ?? null
      const wordSet = wordSetKey(norm)
      if (byWordSet.has(wordSet)) return byWordSet.get(wordSet) ?? null
      return null
    },
  }
}

export interface MuscleAssignedExercise extends NamedExercise {
  muscles: readonly MuscleAssignment[]
}

/**
 * Give every generated exercise the library's identity: its canonical name and its muscle
 * assignments, both overwriting whatever the model produced. Names the library does not hold are
 * dropped and returned in `unresolved` so the caller can decide what a miss is worth.
 */
export function resolveAgainstLibrary<E extends NamedExercise, L extends MuscleAssignedExercise>(
  exercises: readonly E[],
  resolver: ExerciseNameResolver<L>,
): {
  resolved: (E & { name: string; mainMuscles: string[]; secondaryMuscles: string[] })[]
  unresolved: string[]
} {
  const resolved: (E & { name: string; mainMuscles: string[]; secondaryMuscles: string[] })[] = []
  const unresolved: string[] = []
  for (const ex of exercises) {
    const entry = resolver.resolve(ex.name)
    if (!entry) {
      unresolved.push(ex.name)
      continue
    }
    resolved.push({
      ...ex,
      name: entry.name,
      mainMuscles: entry.muscles.filter(m => m.role === 'main').map(m => m.muscle),
      secondaryMuscles: entry.muscles.filter(m => m.role === 'secondary').map(m => m.muscle),
    })
  }
  return { resolved, unresolved }
}
