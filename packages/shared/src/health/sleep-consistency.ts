import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '../date-utils'

// Sleep-start consistency — how much bedtime varies night to night.
// Bedtimes cluster around midnight, so raw minutes-since-midnight makes
// 11:30pm (1410) and 12:15am (15) look ~23 hours apart instead of 45 minutes.
// Shifting the reference point to noon (nobody's normal bedtime) removes the
// wrap discontinuity: minutesFromNoon(23:30) = 690, minutesFromNoon(00:15) = 735.
//
// DV-7: `tz` used to be optional, and omitting it read `d.getHours()` — the DEVICE's
// clock, which is the pattern CLAUDE.md's Timezone section bans for anything a user
// reads. It was invisible because CI runs in UTC and the owner's phone is in the zone
// the data was recorded in; on a machine set to Brisbane this file's own tests failed
// by exactly 600 minutes, the UTC↔Brisbane offset. There is no device-local path now.
//
// The default is the user's zone, not the device's, and every server caller already
// passes the session tz explicitly. DV-9 converts the two client callers to do the
// same — until then they get the owner's zone, which is right for him and wrong for
// nobody currently using the app.
export function minutesFromNoon(iso: string, tz: string = DEFAULT_TZ): number {
  const at = new Date(iso)
  const h = parseInt(formatInTimeZone(at, tz, 'H'), 10)
  const m = parseInt(formatInTimeZone(at, tz, 'm'), 10)
  return (h * 60 + m - 720 + 1440) % 1440
}

export interface SleepConsistencyResult {
  sdMinutes: number | null
  meanMinutesFromNoon: number | null
}

export function computeSleepStartConsistency(
  sleepStarts: string[],
  tz: string = DEFAULT_TZ,
): SleepConsistencyResult {
  if (sleepStarts.length < 2) return { sdMinutes: null, meanMinutesFromNoon: null }
  const values = sleepStarts.map(s => minutesFromNoon(s, tz))
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return { sdMinutes: Math.sqrt(variance), meanMinutesFromNoon: mean }
}
