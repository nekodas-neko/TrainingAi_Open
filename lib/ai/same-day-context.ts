import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * Q-291 — the day's AI surfaces could not see each other, so they contradicted each other.
 *
 * Observed in production on 2026-08-06: the morning readiness insight read a temperature 0.8 °C
 * above baseline and said *"Keep your planned exercise intensity low."* The user then trained
 * twice, and that evening the daily digest said *"Keep that same energy tomorrow!"* — encouraging a
 * repeat of exactly what the morning had advised against. Readiness fell 79 → 65 over the following
 * days, so the morning signal was arguably the correct one. Each surface built its own prompt from
 * its own slice of the data and none could see what another had already told the user that day.
 *
 * ## Why this is one-directional, and must stay that way
 *
 * Only LATER surfaces read EARLIER ones. The digest reads the health insights; the health insights
 * read nothing. That is not a simplification — it is what keeps the cache from oscillating.
 *
 * Each surface caches on a hash of its prompt context (`hashInsightContext`), and anything fed to
 * the model has to be inside that hash or the cache serves an insight generated from a context it
 * no longer matches. So if A's hash covered B's text *and* B's covered A's, regenerating either
 * would invalidate the other, whose new text would invalidate the first again — and because model
 * output is not deterministic, that does not settle. A read graph with a cycle in it is a
 * regeneration loop that bills per iteration.
 *
 * Adding a new reader is safe. Adding a new *edge* means checking the graph is still acyclic.
 */

/** Sections whose insight is worth showing another surface. Ordered for a stable prompt. */
const SHARED_SECTIONS = ['activity', 'heart-rate', 'readiness', 'sleep'] as const

type SameDayRepo = Pick<WorkoutRepository, 'listAiHealthInsightsForDate'>

/**
 * The day's already-written insights, formatted for a prompt — or `''` when there are none.
 *
 * The empty string is the important case: it must leave the caller's context byte-identical to what
 * it was before this existed, so a day with no prior insight does not regenerate a cached digest
 * for no reason.
 */
export async function readSameDayInsights(
  repo: SameDayRepo,
  userId: string,
  date: string,
): Promise<string> {
  const rows = await repo.listAiHealthInsightsForDate(userId, date)
  const shared = rows.filter(r => (SHARED_SECTIONS as readonly string[]).includes(r.section))
  if (shared.length === 0) return ''
  const body = shared.map(r => `- ${r.section}: ${r.insight.trim()}`).join('\n')
  return `Already told the user today:\n${body}`
}

/**
 * Instruction paired with the block above. Deliberately permits disagreement — the later surface
 * knows things the morning one did not, and forbidding contradiction outright would make it
 * endorse advice the day has since disproved. What it forbids is contradicting *silently*.
 */
export const SAME_DAY_GUIDANCE =
  'The lines under "Already told the user today" are what other parts of this app have said to ' +
  'this user today. Do not contradict them without saying so plainly — if the day has changed the ' +
  'picture, name what changed. Do not repeat their wording.'
