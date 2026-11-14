import type { WorkoutRepository } from '@/lib/data/repository'
import { daysBetweenDateStrs, normalizeDateParamIso, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { rescoreHeartHealth, type HeartHealthDay, type HeartHealthRescoreChange } from '@/lib/health/heart-health-service'

/** Hard ceiling per call. A longer history is re-scored by paging through several calls. */
export const HEART_HEALTH_RESCORE_MAX_DAYS = 31

export type HeartHealthRescoreReport = {
  from: string
  to: string
  requestedTo: string
  timezone: string
  dryRun: boolean
  generatedAt: string
  summary: {
    daysExamined: number
    wouldComplete: number
    written: number
    alreadyCompleted: number
    pendingNotMet: number
    skippedThatMet: number
    noHeartRate: number
  }
  changes: HeartHealthRescoreChange[]
  days: {
    date: string
    status: HeartHealthDay['status']
    targetMin: number | null
    countedMin: number
    met: boolean
    /** What a write does to this day: `complete` only for a pending day the rule says is met. */
    wouldComplete: boolean
    activities: { title: string | null; activityType: string | null; durationMin: number | null; effortMin: number | null }[]
  }[]
}

/**
 * The re-score with its range checks and report, shared by `POST /api/admin/backfill-heart-health`
 * and the agent key's `rescore-heart-health` job (#3801), so both say the same thing about the same
 * days. Today is left to the device, which records it as the minutes arrive: the range ends
 * yesterday at the latest.
 */
export async function heartHealthRescoreReport(
  repo: WorkoutRepository, userId: string, tz: string, fromParam: string, toParam: string, dryRun: boolean,
): Promise<{ ok: true; report: HeartHealthRescoreReport } | { ok: false; error: string }> {
  const start = normalizeDateParamIso(fromParam)
  const end = normalizeDateParamIso(toParam)
  if (!start || !end) return { ok: false, error: 'Expected from and to as YYYY-MM-DD or YYYY/MM/DD' }
  if (end < start) return { ok: false, error: '`to` must not precede `from`' }
  const span = daysBetweenDateStrs(start, end) + 1
  if (span > HEART_HEALTH_RESCORE_MAX_DAYS) {
    return { ok: false, error: `Range too wide — ${span} days requested, ${HEART_HEALTH_RESCORE_MAX_DAYS} is the maximum` }
  }
  const yesterday = shiftDateStr(todayInTz(tz), -1)
  const last = end > yesterday ? yesterday : end
  const result = start > last
    ? { days: [], changes: [], written: 0 }
    : await rescoreHeartHealth(repo, userId, tz, start, last, { write: !dryRun })
  const count = (pred: (d: HeartHealthDay) => boolean) => result.days.filter(pred).length
  const completing = new Set(result.changes.map((c) => c.runId))
  return {
    ok: true,
    report: {
      from: start,
      to: last,
      requestedTo: end,
      timezone: tz,
      dryRun,
      generatedAt: new Date().toISOString(),
      summary: {
        daysExamined: result.days.length,
        // The headline the PR and the owner check against: how many past days move.
        wouldComplete: result.changes.length,
        written: result.written,
        alreadyCompleted: count((d) => d.status === 'completed'),
        pendingNotMet: count((d) => d.status === 'pending' && !d.met),
        // Reported, never written: a skip was the user's choice.
        skippedThatMet: count((d) => d.status === 'skipped' && d.met),
        noHeartRate: count((d) => d.activities.length > 0 && d.activities.every((a) => a.effortMin == null)),
      },
      changes: result.changes,
      days: result.days.map((d) => ({
        date: d.date,
        status: d.status,
        targetMin: d.targetMin,
        countedMin: d.countedMin,
        met: d.met,
        wouldComplete: completing.has(d.runId),
        activities: d.activities.map((a) => ({ title: a.title, activityType: a.activityType, durationMin: a.durationMin, effortMin: a.effortMin })),
      })),
    },
  }
}
