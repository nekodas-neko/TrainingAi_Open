/**
 * #3976 — the readiness verdict row, built in one place and kept in step with the day while unanswered.
 *
 * `GET /api/readiness-verdict` freezes a day's verdict (score, band, direction) at its first read.
 * Preview decides the question's wording again from the live score while it is unanswered (#3974),
 * so a row frozen at the first read could hold a score and direction the answer was not about. When
 * the day's readiness is rewritten, {@link refreshUnansweredReadinessVerdict} recomputes the row
 * from the new score with the same builder the first read uses ({@link buildReadinessVerdictRecord},
 * which calls `readinessVerdictForDay`), and updates it only while `response_state = 'none'`. An
 * answered or dismissed row keeps what it answered; a day with no row is left to the first read.
 *
 * Reached from the data layer's re-score path (`rescore-nights.ts`), so it imports types only from
 * `@/lib/data` (`data-layer-readiness-cycle.test.ts`). Not a scoring change: it reads stored scores
 * and writes nothing but `readiness_verdicts`.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import type { ReadinessVerdictRecord } from '@trainingai/shared/types'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import {
  readinessVerdictForDay,
  readinessModelVersionOf,
  toReadinessVerdictDays,
} from '@trainingai/shared/health/readiness-verdict'

/**
 * How much history to read for the band (#2105).
 *
 * The band is the last `READINESS_VERDICT_BASELINE_DAYS` days that carry a stored score, and a day
 * has one only if the readiness route ran that day, so days go missing. 120 days mirrors the sleep
 * verdict's lookback and stays one indexed range read.
 */
export const READINESS_VERDICT_HISTORY_DAYS = 120

type VerdictRecord = Omit<ReadinessVerdictRecord, 'responseState'>

/** Why no record could be built: no usable stored score for the day, or the baseline is short. */
export type ReadinessVerdictBuild =
  | { kind: 'record'; record: VerdictRecord }
  | { kind: 'no-score' }
  | { kind: 'below-floor' }

/**
 * The verdict row for `date`, from the stored derived rows (history and the day itself). The one
 * builder both the first read and the refresh use, so the two cannot store a day differently.
 *
 * `no-score` covers a day with no stored score, or a row with no contributors or no model stamp:
 * without them the snapshot could not say what produced the score, which is the one thing it exists
 * to say.
 */
export function buildReadinessVerdictRecord(
  date: string,
  rows: readonly { day: string; readinessScore: number | null; modelVersions: unknown; readinessContributors?: unknown }[],
): ReadinessVerdictBuild {
  const targetRow = rows.find(r => r.day === date)
  const contributors = targetRow?.readinessContributors
  const readinessModelVersion = readinessModelVersionOf(targetRow?.modelVersions)
  if (
    targetRow?.readinessScore == null ||
    contributors == null || typeof contributors !== 'object' || Array.isArray(contributors) ||
    readinessModelVersion === null
  ) {
    return { kind: 'no-score' }
  }
  const computed = readinessVerdictForDay(
    { date, score: targetRow.readinessScore, modelVersion: readinessModelVersion },
    toReadinessVerdictDays(rows),
  )
  if (!computed) return { kind: 'below-floor' }
  return {
    kind: 'record',
    record: {
      date,
      verdict: computed.verdict,
      score: computed.score,
      band: computed.band,
      baselineDays: computed.baselineDays,
      baselineSameVersionDays: computed.baselineSameVersionDays,
      contributors: contributors as Record<string, unknown>,
      readinessModelVersion,
      modelVersion: computed.modelVersion,
    },
  }
}

type RefreshRepo = Pick<WorkoutRepository, 'getReadinessVerdict' | 'getOuraDailyDerived' | 'refreshUnansweredReadinessVerdict'>

/**
 * What a refresh did. `no-row`: nothing was asked that day. `answered`: the row was answered or
 * dismissed (before the read, or between the read and the write), so it keeps what it answered.
 * `kept`: the recompute matched the row, or could not be made (no usable score, short baseline), so
 * the row was left as it was. `updated`: the row now holds the day's current score and verdict.
 * `failed`: a database fault, logged; the readiness write that called this is unaffected.
 */
export type ReadinessVerdictRefresh = 'no-row' | 'answered' | 'kept' | 'updated' | 'failed'

function sameVerdict(a: VerdictRecord, b: VerdictRecord): boolean {
  return a.verdict === b.verdict && a.score === b.score &&
    a.band.median === b.band.median && a.band.low === b.band.low && a.band.high === b.band.high &&
    a.baselineDays === b.baselineDays && a.baselineSameVersionDays === b.baselineSameVersionDays &&
    a.readinessModelVersion === b.readinessModelVersion && a.modelVersion === b.modelVersion &&
    JSON.stringify(a.contributors) === JSON.stringify(b.contributors)
}

/**
 * After `date`'s readiness was rewritten: recompute an unanswered verdict row from the new score.
 * Never throws; a fault is logged and reported as `failed`, so the score write it follows stands.
 */
export async function refreshUnansweredReadinessVerdict(
  repo: RefreshRepo, userId: string, date: string,
): Promise<ReadinessVerdictRefresh> {
  try {
    const stored = await repo.getReadinessVerdict(userId, date)
    if (!stored) return 'no-row'
    if (stored.responseState !== 'none') return 'answered'
    const rows = await repo.getOuraDailyDerived(userId, shiftDateStr(date, -READINESS_VERDICT_HISTORY_DAYS), date)
    const built = buildReadinessVerdictRecord(date, rows)
    // A cleared score or a short baseline gives nothing honest to recompute from: the row keeps the
    // question that was asked rather than being judged against nothing.
    if (built.kind !== 'record') return 'kept'
    const { responseState: _ignored, ...current } = stored
    if (sameVerdict(current, built.record)) return 'kept'
    // Conditional on `response_state = 'none'` in the statement itself, so an answer recorded
    // between the read above and this write is never overwritten.
    const updated = await repo.refreshUnansweredReadinessVerdict(userId, built.record)
    return updated ? 'updated' : 'answered'
  } catch (err) {
    console.error(`[readiness-verdict] refreshing the unanswered verdict for ${date} failed (score kept):`, err)
    return 'failed'
  }
}
