import { labelFor } from '@trainingai/shared/health/contributor-labels'
import { rankedContributors, weakestContributor } from '@trainingai/shared/health/contributor-ranking'

// The label map and the ranking moved to the shared package so the native app words contributors
// the same way (#2935); re-exported so existing callers keep their import.
export { labelFor, weakestContributor }

// "HRV balance 82/100, Resting heart rate 90/100, …" — sorted worst-first so the
// reader sees the weak spots without parsing nested JSON.
export function formatContributors(contributors: unknown): string {
  const entries = rankedContributors(contributors)
  if (entries.length === 0) return 'no contributor data'
  return entries.map(([k, v]) => `${labelFor(k)} ${v}/100`).join(', ')
}
