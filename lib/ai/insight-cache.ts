import { createHash } from 'node:crypto'
import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * Q-293: `ai_health_insights.context_hash` existed on the shared table and was written by exactly
 * one section of fourteen. Migration 121 added it for NUT-7 — a daily digest generated at lunch
 * reported lunch totals all evening — and every other section had, and still has, the same defect:
 * the cache is keyed by `(user, section, date)` and served unconditionally for the whole day, so an
 * insight written before the ring syncs is the one the user reads afterwards.
 *
 * The context is the deterministic text each route already assembles for its prompt. Hashing it
 * costs the repo reads that build it — cheap next to the model call the hash avoids, and the trade
 * daily-digest already accepted.
 */
export const hashInsightContext = (context: string): string =>
  createHash('sha256').update(context).digest('hex')

type InsightRepo = Pick<WorkoutRepository, 'getAiHealthInsightWithHash'>

/**
 * The cached insight, but only when it was generated from this exact context.
 *
 * A row written before its route started hashing carries NULL, and that counts as a MISS: it is
 * precisely a row we cannot vouch for. The cost is one regeneration per section per day, once.
 */
export async function readFreshInsight(
  repo: InsightRepo,
  userId: string,
  section: string,
  date: string,
  contextHash: string,
): Promise<string | null> {
  const cached = await repo.getAiHealthInsightWithHash(userId, section, date)
  if (!cached || cached.contextHash !== contextHash) return null
  return cached.insight
}
