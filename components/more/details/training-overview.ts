import { toAestDay } from '@trainingai/shared/date-utils'
import type { MetricReading, ReadingGroup } from './measured-overview'

/**
 * LB-95 — personal records as readings, the one half of the measured overview with no route to
 * read them.
 */

export interface PersonalRecordRow {
  exerciseName: string
  estimated1rm: number
  /** An ISO INSTANT from the route, not a calendar day. */
  achievedAt: string
}

/**
 * Every value carries its date (BF-133's rule for this screen), and `achievedAt` is an instant, so
 * the day has to be resolved in the USER's zone. `toISOString().slice(0, 10)` would print the UTC
 * day, which is yesterday for every record set before 10am here.
 */
export function personalRecordReadings(records: PersonalRecordRow[], tz?: string): MetricReading[] {
  return records
    .filter(r => Number.isFinite(r.estimated1rm) && r.estimated1rm > 0)
    .map(r => ({
      label: r.exerciseName,
      value: `${Math.round(r.estimated1rm * 10) / 10} kg`,
      asOf: toAestDay(new Date(r.achievedAt), tz),
      // The route returns every exercise rather than the active program's, so a record can outlive
      // the program that set it. Saying "estimated" is not decoration: these are computed from a
      // logged set through the 1RM formula, never a lift that was performed at this weight.
      note: 'estimated 1RM',
    }))
}

export function trainingGroups(records: PersonalRecordRow[], tz?: string): ReadingGroup[] {
  const readings = personalRecordReadings(records, tz)
  return readings.length > 0 ? [{ title: 'Personal records', readings }] : []
}
