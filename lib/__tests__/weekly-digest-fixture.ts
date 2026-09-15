// Shared rich fixture — every context line populated, all values distinct.
export const TZ = 'America/New_York'
export const NOW = '2026-09-10T14:00:00Z'      // Thursday; recap week = 2026-08-31 .. 2026-09-06

export const sessions = [
  { startedAt: new Date('2026-09-01T15:00:00Z'), exercises: [{ exerciseName: 'Bench', volume: 3000, sets: [{}, {}, {}] }] },
  { startedAt: new Date('2026-09-03T15:00:00Z'), exercises: [{ exerciseName: 'Squat', volume: 4000, sets: [{}, {}] }] },
  { startedAt: new Date('2026-08-25T15:00:00Z'), exercises: [{ exerciseName: 'Bench', volume: 5000, sets: [{}] }] },
]
export const muscleAssignments = {
  Bench: [{ muscle: 'chest', role: 'primary' }, { muscle: 'triceps', role: 'secondary' }],
  Squat: [{ muscle: 'quads', role: 'primary' }],
}
export const bodyMetrics = [
  { date: '2026-08-25', weightKg: 82.4, hrvMs: 40 },
  { date: '2026-09-02', weightKg: 81.1, hrvMs: 44 },
]
export const sleepSessions = [
  night('2026-08-26', 7.2, 52, 88),
  night('2026-09-01', 6.4, 58, 90),
  night('2026-09-03', 8.1, 61, 92),
]

/** A night that ENDS on `date` at 07:00 New York time (11:00 UTC), having begun 23:00 the evening before. */
export function night(date: string, durationHours: number, averageHrvMs: number, efficiency: number) {
  const end = new Date(`${date}T11:00:00Z`)
  return {
    date,
    durationHours,
    averageHrvMs,
    efficiency,
    sleepStart: new Date(end.getTime() - durationHours * 3_600_000),
    sleepEnd: end,
  }
}
export const derivedRows = [
  { day: '2026-08-26', readinessSource: 'ble-derived', readinessScore: 71, stressHighMinutes: 44,
    resilienceLevel: 2, trainingLoadOts: 3.2, trainingLoadHigh: false, illnessFlag: 'normal', illnessScore: 1 },
  { day: '2026-09-01', readinessSource: 'ble-derived', readinessScore: 66, stressHighMinutes: 51,
    resilienceLevel: 3, trainingLoadOts: 4.8, trainingLoadHigh: true, illnessFlag: 'watch', illnessScore: 5,
    illnessBiomarkers: { tempC: { z: 1.8 }, rhr: { z: -0.6 } } },
]
export const personalRecords = [
  { exerciseName: 'Bench', estimated1rm: 103.4 },
  { exerciseName: 'Squat', estimated1rm: 141.7 },
]
export const exerciseLibrary = [
  { name: 'Bench', exerciseType: 'barbell' },
  { name: 'Squat', exerciseType: 'barbell' },
]
export const friendIds = ['f1', 'f2', 'f3']
