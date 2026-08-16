import type { WorkoutSession } from '@trainingai/shared/types'

export interface PeriodSummary {
  sessionCount: number
  totalVolumeKg: number
}

// Reusable "sessions within [from, to)" summary — used by getProgressVsPast today;
// /api/weekly-digest computes its own equivalent inline (see that route's history)
// and is a candidate to migrate onto this helper in a future pass, not forced here.
export function summarizePeriod(sessions: WorkoutSession[], from: Date, to: Date): PeriodSummary {
  const inWindow = sessions.filter(ws => ws.startedAt >= from && ws.startedAt < to && ws.exercises.length > 0)
  const totalVolumeKg = Math.round(
    inWindow.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0),
  )
  return { sessionCount: inWindow.length, totalVolumeKg }
}
