import { formatInTimeZone } from 'date-fns-tz'

// Sleep-start consistency — how much bedtime varies night to night.
// Bedtimes cluster around midnight, so raw minutes-since-midnight makes
// 11:30pm (1410) and 12:15am (15) look ~23 hours apart instead of 45 minutes.
// Shifting the reference point to noon (nobody's normal bedtime) removes the
// wrap discontinuity: minutesFromNoon(23:30) = 690, minutesFromNoon(00:15) = 735.
//
// `tz` is optional: omit it for the existing client usage (device-local time is
// already correct there); pass it explicitly from server code, where the process's
// own local timezone is not guaranteed to match the user's.
export function minutesFromNoon(iso: string, tz?: string): number {
  let minutesSinceMidnight: number
  if (tz) {
    const h = parseInt(formatInTimeZone(new Date(iso), tz, 'H'), 10)
    const m = parseInt(formatInTimeZone(new Date(iso), tz, 'm'), 10)
    minutesSinceMidnight = h * 60 + m
  } else {
    const d = new Date(iso)
    minutesSinceMidnight = d.getHours() * 60 + d.getMinutes()
  }
  return (minutesSinceMidnight - 720 + 1440) % 1440
}

export interface SleepConsistencyResult {
  sdMinutes: number | null
  meanMinutesFromNoon: number | null
}

export function computeSleepStartConsistency(sleepStarts: string[], tz?: string): SleepConsistencyResult {
  if (sleepStarts.length < 2) return { sdMinutes: null, meanMinutesFromNoon: null }
  const values = sleepStarts.map(s => minutesFromNoon(s, tz))
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return { sdMinutes: Math.sqrt(variance), meanMinutesFromNoon: mean }
}
