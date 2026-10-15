/**
 * Loads one local day's Activity-score inputs from the repository and scores it (#2435). Read-only.
 * The finalise (`lib/health/activity-finalise.ts`) stores what this returns, and the day audit reads
 * it for a previous day that has not been finalised, so the two cannot disagree.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr } from '../date-utils'
import { resolveHrProfile } from './hr-profile'
import { toOuraByDate } from './wear-confidence'
import { scoreActivityForDay, restingHrBaseline, type ActivityDay } from './activity-day'

/** The history a day's score reads: the 28-day resting-HR baseline and the ACWR chronic window. */
const HISTORY_DAYS = 28

type ActivityDayRepo = Pick<WorkoutRepository,
  'listBodyMetrics' | 'getOuraDaily' | 'getWorkoutSessionsFrom' | 'getHrForWindow' | 'getActiveProgram'
  | 'getUserById' | 'getUserGoals'>

/** Scores one local day from its own inputs. Read-only. */
export async function loadActivityDay(repo: ActivityDayRepo, userId: string, tz: string, date: string): Promise<ActivityDay> {
  const dayMid = dateStrMidnightInTz(date, tz)
  const nextMid = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
  const fromIso = shiftDateStr(date, -HISTORY_DAYS)
  const [bodyMetrics, ouraRows, sessions, hrRows, program, user, userGoals, hrProfile] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, date),
    repo.getOuraDaily(userId, fromIso, date),
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(fromIso, tz)),
    repo.getHrForWindow(userId, dayMid, nextMid),
    repo.getActiveProgram(userId),
    repo.getUserById(userId),
    repo.getUserGoals(userId).catch(() => null),
    // #2182: the same zone ceiling the live score uses.
    resolveHrProfile(repo as WorkoutRepository, userId, tz).catch(() => null),
  ])
  return scoreActivityForDay({
    date,
    tz,
    bodyMetrics,
    restingHrBaseline: restingHrBaseline(bodyMetrics, toOuraByDate(ouraRows)),
    hrRows,
    maxHr: hrProfile?.maxHr ?? null,
    sessions,
    program,
    user,
    stepsGoal: userGoals?.stepsGoal ?? null,
  })
}

