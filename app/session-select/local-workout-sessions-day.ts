import { getLocalStore } from '@/lib/local-store'
import { toAestDay, shiftDateStr, DEFAULT_TZ } from '@trainingai/shared/date-utils'

export interface DayWorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

/**
 * Today's workout sessions from the on-device store, for the Home heart-rate chart's overlay
 * (SYN-10): painted before the network revalidates. Empty when there is no store yet.
 *
 * `started_at` is a UTC instant, so a session started before 10:00 Brisbane carries yesterday's
 * UTC date (#3672). The SQL cutoff is widened by a day and the local day in `tz` decides, the same
 * as `lib/calendar/local-overlay.ts` does for this column.
 */
export async function readLocalWorkoutSessionsDay(
  userId: string,
  today: string,
  tz: string = DEFAULT_TZ,
): Promise<DayWorkoutSession[]> {
  const store = getLocalStore(userId)
  if (!store) return []
  const sessions = await store.getWorkoutSessions(shiftDateStr(today, -1))
  return sessions
    .filter(s => !s.deletedAt && toAestDay(new Date(s.startedAt), tz) === today)
    .map(s => ({ sessionName: s.sessionName, startedAt: s.startedAt, completedAt: s.completedAt }))
}
