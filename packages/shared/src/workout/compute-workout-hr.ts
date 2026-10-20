import type { WorkoutRepository } from '@/lib/data/repository'
import { analyseHrRecovery, type SetHrStats } from './hr-analysis'
import { summariseWorkoutHr, WORKOUT_HR_PAD_MS, type WorkoutHrSummary } from './hr-summary'
import { computeSetHrStats, type SetHrRow } from './set-hr-stats'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import { DEFAULT_TZ, dateStrMidnightInTz, shiftDateStr, toAestDay } from '@trainingai/shared/date-utils'
import { HRR60_BAR_WINDOW_DAYS, personalHrr60Bar, withHrr60Recovery } from './hrr60'
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

  const from = new Date(ws.startedAt.getTime() - WORKOUT_HR_PAD_MS)
  const to = new Date(ws.completedAt.getTime() + WORKOUT_HR_PAD_MS)

  // #2299 step 2: the rest bar is the person's own HRR60 over the 30 days before this session.
  const barFrom = dateStrMidnightInTz(shiftDateStr(toAestDay(ws.startedAt, tz), -HRR60_BAR_WINDOW_DAYS), tz)
  const [readings, sets, rrRows, richSets, baseline, recentSetHr] = await Promise.all([
    repo.getHrForWindow(userId, from, to),
    repo.getSetTimestampsForSession(userId, ws.id),
    repo.getRrForWindow(userId, ws.startedAt, ws.completedAt),
    repo.getSetDetailsForSession(userId, ws.id),
    resolveHrProfile(repo, userId, tz),
    repo.getSetHrStatsSince(userId, barFrom, 10_000),
  ])
  const hrr60BarBpm = personalHrr60Bar(recentSetHr
    .filter(r => r.hrr1Bpm != null && r.loggedAt != null && r.loggedAt < ws.startedAt)
    .map(r => r.hrr1Bpm as number))

  const stats = withHrr60Recovery(analyseHrRecovery(readings, sets.map(s => ({ ...s, loggedAt: s.loggedAt }))), readings, hrr60BarBpm)
  const setHrRows = computeSetHrStats(readings, richSets, baseline, { hrr60BarBpm })

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
    // With their times (#2488): beats either side of a set are not successive, and the adjacency
    // check is what stops a pair being formed across one.
    .map(r => ({ atMs: r.at.getTime(), rrMs: r.rrMs }))
  const workoutHrvMs = rmssdFromRr(restRr)

  return { readings, stats, setHrRows, workoutHrvMs, summary: summariseWorkoutHr(readings, stats, workoutHrvMs) }
}
