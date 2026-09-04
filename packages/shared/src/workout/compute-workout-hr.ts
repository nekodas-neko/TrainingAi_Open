import type { WorkoutRepository } from '@/lib/data/repository'
import { analyseHrRecovery, type SetHrStats } from './hr-analysis'
import { summariseWorkoutHr, type WorkoutHrSummary } from './hr-summary'
import { computeSetHrStats, type SetHrRow } from './set-hr-stats'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { rmssdFromRr } from '@trainingai/shared/health/rmssd'

export interface WorkoutHrComputed {
  readings: { timestamp: Date; bpm: number; source: string | null }[]
  stats: SetHrStats[]
  /** Durable per-set HR rows (migration 139) — persisted so per-exercise HR trends survive the prune. */
  setHrRows: SetHrRow[]
  workoutHrvMs: number | null
  summary: WorkoutHrSummary
}

/** Compute a completed workout's HR readings, per-set recovery stats, rest-window HRV, and the
 *  durable summary — the single source of the numbers the recap shows and Lever W persists. Shared
 *  by the done-screen route and the admin backfill so they can never drift.
 *  Returns `null` for a session with no completion time (nothing to compute over). */
export async function computeWorkoutHr(
  repo: WorkoutRepository,
  userId: string,
  ws: { id: string; startedAt: Date; completedAt: Date | null },
  tz: string = DEFAULT_TZ,
): Promise<WorkoutHrComputed | null> {
  if (!ws.completedAt) return null

  const from = new Date(ws.startedAt.getTime() - 10 * 60 * 1000)
  const to = new Date(ws.completedAt.getTime() + 10 * 60 * 1000)

  const [readings, sets, rrRows, richSets, baseline] = await Promise.all([
    repo.getHrForWindow(userId, from, to),
    repo.getSetTimestampsForSession(userId, ws.id),
    repo.getRrForWindow(userId, ws.startedAt, ws.completedAt),
    repo.getSetDetailsForSession(userId, ws.id),
    resolveHrProfile(repo, userId, tz),
  ])

  const stats = analyseHrRecovery(readings, sets.map(s => ({ ...s, loggedAt: s.loggedAt })))
  const setHrRows = computeSetHrStats(readings, richSets, baseline)

  // Rest-window HRV: beats OUTSIDE every working-set interval — RR under load is dominated by
  // mechanics, not autonomic tone. Null without strap RR data.
  const setWindows = sets
    .filter(s => s.setStartMs != null && s.setEndMs != null)
    .map(s => ({ from: s.setStartMs!, to: s.setEndMs! }))
  const restRr = rrRows
    .filter(r => !setWindows.some(w => {
      const t = r.at.getTime()
      return t >= w.from && t <= w.to
    }))
    .map(r => r.rrMs)
  const workoutHrvMs = rmssdFromRr(restRr)

  return { readings, stats, setHrRows, workoutHrvMs, summary: summariseWorkoutHr(readings, stats, workoutHrvMs) }
}
