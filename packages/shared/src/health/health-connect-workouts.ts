/**
 * Health Connect exercise sessions stored as activity logs (#3044, #2843).
 *
 * Both Health Connect writers, the current app's (`lib/health-connect-sync.ts`) and Preview's
 * native import, key a session on the record id Health Connect gave it, under one source, so the
 * same record reaching the server from either app lands on one row.
 */
import { movementWindows, type CountedMovement } from './oura-workout-activities'
import type { HealthConnectRecord } from '../validation/health-connect-import'
import { msToHHMMInTz, toAestDay } from '../date-utils'
import { capitalize } from '../format/capitalize'

/** `activity_logs.external_source` for a session imported from Health Connect. */
export const HEALTH_CONNECT_SOURCE = 'health_connect'

/**
 * Preview's Health Connect exercise types (the integer `ExerciseSessionRecord.exerciseType`, as
 * `react-native-health-connect`'s `ExerciseType` numbers it) → the app's activity types. The same
 * mapping the current app makes from the Capacitor plugin's string constants
 * (`mapExerciseTypeToActivityType`); anything else is `other`.
 */
const EXERCISE_TYPE_TO_ACTIVITY_TYPE: Record<number, string> = {
  79: 'walk', // WALKING
  56: 'run', // RUNNING
  57: 'run', // RUNNING_TREADMILL
  8: 'cycle', // BIKING
  9: 'cycle', // BIKING_STATIONARY
  37: 'hike', // HIKING
  74: 'swim', // SWIMMING_POOL
  73: 'swim', // SWIMMING_OPEN_WATER
  83: 'yoga', // YOGA
  71: 'stretch', // STRETCHING
  36: 'hiit', // HIGH_INTENSITY_INTERVAL_TRAINING
  70: 'strength', // STRENGTH_TRAINING
  81: 'strength', // WEIGHTLIFTING
  13: 'strength', // CALISTHENICS
}

export function activityTypeForHealthConnectExercise(exerciseType: number | undefined): string {
  return (exerciseType != null ? EXERCISE_TYPE_TO_ACTIVITY_TYPE[exerciseType] : undefined) ?? 'other'
}

/**
 * A Preview `ExerciseSession` record as the session both writers store (#2843): dated, and clocked,
 * in the user's zone, as the current app does (`sessionClockTimes`). An untitled session is named
 * after its type. Preview reads no per-session distance, energy or heart rate yet, so the server
 * costs it from its type and duration, as for any session sent without them.
 */
export function healthConnectSessionAsWorkout(record: HealthConnectRecord, tz: string) {
  const activityType = activityTypeForHealthConnectExercise(record.exerciseType)
  const start = new Date(record.start)
  return {
    recordId: record.id,
    date: toAestDay(start, tz),
    title: (record.title?.trim() || (activityType === 'other' ? 'Workout' : capitalize(activityType))).slice(0, 200),
    activityType,
    startTime: msToHHMMInTz(record.start, tz),
    endTime: msToHHMMInTz(record.end, tz),
    durationMin: Math.round((Date.parse(record.end) - start.getTime()) / 6_000) / 10,
  }
}

type BudgetLog = CountedMovement['activityLogs'][number] & { externalSource?: string | null }

/** How much of the shorter of two windows they must share to be one workout recorded twice. */
export const SAME_WORKOUT_OVERLAP = 0.5

/** Whether two windows are one workout: they share at least half of the shorter one. A walk that
 *  ends a minute into a gym session is two workouts, not one. */
function sameWorkout([aStart, aEnd]: [number, number], [bStart, bEnd]: [number, number]): boolean {
  const shared = Math.min(aEnd, bEnd) - Math.max(aStart, bStart)
  return shared > 0 && shared >= SAME_WORKOUT_OVERLAP * Math.min(aEnd - aStart, bEnd - bStart)
}

/**
 * The activity logs the energy budget costs: every log, less a Health Connect session that is the
 * same workout as an in-app log or a completed strength session (#3044, 19 Oct): they share at
 * least half of the shorter window. A watch's copy of a walk the owner also recorded in the app, or
 * of a gym session logged here, would otherwise pay the same minutes twice. Matched by time, not
 * id, and whatever the two types: two apps often name one workout differently (a walk and a hike).
 *
 * `earlier` is the in-app logs of the day before the range, matched and never returned, so a log
 * that ran past midnight still counts on the range's first day.
 *
 * Only a log stored with its source is ever dropped. Logs stored before the source was recorded
 * have none and count as in-app, so no past day's energy moves.
 */
export function budgetActivityLogs<T extends BudgetLog>(
  logs: readonly T[],
  sessions: CountedMovement['sessions'],
  tz: string,
  earlier: readonly BudgetLog[] = [],
): T[] {
  if (!logs.some(l => l.externalSource === HEALTH_CONNECT_SOURCE)) return [...logs]
  const inApp = movementWindows({ activityLogs: [...earlier, ...logs].filter(l => l.externalSource == null), sessions }, tz)
  return logs.filter(l => {
    if (l.externalSource !== HEALTH_CONNECT_SOURCE) return true
    const [own] = movementWindows({ activityLogs: [l], sessions: [] }, tz)
    return !own || !inApp.some(w => sameWorkout(own, w))
  })
}
