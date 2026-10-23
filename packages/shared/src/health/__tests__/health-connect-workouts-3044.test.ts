// #3044, 19 Oct: a Health Connect session that overlaps an in-app log or strength session is not
// paid for twice in the energy budget, and Preview's sessions are stored like the current app's.
import { describe, it, expect } from 'vitest'
import { budgetActivityLogs, healthConnectSessionAsWorkout, activityTypeForHealthConnectExercise } from '../health-connect-workouts'
import { computeActiveEnergy } from '../daily-energy'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../../date-utils'
import { healthConnectRecord, type HealthConnectRecord } from '../../validation/health-connect-import'

const TZ = 'Australia/Brisbane'
const day = shiftDateStr(todayInTz(TZ), -1)
// Anchored to local midday, so the local day cannot flip on a zone edge.
const at = (hour: number, min = 0) => new Date(dateStrMidnightInTz(day, TZ).getTime() + (hour * 60 + min) * 60_000)
const log = (startTime: string, endTime: string, over: Record<string, unknown> = {}) =>
  ({ date: day, activityType: 'walk', startTime, endTime, durationMin: 40, ...over })
const hc = (startTime: string, endTime: string, over: Record<string, unknown> = {}) =>
  log(startTime, endTime, { externalSource: 'health_connect', ...over })

describe('budgetActivityLogs', () => {
  it('drops a Health Connect walk over an in-app walk, whatever minute each starts', () => {
    const inApp = log('12:00:00', '12:40:00')
    expect(budgetActivityLogs([inApp, hc('12:01', '12:41')], [], TZ)).toEqual([inApp])
  })

  it('drops a watch strength session inside an in-app gym session', () => {
    const sessions = [{ startedAt: at(11, 50), completedAt: at(13) }]
    expect(budgetActivityLogs([hc('12:00', '12:45', { activityType: 'strength' })], sessions, TZ)).toEqual([])
  })

  it('matches by time, not type: a watch hike over an in-app walk is the same minutes', () => {
    expect(budgetActivityLogs([log('12:00', '12:40'), hc('12:10', '12:50', { activityType: 'hike' })], [], TZ)).toHaveLength(1)
  })

  it('keeps a Health Connect session nothing in the app covers', () => {
    const watch = hc('15:00', '15:30')
    expect(budgetActivityLogs([log('12:00', '12:40'), watch], [{ startedAt: at(8), completedAt: at(9) }], TZ)).toContain(watch)
  })

  it('never drops an in-app log, and two Health Connect sessions do not cancel each other', () => {
    const a = hc('12:00', '12:40'), b = hc('12:20', '12:50')
    expect(budgetActivityLogs([a, b], [], TZ)).toEqual([a, b])
  })

  it('leaves logs stored before the source was recorded alone, so no past day moves', () => {
    const legacyWatchCopy = log('12:01', '12:41')
    expect(budgetActivityLogs([log('12:00', '12:40'), legacyWatchCopy], [], TZ)).toHaveLength(2)
  })

  it('takes the overlapping session out of the day’s activity energy', () => {
    const profile = { ageYears: 40, weightKg: 80, sex: 'male' as const }
    const energy = (activities: { activityType: string; durationMin: number }[]) =>
      computeActiveEnergy({ profile, strengthSessions: [], activities, pedometerSteps: null }).activityKcal
    const logs = [log('12:00', '12:40'), hc('12:01', '12:41')]
    expect(energy(budgetActivityLogs(logs, [], TZ))).toBe(energy([logs[0]]))
    expect(energy(logs)).toBeGreaterThan(energy(budgetActivityLogs(logs, [], TZ)))
  })
})

describe('healthConnectSessionAsWorkout (Preview)', () => {
  const record = (over: Partial<HealthConnectRecord> = {}): HealthConnectRecord => ({
    id: 'hc-1', type: 'ExerciseSession', sourcePackage: 'com.sec.android.app.shealth', recordingMethod: 2,
    modifiedAt: at(13).toISOString(), start: at(12).toISOString(), end: at(12, 45).toISOString(), exerciseType: 70, ...over,
  })

  it('dates and clocks the session in the user’s zone, keyed on its record id', () => {
    expect(healthConnectSessionAsWorkout(record({ title: 'Gym' }), TZ)).toEqual({
      recordId: 'hc-1', date: day, title: 'Gym', activityType: 'strength', startTime: '12:00', endTime: '12:45', durationMin: 45,
    })
  })

  it('names an untitled session after its type, and an unknown type is a workout', () => {
    expect(healthConnectSessionAsWorkout(record({ exerciseType: 79 }), TZ).title).toBe('Walk')
    expect(healthConnectSessionAsWorkout(record({ exerciseType: 999 }), TZ)).toMatchObject({ title: 'Workout', activityType: 'other' })
  })

  it('maps the three strength types to strength', () => {
    expect([70, 81, 13].map(activityTypeForHealthConnectExercise)).toEqual(['strength', 'strength', 'strength'])
  })
})

describe('healthConnectRecord for an exercise session (#2843)', () => {
  const base = {
    id: 'hc-1', type: 'ExerciseSession', sourcePackage: 'com.test', recordingMethod: 2,
    modifiedAt: at(13).toISOString(), start: at(12).toISOString(), end: at(12, 45).toISOString(),
  }

  it('needs an exercise type, and takes no measurement value', () => {
    expect(healthConnectRecord.safeParse({ ...base, exerciseType: 70 }).success).toBe(true)
    expect(healthConnectRecord.safeParse(base).success).toBe(false)
    expect(healthConnectRecord.safeParse({ ...base, exerciseType: 70, value: 5 }).success).toBe(false)
    expect(healthConnectRecord.safeParse({ ...base, exerciseType: 1.5 }).success).toBe(false)
  })

  it('refuses an exercise type or title on any other record', () => {
    const weight = { ...base, type: 'Weight', value: 80 }
    expect(healthConnectRecord.safeParse(weight).success).toBe(true)
    expect(healthConnectRecord.safeParse({ ...weight, exerciseType: 70 }).success).toBe(false)
    expect(healthConnectRecord.safeParse({ ...weight, title: 'x' }).success).toBe(false)
  })
})
