import type { WorkoutRepository } from '@/lib/data/repository'
import { resolveHrProfile } from '@trainingai/shared/health/hr-profile'
import {
  activityLogWindow, heartHealthDayOutcome, heartHealthFloorBpm, heartHealthMinutes, heartHealthRescore, heartHealthVerdict,
  type HeartHealthActivity, type HeartHealthDayOutcome,
} from '@trainingai/shared/running/heart-health'
import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * Issue 2093. Server half of the heart-health activity: measures each logged activity's minutes at
 * moderate effort or above (issue 2746) against the heart-rate series, and applies the one rule in
 * `packages/shared/src/running/heart-health.ts` to every prescription day in a range.
 *
 * Measured here because the heart-rate series lives on the server (`oura_heartrate`, merged with
 * strap and Health Connect rows by `getHrForWindow`). An activity saved on the device counts once
 * it has synced, which `pushThenRevalidate` does straight after the save.
 */

export interface HeartHealthDay {
  date: string
  runId: string
  /** The stored row's status — the history shows the measured outcome, this is what is recorded. */
  status: 'pending' | 'completed' | 'skipped'
  targetMin: number | null
  countedMin: number
  met: boolean
  outcome: HeartHealthDayOutcome
  /** The activity credited with the day, when any has counted minutes. */
  creditedId: string | null
  activities: HeartHealthActivity[]
}

type Profile = { maxHr: number; restingHr: number }

/** Minutes at or above the heart-health floor inside one activity's window, or null when it cannot
 *  be placed or nothing recorded a heart rate across it. */
async function activityEffortMin(
  repo: WorkoutRepository, userId: string, tz: string, floorBpm: number,
  log: { date: string; startTime?: string | null; endTime?: string | null; durationMin?: number | null },
): Promise<number | null> {
  const window = activityLogWindow(log, tz)
  if (!window) return null
  const rows = await repo.getHrForWindow(userId, window.from, window.to)
  if (rows.length < 2) return null
  const readings = rows.map((r) => ({
    timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).getTime(),
    bpm: r.bpm,
  }))
  return heartHealthMinutes(readings, floorBpm)
}

/** Every prescription day in [from, to] with its activities, their counted minutes and the verdict. */
export async function heartHealthDays(
  repo: WorkoutRepository, userId: string, tz: string, from: string, to: string,
  profile?: Profile,
): Promise<HeartHealthDay[]> {
  const [runs, logs, resolved] = await Promise.all([
    repo.getPrescribedRuns(userId, from, to),
    repo.listActivityLogs(userId, from, to),
    profile ? Promise.resolve(profile) : resolveHrProfile(repo, userId, tz),
  ])
  if (runs.length === 0) return []
  const floorBpm = heartHealthFloorBpm({ maxHr: resolved.maxHr, restingHr: resolved.restingHr })
  const runDates = new Set(runs.map((r) => r.date))
  const today = todayInTz(tz)

  // Only the days that carry a prescription need their activities measured.
  const measured = await Promise.all(logs.filter((l) => runDates.has(l.date)).map(async (l): Promise<[string, HeartHealthActivity]> => [
    l.date,
    {
      id: l.id,
      title: l.title,
      activityType: l.activityType,
      durationMin: l.durationMin ?? null,
      effortMin: await activityEffortMin(repo, userId, tz, floorBpm, l).catch(() => null),
    },
  ]))
  const byDate = new Map<string, HeartHealthActivity[]>()
  for (const [date, a] of measured) byDate.set(date, [...(byDate.get(date) ?? []), a])

  return runs.map((r) => {
    const activities = byDate.get(r.date) ?? []
    const v = heartHealthVerdict(r.durationMin, activities)
    return {
      date: r.date,
      runId: r.id,
      status: r.status,
      targetMin: v.targetMin,
      countedMin: v.countedMin,
      met: v.met,
      outcome: heartHealthDayOutcome(v, activities.length, r.date === today, r.status),
      creditedId: v.credited?.id ?? null,
      activities,
    }
  })
}

export interface HeartHealthRescoreChange {
  date: string
  runId: string
  activityLogId: string
  completedAs: 'run' | 'walk'
  countedMin: number
  targetMin: number | null
}

/**
 * Re-score stored prescription rows in [from, to] under the rule: a `pending` day that met it becomes
 * `completed`, linked to the credited activity. `write: false` reports without writing. Every value
 * written is derived here; nothing from a request reaches `.set()`.
 */
export async function rescoreHeartHealth(
  repo: WorkoutRepository, userId: string, tz: string, from: string, to: string,
  opts: { write: boolean },
): Promise<{ days: HeartHealthDay[]; changes: HeartHealthRescoreChange[]; written: number }> {
  const days = await heartHealthDays(repo, userId, tz, from, to)
  const changes: HeartHealthRescoreChange[] = []
  for (const d of days) {
    const credited = d.activities.find((a) => a.id === d.creditedId) ?? null
    const r = heartHealthRescore(
      { status: d.status },
      { targetMin: d.targetMin, countedMin: d.countedMin, met: d.met, credited },
    )
    if (r.action !== 'complete') continue
    changes.push({ date: d.date, runId: d.runId, activityLogId: r.activityLogId, completedAs: r.completedAs, countedMin: d.countedMin, targetMin: d.targetMin })
  }
  let written = 0
  if (opts.write) {
    for (const c of changes) {
      const updated = await repo.updatePrescribedRun(userId, c.runId, {
        status: 'completed', activityLogId: c.activityLogId, completedAs: c.completedAs,
      })
      if (updated) written++
    }
  }
  return { days, changes, written }
}
