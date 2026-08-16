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
