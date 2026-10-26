/**
 * Loads one local day's Activity-score inputs from the repository and scores it (#2435). Read-only.
 * The finalise (`lib/health/activity-finalise.ts`) stores what this returns, and the day audit reads
 * it for a previous day that has not been finalised, so the two cannot disagree.
 */
import type { WorkoutRepository } from '@/lib/data/repository'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../date-utils'
import { resolveHrProfile, maxHrIsUnread, type HrProfile } from './hr-profile'
import { toOuraByDate } from './wear-confidence'
import { ouraCloudMetGrid } from './oura-cloud-met'
import { scoreActivityForDay, restingHrBaseline, carriedOverRestingHr, type ActivityDay } from './activity-day'

/** The history a day's score reads: the 28-day resting-HR baseline and the ACWR chronic window. */
const HISTORY_DAYS = 28

type ActivityDayRepo = Pick<WorkoutRepository,
  'listBodyMetrics' | 'getOuraDaily' | 'getWorkoutSessionsFrom' | 'getHrForWindow' | 'getActiveProgram'
  | 'getUserById' | 'getUserGoals' | 'getOuraCloudActivitySeries' | 'listActivityLogs'>

export interface LoadActivityDayOptions {
  /** The HR profile's ceiling, when the caller has already resolved it (once, not per day). Null is a
   *  resolved "none"; leave the option out to resolve it here. */
  maxHr?: number | null
  /** The caller's resolved profile is a stand-in for a failed read (`maxHrIsUnread`). A finished day
   *  then refuses to score, so it is not stored final on an age-based ceiling. */
  maxHrUnread?: boolean
  /** The day's HR rows (`getHrForWindow` over the local day), or the pending read of them, when the
   *  caller has fetched them already: the day is then read once, not twice. Leave out to read here. */
  hrRows?: HrRows | Promise<HrRows>
}

type HrRows = Awaited<ReturnType<WorkoutRepository['getHrForWindow']>>

/** Scores one local day from its own inputs. Read-only. */
export async function loadActivityDay(
  repo: ActivityDayRepo, userId: string, tz: string, date: string, options: LoadActivityDayOptions = {},
): Promise<ActivityDay> {
  const dayMid = dateStrMidnightInTz(date, tz)
  const nextMid = dateStrMidnightInTz(shiftDateStr(date, 1), tz)
  const fromIso = shiftDateStr(date, -HISTORY_DAYS)
  // A finished day is stored as final, so a read that fails must fail the load rather than become a
  // default (#3347 review): the day stays un-finalised and the next pass retries. Today only loses
  // the input for this read.
  const finished = date < todayInTz(tz)
  const [bodyMetrics, ouraRows, sessions, hrRows, program, user, userGoals, cloudActivity, activityLogs, hrProfile] = await Promise.all([
    repo.listBodyMetrics(userId, fromIso, date),
    repo.getOuraDaily(userId, fromIso, date),
    repo.getWorkoutSessionsFrom(userId, dateStrMidnightInTz(fromIso, tz)),
    options.hrRows ?? repo.getHrForWindow(userId, dayMid, nextMid),
    repo.getActiveProgram(userId),
    repo.getUserById(userId),
    // A swallowed goals read would score the day against the default step goal.
    finished ? repo.getUserGoals(userId) : repo.getUserGoals(userId).catch(() => null),
    // #3114: Oura's per-minute MET decides the move lane; its activity day starts at 4 a.m., hence the
    // day before. Not caught for a finished day: a swallowed failure would be stored as the final
    // value (the 24 h grace then makes it permanent), so a failure leaves the day un-finalised for the
    // next pass. Today (the day log scores today through here) only loses its move lane, as the
    // readiness payload's live read does.
    repo.getOuraCloudActivitySeries(userId, shiftDateStr(date, -1), date).catch((cause: unknown) => {
      if (finished) throw cause
      return []
    }),
    // The day's treadmill steps join its step count (#3134). Thrown for a finished day like the reads
    // above; today only loses the treadmill part.
    finished ? repo.listActivityLogs(userId, date, date) : repo.listActivityLogs(userId, date, date).catch(() => []),
    // #2182: the same zone ceiling the live score uses.
    options.maxHr !== undefined
      ? Promise.resolve({ maxHr: options.maxHr })
      : resolveHrProfile(repo as WorkoutRepository, userId, tz).catch(() => null),
  ])
  const hrUnread = options.maxHr !== undefined ? options.maxHrUnread === true : maxHrIsUnread(hrProfile as HrProfile | null)
  if (finished && hrUnread) {
    throw new Error(`[activity-day-load] max heart rate for ${date} could not be read; not scoring a finished day on a stand-in ceiling`)
  }
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
    activityLogs,
  })
}

