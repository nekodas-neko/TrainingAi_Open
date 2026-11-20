/**
 * #3872 — today's readiness scored when a night arrives, injected into `rescore-nights.ts`.
 *
 * The readiness read (`buildReadinessPayload`) reaches `@/lib/data`, and the data layer reaches
 * `rescore-nights.ts` (the adapter's `partial_night` outbox op). So `rescore-nights` takes the read as
 * a dependency, and only callers outside the data layer import this module: the Oura webhook, the
 * daily reconcile, the connect backfill and the partial-night route. Nothing reachable from
 * `lib/data/index.ts` may import it (`data-layer-readiness-cycle.test.ts`).
 */
import { buildReadinessPayload } from '@/lib/health/readiness-payload'
import type { NightRescoreRepo, ScoringNightRescore, TodayReadinessScorer } from '@/lib/health/rescore-nights'

/**
 * Runs the readiness read for today, which persists today's readiness when today's night exists and
 * writes nothing for readiness otherwise. The caller reads the row back to see which. Throws on
 * failure; the caller logs it.
 */
export const scoreTodayReadiness: TodayReadinessScorer = async (userId, tz) => {
  await buildReadinessPayload(userId, tz)
}

/** A re-score target that scores today's readiness inline. */
export function rescoreWithTodayReadiness(repo: NightRescoreRepo): ScoringNightRescore {
  return { repo, scoreToday: scoreTodayReadiness }
}
