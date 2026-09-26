// Oura contributor keys → human labels. Keys per the Oura v2 API docs
// (daily_readiness / daily_sleep / daily_activity contributors).
const CONTRIBUTOR_LABELS: Record<string, string> = {
  activity_balance: 'Activity balance',
  body_temperature: 'Body temperature',
  hrv_balance: 'HRV balance',
  previous_day_activity: 'Previous day activity',
  previous_night: 'Previous night',
  recovery_index: 'Recovery index',
  resting_heart_rate: 'Resting heart rate',
  sleep_balance: 'Sleep balance',
  deep_sleep: 'Deep sleep',
  efficiency: 'Efficiency',
  latency: 'Latency',
  rem_sleep: 'REM sleep',
  restfulness: 'Restfulness',
  timing: 'Timing',
  total_sleep: 'Total sleep',
  meet_daily_targets: 'Meet daily targets',
  move_every_hour: 'Move every hour',
  recovery_time: 'Recovery time',
  stay_active: 'Stay active',
  training_frequency: 'Training frequency',
  training_volume: 'Training volume',
  // The app's OWN readiness composite (`READINESS_WEIGHTS`, readiness-composite.ts). Six of its
  // nine keys are the Oura names in camelCase and resolve through `labelFor`'s fallback; these
  // three do not, and rendered as raw keys until RV-201: `checkin` has no Oura equivalent at all,
  // and the other two were renamed. Keep this list in step with `READINESS_WEIGHTS`.
  checkin: 'Morning check-in',
  temperature: 'Body temperature',
  prevDayActivity: 'Previous day activity',
  // Activity Score v2 (own components, 2026-07-22) — camelCase, distinct from the Oura keys above.
  steps: 'Steps',
  activeEnergy: 'Active energy',
  zoneMinutes: 'Zone minutes',
  moveHours: 'Move every hour',
  strengthFreq: 'Training frequency (7d)',
  strengthVolume: 'Training volume (7d)',
}

/** `hrvBalance` → `hrv_balance`. Not applied to a key the map already holds. */
const snakeCase = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/**
 * The human label for a contributor key, matching either casing.
 *
 * The map is keyed in Oura's snake_case, and the app's OWN derived row writes the same
 * contributors in camelCase — so `hrvBalance` fell through to the raw key and the readiness
 * insight read "hrvBalance 25/100" (RV-201, found 2026-09-26 alongside the `[object Object]`
 * half of the same defect). An exact hit still wins, so the Activity Score v2 keys below, which
 * are deliberately camelCase and listed as such, are unaffected.
 */
export function labelFor(key: string): string {
  return CONTRIBUTOR_LABELS[key] ?? CONTRIBUTOR_LABELS[snakeCase(key)] ?? key.replace(/_/g, ' ')
}

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
function rankedContributors(contributors: unknown): [string, number][] {
  if (contributors == null || typeof contributors !== 'object' || Array.isArray(contributors)) return []
  return Object.entries(contributors as Record<string, ContributorValue>)
    .map(([k, v]) => [k, scoreOf(v)] as const)
    .filter((e): e is readonly [string, number] => e[1] != null)
    .map(e => [e[0], e[1]] as [string, number])
    .sort((a, b) => a[1] - b[1])
}

// "HRV balance 82/100, Resting heart rate 90/100, …" — sorted worst-first so the
// reader sees the weak spots without parsing nested JSON.
export function formatContributors(contributors: unknown): string {
  const entries = rankedContributors(contributors)
  if (entries.length === 0) return 'no contributor data'
  return entries.map(([k, v]) => `${labelFor(k)} ${v}/100`).join(', ')
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
