// #3875: the Oura connector's mapping from its stored workouts (`oura_workouts`, via
// `getOuraWorkouts`) to the generic activity session readers take
// (`@trainingai/shared/health/activity-sessions`). The energy budget and the heart-rate recovery
// profile used to read the Oura rows themselves; a second source writes its own mapping beside its
// own connector, with its own vocabulary table (connector guide §3d).
import type { SourceActivitySession } from '@trainingai/shared/health/activity-sessions'
import { OURA_CLOUD_CONNECTOR } from '@trainingai/shared/health/source-connectors'

/** Oura activity → the app's own activity type, where the app has one (#3087). Walks, runs and hikes
 *  map so `pedometerStepsInside` takes their steps back out of the passive step term, as for a logged walk (#3082). */
export const OURA_TO_APP_TYPE: Readonly<Record<string, string>> = {
  walking: 'walk', running: 'run', hiking: 'hike', cycling: 'cycle', swimming: 'swim', rowing: 'row',
  elliptical: 'elliptical', hiit: 'hiit', yoga: 'yoga', stretching: 'stretch', strengthTraining: 'strength',
}

export interface OuraWorkoutRow {
  day: string
  activity: string
  startDatetime: Date
  endDatetime: Date
  distanceM: number | null
  reviewed: boolean
}

/** Oura's workouts as generic activity sessions, in the order given. A reviewed workout is one the
 *  owner dismissed on the old review card (logging it saved an activity log instead). */
export function ouraActivitySessions(rows: readonly OuraWorkoutRow[]): SourceActivitySession[] {
  return rows.map(w => {
    const appType = OURA_TO_APP_TYPE[w.activity]
    return {
      day: w.day,
      activityType: appType ?? w.activity,
      ...(appType ? {} : { unmappedActivity: w.activity }),
      start: w.startDatetime,
      end: w.endDatetime,
      distanceKm: w.distanceM != null && w.distanceM > 0 ? w.distanceM / 1000 : null,
      dismissed: w.reviewed,
      source: OURA_CLOUD_CONNECTOR.healthSource,
    }
  })
}
