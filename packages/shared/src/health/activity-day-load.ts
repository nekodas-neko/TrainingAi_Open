/**
 * Loads one local day's Activity-score inputs from the repository and scores it (#2435). Read-only.
 * The finalise (`lib/health/activity-finalise.ts`) stores what this returns, and the day audit reads
 * it for a previous day that has not been finalised, so the two cannot disagree.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../date-utils'
import { resolveHrProfile } from './hr-profile'
import { toOuraByDate } from './wear-confidence'
import { ouraCloudMetGrid } from './oura-cloud-met'
import { scoreActivityForDay, restingHrBaseline, carriedOverRestingHr, type ActivityDay } from './activity-day'

/** The history a day's score reads: the 28-day resting-HR baseline and the ACWR chronic window. */
const HISTORY_DAYS = 28

type ActivityDayRepo = Pick<WorkoutRepository,
  'listBodyMetrics' | 'getOuraDaily' | 'getWorkoutSessionsFrom' | 'getHrForWindow' | 'getActiveProgram'
  | 'getUserById' | 'getUserGoals' | 'getOuraCloudActivitySeries'>

export interface LoadActivityDayOptions {
  /** The HR profile's ceiling, when the caller has already resolved it (once, not per day). Null is a
   *  resolved "none"; leave the option out to resolve it here. */
  maxHr?: number | null
}

/** Scores one local day from its own inputs. Read-only. */
export async function loadActivityDay(
  repo: ActivityDayRepo, userId: string, tz: string, date: string, options: LoadActivityDayOptions = {},
): Promise<ActivityDay> {
  const dayMid = dateStrMidnightInTz(date, tz)
  const nextMid = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
  const fromIso = shiftDateStr(date, -HISTORY_DAYS)
  const [bodyMetrics, ouraRows, sessions, hrRows, program, user, userGoals, cloudActivity, hrProfile] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, date),
    repo.getOuraDaily(userId, fromIso, date),
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(fromIso, tz)),
    repo.getHrForWindow(userId, dayMid, nextMid),
    repo.getActiveProgram(userId),
    repo.getUserById(userId),
    repo.getUserGoals(userId).catch(() => null),
    // #3114: Oura's per-minute MET decides the move lane; its activity day starts at 4 a.m., hence the
    // day before. Not caught for a finished day: a swallowed failure would be stored as the final
    // value (the 24 h grace then makes it permanent), so a failure leaves the day un-finalised for the
    // next pass. Today (the day log scores today through here) only loses its move lane, as the
    // readiness payload's live read does.
    repo.getOuraCloudActivitySeries(userId, shiftDateStr(date, -1), date).catch((cause: unknown) => {
      if (date < todayInTz(tz)) throw cause
      return []
    }),
    // #2182: the same zone ceiling the live score uses.
    options.maxHr !== undefined
      ? Promise.resolve({ maxHr: options.maxHr })
      : resolveHrProfile(repo as WorkoutRepository, userId, tz).catch(() => null),
  ])
  return scoreActivityForDay({
    date,
    tz,
    bodyMetrics,
    restingHrBaseline: restingHrBaseline(bodyMetrics, toOuraByDate(ouraRows)),
    // The previous device's mean while the device in use warms up, so the stored score keeps its zone
    // lane the same way the live one does (#3001).
    restingHrCarriedOver: carriedOverRestingHr(bodyMetrics),
    hrRows,
    metGrid: ouraCloudMetGrid(cloudActivity, dayMid.getTime(), nextMid.getTime()),
    maxHr: hrProfile?.maxHr ?? null,
    sessions,
    program,
    user,
    stepsGoal: userGoals?.stepsGoal ?? null,
  })
}

