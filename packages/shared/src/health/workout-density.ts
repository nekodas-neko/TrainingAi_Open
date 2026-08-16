export interface DaySession {
  startedAt: Date
  completedAt: Date | null
  volumeKg: number
}

export interface DayWorkoutMetrics {
  sessionDurationMin: number | null
  workoutDensity: number | null  // kg lifted per active minute
}

// Sums duration/volume across all completed sessions on a day (rest days and
// still-in-progress sessions contribute nothing). Density is null when there's
// no completed session or its duration rounds to 0 minutes.
export function aggregateWorkoutDay(sessions: DaySession[]): DayWorkoutMetrics {
  let durationMin = 0
  let volumeKg = 0
  let hasCompleted = false

  for (const s of sessions) {
    if (!s.completedAt) continue
    hasCompleted = true
    durationMin += (s.completedAt.getTime() - s.startedAt.getTime()) / 60_000
    volumeKg += s.volumeKg
  }

  if (!hasCompleted) return { sessionDurationMin: null, workoutDensity: null }

  const roundedDuration = Math.round(durationMin)
  return {
    sessionDurationMin: roundedDuration,
    workoutDensity: roundedDuration > 0 ? Math.round((volumeKg / roundedDuration) * 10) / 10 : null,
  }
}
