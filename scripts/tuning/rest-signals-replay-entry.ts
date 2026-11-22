// Bundled by `rest-signals-replay.cjs` (#3718). For each past day it loads what the next-session read
// loads (`getNextSession` in the Postgres adapter) through the same repository methods, with the day as
// "today", and runs the shipped decision over it. SELECT only: the session is read-only and the
// repository methods called here only read.
export { summariseRestSignalReplay } from '@trainingai/shared/ai-periodization/rest-signals-replay'
import type { ReplayDay } from '@trainingai/shared/ai-periodization/rest-signals-replay'
import { restRuleSleepTrend } from '@trainingai/shared/ai-periodization/daily-rest-decision'
import { restTrendsFromRows } from '@trainingai/shared/ai-periodization/daily-rest-inputs'
import { countConsecutiveTrainingDays } from '@trainingai/shared/ai-periodization/ai-dynamic'
import { resolveSelfReportedSick } from '@trainingai/shared/ai-periodization/signals'
import { liveReadinessReadingForDay } from '@trainingai/shared/health/live-readiness'
import { latestIllnessFromDerived } from '@trainingai/shared/health/illness-radar'
import { shiftDateStr, todayInTz, toAestDay, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { loadNightTemperature } from '@/lib/health/night-temperature'
import { getPool } from '@/lib/data/postgres/client'
import { PostgresWorkoutRepository } from '@/lib/data/postgres/adapter'

/** What the server says this session's `default_transaction_read_only` is. */
export async function readOnlyState(): Promise<string> {
  const { rows } = await getPool().query('SHOW default_transaction_read_only')
  return String(rows[0]?.default_transaction_read_only)
}

export async function closePool(): Promise<void> {
  await getPool().end()
}

/** The `days` local days before today, oldest first, each as the morning's inputs. */
export async function replayDays(userId: string, days: number): Promise<ReplayDay[]> {
  const repo = new PostgresWorkoutRepository()
  const user = await repo.getUserById(userId)
  if (!user) throw new Error('no such user')
  const tz = user.timezone ?? 'Australia/Brisbane'
  const today = todayInTz(tz)
  const first = shiftDateStr(today, -days)
  // Sessions with at least one logged exercise, as `getNextSession` reads its history.
  const { rows: ws } = await getPool().query(
    `SELECT w.started_at FROM workout_sessions w
      WHERE w.user_id = $1 AND w.deleted_at IS NULL AND w.started_at >= $2
        AND EXISTS (SELECT 1 FROM exercise_logs e WHERE e.workout_session_id = w.id AND e.deleted_at IS NULL)`,
    [userId, dateStrMidnightInTz(shiftDateStr(first, -31), tz)],
  )
  const history = ws.map(r => ({ sessionName: '', startedAt: new Date(r.started_at), hasExercises: true }))
  const trainedDays = new Set(history.map(h => toAestDay(h.startedAt, tz)))

  const out: ReplayDay[] = []
  for (let i = days; i >= 1; i--) {
    const day = shiftDateStr(today, -i)
    const from14 = shiftDateStr(day, -14)
    const [sleepAll, bodyMetrics, dailyRows, derivedRows, nightTemp, moodLog, checkin] = await Promise.all([
      repo.listSleepSessions(userId, from14, day),
      repo.listBodyMetrics(userId, from14, day),
      repo.getOuraDaily(userId, from14, day),
      repo.getOuraDailyDerived(userId, shiftDateStr(day, -1), day),
      loadNightTemperature(repo, userId, day, tz),
      repo.getMoodLog(userId, day),
      repo.getDayCheckin(userId, day, 'morning'),
    ])
    // `listSleepSessions` widens its range by a day each side; the next morning's night is the future.
    const sleepSessions = sleepAll.filter(s => s.date <= day)
    const trends = restTrendsFromRows(sleepSessions, bodyMetrics, dailyRows, tz)
    const reading = liveReadinessReadingForDay(day, derivedRows)
    const tonight = nightTemp.nightDate === day ? nightTemp : null
    // The morning: local midday, with only the sessions that started before the day began.
    const dayStart = dateStrMidnightInTz(day, tz)
    const before = history.filter(h => h.startedAt < dayStart)
    out.push({
      trained: trainedDays.has(day),
      input: {
        today: day,
        readinessScore: reading?.score ?? null,
        readinessModelVersion: reading?.modelVersion ?? null,
        sleepTrend: restRuleSleepTrend(trends.sleepScore, trends.sleepDuration),
        hrvTrend: trends.hrv,
        spo2Trend: trends.spo2,
        consecutiveTrainingDays: countConsecutiveTrainingDays(before, new Date(dayStart.getTime() + 12 * 3_600_000), tz),
        temperatureDeviation: tonight?.deviationC ?? null,
        temperatureBaselineDays: tonight?.baselineNights ?? 0,
        temperatureTrusted: tonight?.trusted ?? false,
        illnessFlag: latestIllnessFromDerived(derivedRows)?.flag ?? null,
        selfReportedSick: resolveSelfReportedSick(moodLog?.bodyState, checkin?.illnessContext),
        energyLevel: moodLog?.energyLevel ?? null,
      },
    })
  }
  return out
}
