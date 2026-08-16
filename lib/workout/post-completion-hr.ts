import { getRepositoryAsync } from '@/lib/data'
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

  const computed = await computeWorkoutHr(repo, userId, ws, tz)
  const readings = computed?.readings.length ?? 0
  if (!computed || readings === 0) return { readings, attributed: false }

  await Promise.all([
    repo.upsertWorkoutHrStats(userId, ws.id, computed.summary),
    repo.upsertSetHrStats(userId, ws.id, computed.setHrRows),
  ])
  return { readings, attributed: true }
}
