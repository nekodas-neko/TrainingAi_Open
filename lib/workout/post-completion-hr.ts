import { getRepositoryAsync } from '@/lib/data'
import type { WorkoutRepository } from '@/lib/data/repository'
import { computeWorkoutHr } from '@trainingai/shared/workout/compute-workout-hr'

// Everything the app does with heart rate the moment a workout is completed: attribute what is
// already ingested to the workout and its individual sets.
//
// It used to pull an Oura *Cloud* window first. That call was removed 2026-08-13 (owner: "get rid of
// oura cloud references we dont use it"). It could not succeed: the ring has been on our own BLE key
// since the 2026-07-07 re-key, so the stored Cloud credential is dead and every workout completion
// spent a request earning a 401 and a log line. HR now comes from the BLE pipeline, which has already
// written `oura_heartrate` by the time attribution runs — the same rows this pass always read.
//
// One function so the three completion paths cannot drift (the web route, the outbox's
// complete_workout branch, and any future caller) — the same rule that made
// logExerciseFromPayload shared. It also replaces the server-to-self POST /api/oura/hr-sync
// the route used to make, which burned a second request worker and a second pool connection
// per completion and failed outright ("fetch failed") 9 times in production.
//
// Best-effort by design: the ring drains its buffer minutes-to-hours later, so this pass often has
// nothing to work with yet. listSessionsMissingSetHrStats / listSessionsMissingHrStats are
// coverage-aware, so the admin backfill still catches what this pass cannot (Q-11 Defect B).
export async function syncAndAttributeSessionHr(
  userId: string,
  workoutSessionId: string,
  tz?: string,
): Promise<{ readings: number; attributed: boolean }> {
  const repo = await getRepositoryAsync()
  const ws = await repo.getWorkoutSessionById(userId, workoutSessionId)
  if (!ws || !ws.completedAt) return { readings: 0, attributed: false }
  return attributeSessionHr(repo, userId, ws, tz)
}

async function attributeSessionHr(
  repo: WorkoutRepository,
  userId: string,
  ws: { id: string; startedAt: Date; completedAt: Date | null },
  tz?: string,
): Promise<{ readings: number; attributed: boolean }> {
  const computed = await computeWorkoutHr(repo, userId, ws, tz)
  const readings = computed?.readings.length ?? 0
  if (!computed || readings === 0) return { readings, attributed: false }

  await Promise.all([
    repo.upsertWorkoutHrStats(userId, ws.id, computed.summary),
    repo.upsertSetHrStats(userId, ws.id, computed.setHrRows),
  ])
  return { readings, attributed: true }
}

/** The most sessions one heart-rate write re-attributes. One write spans at most a week (the
 *  catch-up's `HEART_RATE_LOOKBACK_MS`, the backfill's 7-day heart-rate chunk), which holds far fewer. */
export const REATTRIBUTE_MAX_SESSIONS = 50

/**
 * Re-attributes every completed workout whose heart-rate window overlaps `[from, to]`, after heart
 * rate for that span has been written (#3078). The Oura Cloud feed uploads in batches, often hours
 * after the workout was completed, so the completion-time pass above saw a thin series or none, and
 * nothing refreshed it unless the recap was opened. Idempotent: both upserts keep the fuller compute
 * (`readings_count >=`), so a session whose series did not grow is rewritten with the same values.
 *
 * Oldest first, because a session's HRR rest bar reads the `hrr1` of the sessions before it. One
 * session failing does not stop the rest; when any failed, it throws once at the end, naming how
 * many, so the caller reports it. Returns how many sessions were attributed.
 */
export async function reattributeWorkoutsHrInWindow(
  repo: WorkoutRepository,
  userId: string,
  from: Date,
  to: Date,
  tz?: string,
): Promise<number> {
  const sessions = await repo.listCompletedSessionsOverlapping(userId, from, to, REATTRIBUTE_MAX_SESSIONS)
  let attributed = 0
  const failures: string[] = []
  for (const ws of sessions) {
    try {
      if ((await attributeSessionHr(repo, userId, ws, tz)).attributed) attributed++
    } catch (err) {
      failures.push(err instanceof Error ? err.message : 'unknown')
    }
  }
  if (failures.length > 0) {
    throw new Error(`re-attributing workout HR: ${failures.length} of ${sessions.length} sessions failed (first: ${failures[0]})`)
  }
  return attributed
}

/** `reattributeWorkoutsHrInWindow` bound to a repository: the `workoutHr` every Oura Cloud heart-rate
 *  writer takes (webhook catch-up, connect backfill, daily reconciliation, the agent backfill job). */
export function workoutHrReattributor(repo: WorkoutRepository) {
  return (userId: string, from: Date, to: Date, tz: string) => reattributeWorkoutsHrInWindow(repo, userId, from, to, tz)
}
