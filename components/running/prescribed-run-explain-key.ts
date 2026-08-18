import type { RunType } from '@trainingai/shared/running/types'

/**
 * The cache key for a prescribed run's AI restatement (Q-469).
 *
 * A separate `.ts` module rather than an export from the card: the unit project runs in `node` and
 * cannot parse JSX, so anything exported from a `.tsx` is untestable here.
 *
 * Pure so the property that matters can be asserted — the key changes **exactly when the sentence
 * should**. It carries the local date plus every input the route is given (type, duration, the
 * deterministic rationale, the gate reasons), so a stale answer cannot outlive the prescription it
 * describes, and an unchanged prescription cannot produce a second call.
 *
 * The date comes from `todayInTz()` at the call site, never a UTC slice: this is a *day's* run, and
 * a UTC date rolls over ten hours early for this user.
 */
export function runningPlanExplainCacheKey(
  { date, type, durationMin, gateKey, rationale }:
  { date: string; type: RunType; durationMin: number | null; gateKey: string; rationale: string },
): string {
  return `running-plan-explain:${date}:${type}:${durationMin ?? ''}:${gateKey}:${rationale}`
}
