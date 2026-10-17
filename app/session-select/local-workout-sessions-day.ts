import { getLocalStore } from '@/lib/local-store'

export interface DayWorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

/**
 * Today's workout sessions from the on-device store, for the Home heart-rate chart's overlay
 * (SYN-10): painted before the network revalidates. Empty when there is no store yet.
 */
export async function readLocalWorkoutSessionsDay(userId: string, today: string): Promise<DayWorkoutSession[]> {
  const store = getLocalStore(userId)
  if (!store) return []
  const sessions = await store.getWorkoutSessions(today)
  return sessions
    .filter(s => !s.deletedAt && s.startedAt.slice(0, 10) === today)
    .map(s => ({ sessionName: s.sessionName, startedAt: s.startedAt, completedAt: s.completedAt }))
}
