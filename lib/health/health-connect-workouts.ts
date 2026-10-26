import type { HealthConnectActivityLogInput, WorkoutRepository } from '@/lib/data/repository'
import { activityImplausibleReason } from '@trainingai/shared/validation/plausibility'
import { daysBetweenDateStrs, normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { ingestDayRejection } from '@trainingai/shared/validation/ingest-clock'
import { SYNC_DAYS_COLD } from '@/lib/health-connect-sync'
import { HISTORY_WINDOW_DAYS } from '@/lib/health-connect-history-import'

/** A Health Connect exercise session as either app sends it. `recordId` is `metadata.id`; an older
 *  bundle of the current app sends none. */
export type IncomingHealthConnectWorkout = HealthConnectActivityLogInput & { recordId?: string }

type Repo = Pick<WorkoutRepository,
  'listActivityLogs' | 'listActivityTypes' | 'saveActivityLog' | 'upsertHealthConnectActivityLog'>

const FALLBACK_ACTIVITY_TYPE = 'other'
/** The bound `/api/sync-health`'s schema puts on `durationMin`, applied to Preview's sessions too:
 *  a Health Connect record may span a week, and no session does. */
const MAX_SESSION_MIN = 1_440

/**
 * Stores Health Connect exercise sessions, for `/api/sync-health` (the current app) and
 * `/api/health-connect/sync` (Preview) alike (#3044, #2843).
 *
 * - **With a record id** the row is keyed on it (`upsertHealthConnectActivityLog`), so an edit in
 *   Health Connect updates the row rather than adding one at its new start time.
 * - **Without one** (an older bundle) the old rule stands: a session whose `date|HH:MM` is already
 *   stored is skipped, and anything else is saved first-write-wins.
 *
 * A reason for every session not stored goes into `rejected`; one bad session never costs the rest.
 * Returns how many swept sessions came back (#3309), for the route to report.
 */
export async function storeHealthConnectWorkouts(
  repo: Repo, userId: string, sessions: readonly IncomingHealthConnectWorkout[], rejected: string[],
): Promise<{ revived: number }> {
  let revived = 0
  if (!sessions.length) return { revived }

  // Q-25: `activity_type` is a FK. The client maps Health Connect's exercise types to our slugs
  // and falls back to 'other', but that mapping is a *client-side* table — it drifts the moment
  // a type is renamed or deleted here, and an unknown slug threw out of the route, losing the
  // whole flush including the records that were fine. Resolved server-side against the real
  // table instead: an unrecognised type degrades to 'other' rather than dropping a real session,
  // and only degrades to a skip if 'other' itself is missing.
  const knownTypes = new Set((await repo.listActivityTypes()).map(t => t.id))

  // The `date|HH:MM` rule, for sessions sent without an id. Callers have already dropped unusable
  // dates, because the range query is keyed on the first and last one.
  const legacy = sessions.filter(s => !s.recordId)
  let existingKeys = new Set<string>()
  if (legacy.length) {
    const dates = [...new Set(legacy.map(s => s.date))].sort()
    const existing = await repo.listActivityLogs(userId, dates[0], dates[dates.length - 1])
    existingKeys = new Set(existing.map(s => `${s.date}|${s.startTime}`))
  }

  for (const s of sessions) {
    if (!s.recordId && existingKeys.has(`${s.date}|${s.startTime}`)) continue
    const reason = s.durationMin > MAX_SESSION_MIN
      ? `durationMin ${s.durationMin} is longer than a day`
      : activityImplausibleReason(s)
    if (reason) { rejected.push(`exercise ${s.date} ${s.startTime}: ${reason}`); continue }
    let activityType = s.activityType
    if (!knownTypes.has(activityType)) {
      if (!knownTypes.has(FALLBACK_ACTIVITY_TYPE)) {
        rejected.push(`exercise ${s.date} ${s.startTime}: unknown activityType "${activityType}"`)
        continue
      }
      rejected.push(`exercise ${s.date} ${s.startTime}: unknown activityType "${activityType}", stored as "${FALLBACK_ACTIVITY_TYPE}"`)
      activityType = FALLBACK_ACTIVITY_TYPE
    }
    const log: HealthConnectActivityLogInput = {
      date: s.date, activityType, title: s.title,
      startTime: s.startTime, endTime: s.endTime,
      durationMin: s.durationMin, distanceKm: s.distanceKm,
      caloriesBurned: s.caloriesBurned, avgHr: s.avgHr, maxHr: s.maxHr,
    }
    if (s.recordId) {
      const outcome = await repo.upsertHealthConnectActivityLog(userId, s.recordId, log)
      if (outcome === 'taken') rejected.push(`exercise ${s.date} ${s.startTime}: another session already holds this start time`)
      if (outcome === 'revived') revived++
    } else await repo.saveActivityLog(userId, log)
  }
  return { revived }
}

/** The widest window a client can ask to sweep: a cold sync, or one history-import window. */
export const MAX_SWEEP_DAYS = Math.max(SYNC_DAYS_COLD, HISTORY_WINDOW_DAYS) + 1

/**
 * The local days a deletion sweep may cover, or a reason it may not (#3044). The current app reads
 * a window of whole local days and gets no deletion feed, so a stored session dated inside that
 * window whose id did not come back has been deleted in Health Connect. Bounded, so a broken client
 * cannot sweep years of history with one request.
 */
export function sweepWindow(
  window: { from: string; to: string }, today: string,
): { from: string; to: string } | { reason: string } {
  const from = normalizeDateParamIso(window.from)
  const to = normalizeDateParamIso(window.to)
  if (!from || !to) return { reason: 'not a real calendar date' }
  const late = ingestDayRejection(to, today)
  if (late) return { reason: late }
  const span = daysBetweenDateStrs(from, to) + 1
  if (span < 1) return { reason: 'from is after to' }
  if (span > MAX_SWEEP_DAYS) return { reason: `spans ${span} days, more than ${MAX_SWEEP_DAYS}` }
  return { from, to }
}
