/**
 * #3872 — readiness scored when a night arrives, not only when the app reads it.
 *
 * Until this, a day's readiness was stored only by the readiness read (`buildReadinessPayload`), and
 * only on a read of that same local day made after its night had landed. A night that arrived after
 * the day's last read, after local midnight, or on a day the app was never opened left the day with
 * no score at all (8 of 34 days after the Oura API switch, 7 of them with a full night).
 *
 * `rescoreChangedNights` calls the two functions here for a day whose night changed:
 *
 * - **Today:** the readiness read itself, `buildReadinessPayload`. It persists under its own rule
 *   (only when the newest night is today's, #3079), so this is the same score, the same patch and the
 *   same gate a read would have written. Nothing is restated.
 * - **A finished day with no stored score:** the read cannot score a past day (it is built around
 *   "today": today's HR window, yesterday's finished activity, the current phase). The per-day
 *   scorer is `buildDayAudit`, the one the admin backfill (`app/api/admin/backfill-derived-scores`)
 *   writes with, which calls the same `computeReadinessComposite` and illness radar on that day's
 *   inputs. {@link readinessPatchFromAudit} is the one patch both write.
 *
 * Both load their modules lazily: `readiness-payload` reaches `@/lib/data`, and the Postgres adapter
 * imports `rescore-nights`, so a static import here would be a module cycle.
 */
import type { OuraDailyDerivedPatch } from '@/lib/data/repository'
import type { PillarAudit } from '@trainingai/shared/health/score-audit/types'
import { READINESS_MODEL_VERSION } from '@trainingai/shared/health/readiness-composite'

type ReadinessPersist = NonNullable<PillarAudit['persist']>

/**
 * The `oura_daily_derived` patch for a readiness score recomputed by `buildDayAudit`. Shared by the
 * admin backfill and the late-night path so the two can never store a recomputed day differently.
 */
export function readinessPatchFromAudit(persist: ReadinessPersist): OuraDailyDerivedPatch {
  return {
    readinessScore: persist.score,
    readinessContributors: persist.contributors,
    // #3086: the served score's explanation, as the live route stores it.
    illnessFlag: persist.illnessFlag,
    illnessScore: persist.illnessScore,
    illnessBiomarkers: persist.illnessBiomarkers,
    readinessSource: persist.readinessSource ?? 'ble-derived',
    // Q-273: a recomputed score carries its model stamp like a live one, so a later model change
    // leaves a readable step in the trend.
    modelVersions: { readiness: READINESS_MODEL_VERSION },
  }
}

/**
 * Runs the readiness read for today, which persists today's readiness when today's night exists and
 * writes nothing for readiness otherwise. The caller reads the row back to see which. Throws on
 * failure; the caller logs it.
 */
export async function scoreTodayReadiness(userId: string, tz: string): Promise<void> {
  const { buildReadinessPayload } = await import('@/lib/health/readiness-payload')
  await buildReadinessPayload(userId, tz)
}

/**
 * Scores and stores readiness for a finished `day` that has none. False when the day has no
 * scoreable night of its own. Throws on failure; the caller logs it.
 */
export async function scoreFinishedDayReadiness(userId: string, day: string, tz: string): Promise<boolean> {
  const [{ getRepository }, { buildDayAudit }] = await Promise.all([
    import('@/lib/data'),
    import('@trainingai/shared/health/score-audit/build-day-audit'),
  ])
  const repo = await getRepository()
  const audit = await buildDayAudit({ repo, userId, date: day, tz })
  const persist = audit.pillars.find(p => p.pillar === 'readiness')?.persist
  if (!persist) return false
  await repo.upsertOuraDailyDerived(userId, day, readinessPatchFromAudit(persist))
  return true
}
