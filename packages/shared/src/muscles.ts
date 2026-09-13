// Canonical muscle-name normalizer — the single source of truth for folding synonym labels
// (exercise-library entries, mood-picker labels, heatmap slugs) to one lowercased name.
// Previously signals.ts, volume-targets.ts and muscle-heatmap.tsx each hand-rolled their own
// synonym handling, and they drifted.

const SYNONYMS: Record<string, string> = {
  pecs: 'chest',
  deltoids: 'shoulders',
  deltoid: 'shoulders',
  delts: 'shoulders',
  quadriceps: 'quads',
  gluteal: 'glutes',
  hamstring: 'hamstrings',
  trapezius: 'traps',
  forearm: 'forearms',
  'external oblique': 'obliques',
  core: 'abs',
  rhomboids: 'upper back',
}

export function normalizeMuscle(raw: string): string {
  const folded = raw.trim().toLowerCase()
  return SYNONYMS[folded] ?? folded
}

// Weighted-set constant for muscle-volume tallies — a main-mover exercise counts double a
// secondary one. Two raw-SQL copies of this same constant remain (see their own comments
// pointing back here); this is the canonical JS-side definition.
export const roleWeight = (role: 'main' | 'secondary'): number => (role === 'main' ? 1.0 : 0.5)

// Matches a mood-tracker muscle label ("Back", "Chest", etc.) against a specific exercise
// muscle. Broad regional labels (back/shoulders/chest) cover several canonical muscles;
// everything else falls back to an exact or substring match on the normalized names.
export function moodMuscleMatches(exerciseMuscle: string, moodLabel: string): boolean {
  const em = normalizeMuscle(exerciseMuscle)
  const mm = normalizeMuscle(moodLabel)
  if (em === mm) return true
  if (mm === 'back') return em.includes('back') || em === 'lats' || em === 'traps' || em === 'rhomboids'
  if (mm === 'shoulders') return em === 'shoulders' || em.includes('delt')
  if (mm === 'chest') return em === 'chest' || em.includes('pec')
  return em.includes(mm)
}

/**
 * Movement pattern a muscle belongs to — the push / pull / legs split (LB-103).
 *
 * Q-305 needs a push:pull balance figure and **rejected computing it inside the card for the right
 * reason**: a private second copy of the grouping in `components/` is exactly the divergence One
 * Formula One Place exists to stop. So it lives here, beside `normalizeMuscle`, because the grouping
 * is a property of a muscle's NAME rather than of anyone's volume table.
 *
 * **Two of these are genuine judgement calls and are written down rather than buried:**
 *
 * - **`shoulders` is push.** The vocabulary has one shoulder name, but the muscle does not split that
 *   way — anterior and lateral heads press, the rear head rows. Pressing is the larger share of the
 *   catalogue's shoulder work and push/pull convention puts it there, so that is the call. Splitting
 *   it properly needs `rear delts` as its own catalogue name, which is a data change, not this one.
 * - **`lower back` is neither.** It is a stabiliser that loads on almost everything — deadlifts,
 *   rows, squats, carries — so counting it as pull would inflate the pull side on leg days and
 *   counting it as legs would inflate legs on pull days. It sits with the core in `other`, which is
 *   the honest answer for a muscle that is genuinely trained by all three.
 *
 * `other` is therefore a real bucket rather than a fallback for a name nobody mapped — and
 * `muscles.test.ts` asserts that every name in the landmark table AND every name the exercise
 * catalogue actually uses resolves, so an unmapped muscle fails loudly instead of landing here.
 */
export type MovementPattern = 'push' | 'pull' | 'legs' | 'other'

const PATTERN_BY_MUSCLE: Record<string, MovementPattern> = {
  chest: 'push',
  shoulders: 'push',
  triceps: 'push',

  back: 'pull',
  lats: 'pull',
  'upper back': 'pull',
  biceps: 'pull',
  traps: 'pull',
  forearms: 'pull',

  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  adductors: 'legs',
  abductors: 'legs',
  'hip flexors': 'legs',

  abs: 'other',
  obliques: 'other',
  'lower back': 'other',
}

/** The pattern a muscle trains, folding synonyms first (`core` → `abs`, `pecs` → `chest`, …). */
export function movementPattern(muscle: string): MovementPattern {
  return PATTERN_BY_MUSCLE[normalizeMuscle(muscle)] ?? 'other'
}

/** Every muscle this module classifies, for a caller that needs the vocabulary rather than a lookup. */
export const CLASSIFIED_MUSCLES = Object.keys(PATTERN_BY_MUSCLE)
