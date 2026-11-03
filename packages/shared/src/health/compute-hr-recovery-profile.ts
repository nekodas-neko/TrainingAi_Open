// Shared HR Recovery Profile compute path (HRP-3, plan 2026-07-22-hr-recovery-profile.md) — fetches
// both episode sources, detects workout-cooldown episodes, and produces the current-snapshot bands
// plus the month-over-month trend. One function so /api/health/hr-recovery-profile and the
// getHrRecoveryProfile AI-chat tool can never drift (mirrors computeWorkoutHr's shared-compute
// pattern — the one path the recap route and admin backfill both call).
import type { WorkoutRepository } from '@/lib/data/repository'
import { DEFAULT_TZ, dateStrMidnightInTz, shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { resolveHrProfile } from './hr-profile'
import { aggregateHrRecoveryProfile, episodeFromSetHrStats, type RecoveryEpisode, type HrRecoveryProfile } from './hr-recovery-profile'
import { aggregateHrRecoveryTrend, type BandTrend } from './hr-recovery-trend'
import { detectWorkoutCooldownEpisode, WORKOUT_COOLDOWN_PADDING_MS } from './hr-episode-detection'

// Bounded to the most recent MAX_WORKOUTS workouts in the window (oldest-first would be less useful
// for a live view) so an active user with hundreds of logged workouts can't fan this out into
// hundreds of queries; each per-workout HR fetch is a small, indexed range query, run in parallel.
const MAX_WORKOUTS = 60

export interface HrRecoveryProfileResult {
  profile: HrRecoveryProfile
  trend: BandTrend[]
}

export async function computeHrRecoveryProfile(
  repo: WorkoutRepository, userId: string, tz: string = DEFAULT_TZ, days: number,
): Promise<HrRecoveryProfileResult> {
  // One window for both sources, starting at the user's local midnight `days` days ago. It used to
  // be `now − days × 24 h` for the sets but that instant's whole day for the workouts, so a set
  // logged earlier on the first day was dropped while a workout from the same morning was kept.
  const today = todayInTz(tz)
  const fromDay = shiftDateStr(today, -days)
  const since = dateStrMidnightInTz(fromDay, tz)

  const [setRows, workouts, { restingHr }] = await Promise.all([
    repo.getSetHrStatsSince(userId, since),
    repo.getOuraWorkouts(userId, { from: fromDay, to: today }),
    resolveHrProfile(repo, userId, tz),
  ])

  const setEpisodes = setRows.map(episodeFromSetHrStats).filter((e): e is RecoveryEpisode => e != null)

  const boundedWorkouts = workouts
    .filter(w => w.endDatetime.getTime() > w.startDatetime.getTime())
    .slice(0, MAX_WORKOUTS)
  const workoutEpisodes = (await Promise.all(boundedWorkouts.map(async w => {
    const to = new Date(w.endDatetime.getTime() + WORKOUT_COOLDOWN_PADDING_MS)
    const readings = await repo.getHrForWindow(userId, w.startDatetime, to)
    return detectWorkoutCooldownEpisode(readings, w, restingHr)
  }))).filter((e): e is RecoveryEpisode => e != null)

  const episodes = [...setEpisodes, ...workoutEpisodes]

  return {
    profile: aggregateHrRecoveryProfile(episodes),
    trend: aggregateHrRecoveryTrend(episodes, tz),
  }
}
