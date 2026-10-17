// Which readiness/sleep/activity contributor is weakest. Shared by the web insight text and the
// native contributor card so both name the same one (#2935).

import { labelFor } from './contributor-labels'

/**
 * A contributor value as it is actually stored, which is TWO shapes.
 *
 * `oura_daily.readiness_contributors` holds `{ hrv_balance: 90 }` — Oura's own numbers. But
 * `oura_daily_derived.readiness_contributors`, which the app writes and which every reader
 * PREFERS when it exists, holds `{ hrvBalance: { score, input, gap, provisional } }` (the
 * `ReadinessContributor` of `readiness-composite.ts`).
 *
 * Reading only the first shape is not a type error anywhere, because the route casting these rows
 * asserted `Record<string, number | null>` — so the second shape stringified to `[object Object]`
 * and every readiness insight was built on `checkin [object Object]/100`. Found 2026-09-26 by
 * running the route rather than by reading it (RV-201).
 */
type ContributorValue = number | { score?: number | null } | null | undefined

function scoreOf(v: ContributorValue): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const score = (v as { score?: unknown }).score
  return typeof score === 'number' && Number.isFinite(score) ? score : null
}

/**
 * Measured contributors, worst first. The ordering is the point — see `formatContributors`.
 *
 * Takes `unknown` because that is what the caller has: the repository types these JSONB columns
 * as `{}`, and the previous signature's `Record<string, number | null>` was only ever true of one
 * of the two stored shapes. A cast to make it compile is exactly what hid the bug.
 */
export function rankedContributors(contributors: unknown): [string, number][] {
  if (contributors == null || typeof contributors !== 'object' || Array.isArray(contributors)) return []
  return Object.entries(contributors as Record<string, ContributorValue>)
    .map(([k, v]) => [k, scoreOf(v)] as const)
    .filter((e): e is readonly [string, number] => e[1] != null)
    .map(e => [e[0], e[1]] as [string, number])
    .sort((a, b) => a[1] - b[1])
}

/**
 * The lowest-scoring contributor, or null when none was measured. Shares `rankedContributors`
 * with the formatter deliberately: "worst first" is asserted in one place, so a change to the
 * ordering cannot leave the sentence naming a different contributor from the list beside it.
 */
export function weakestContributor(contributors: unknown): { label: string; value: number } | null {
  const [worst] = rankedContributors(contributors)
  return worst ? { label: labelFor(worst[0]), value: worst[1] } : null
}
