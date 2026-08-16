// Cross-domain "does volume predict soreness" correlation helper. For each
// (training day, muscle) pair, x = that muscle's volume-load that day, y = whether
// the muscle was sore the next morning (0/100 so a bucket average reads as a %).
import { normalizeMuscle, moodMuscleMatches } from '@trainingai/shared/muscles'
import { toAestDay, shiftDateStr } from '@trainingai/shared/date-utils'

interface SessionLite {
  startedAt: Date
  exercises: { muscleGroups: string[]; volume?: number }[]
}
interface CheckinLite {
  logDate: string
  soreMuscles: string[]
  restingSoreness: number | null
}

/** "YYYY-MM-DD|<normalized muscle>" -> summed volume-load (kg) for that local day. */
export function volumeByDayMuscle(sessions: SessionLite[], tz: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const ws of sessions) {
    const date = toAestDay(ws.startedAt, tz)
    for (const ex of ws.exercises) {
      if (!ex.volume || ex.volume <= 0) continue
      for (const raw of ex.muscleGroups) {
        const key = `${date}|${normalizeMuscle(raw)}`
        out.set(key, (out.get(key) ?? 0) + ex.volume)
      }
    }
  }
  return out
}

/** Points {x: muscle-day volume, y: 100 if sore next morning else 0}. Drops any
 *  muscle-day with no morning check-in on day+1. */
export function sorenessVsVolumePoints(
  sessions: SessionLite[],
  checkins: CheckinLite[],
  tz: string,
): { x: number; y: number }[] {
  const checkinByDate = new Map(checkins.map(c => [c.logDate, c]))
  const points: { x: number; y: number }[] = []
  for (const [key, volume] of volumeByDayMuscle(sessions, tz)) {
    const [date, muscle] = key.split('|')
    const next = checkinByDate.get(shiftDateStr(date, 1))
    if (!next) continue
    const listed = next.soreMuscles.some(m => moodMuscleMatches(muscle, m))
    const wholeBody = next.soreMuscles.length === 0 && (next.restingSoreness ?? 0) >= 4
    points.push({ x: volume, y: listed || wholeBody ? 100 : 0 })
  }
  return points
}
