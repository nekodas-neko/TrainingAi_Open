import { normalizeMuscle } from '@trainingai/shared/muscles'

// The single lower-body muscle set (One Place). Stored as canonical names — callers
// normalize first via normalizeMuscle so synonyms (quadriceps→quads, hamstring→hamstrings)
// resolve. Used by the recovery gate to detect a recent heavy leg session (concurrent-
// training interference — see plan design note 3).
export const LOWER_BODY_MUSCLES: ReadonlySet<string> = new Set([
  'quads', 'hamstrings', 'glutes', 'calves', 'legs', 'adductors', 'abductors', 'hip flexors',
])

export function isLowerBodyMuscle(raw: string): boolean {
  return LOWER_BODY_MUSCLES.has(normalizeMuscle(raw))
}
