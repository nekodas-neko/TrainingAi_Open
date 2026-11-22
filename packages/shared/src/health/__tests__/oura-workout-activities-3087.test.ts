// #3087: Oura's own workouts were missing from the energy budget. These pin which ones now count,
// how they are typed, and that nothing already counted is paid for twice.
import { describe, it, expect } from 'vitest'
import { movementWindows, sourceSessionActivities, type CountedMovement } from '../oura-workout-activities'
import { ouraActivitySessions, type OuraWorkoutRow } from '@/lib/oura/cloud/activity-sessions-map'
import { computeActiveEnergy, stepEnergyKcal, WALKING_CADENCE_SPM } from '../daily-energy'
import { metIdForActivityName, ON_FOOT_ACTIVITIES } from '../workout-energy'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const day = shiftDateStr(todayInTz(TZ), -1)
// Anchored to local midday, so the local day cannot flip on a zone edge.
const at = (hour: number, min = 0) => new Date(dateStrMidnightInTz(day, TZ).getTime() + (hour * 60 + min) * 60_000)
const workout = (activity: string, from: Date, to: Date, over: Partial<OuraWorkoutRow> = {}): OuraWorkoutRow =>
  ({ day, activity, startDatetime: from, endDatetime: to, distanceM: null, reviewed: false, ...over })
// #3875: the rules read the generic session; Oura's rows go through the connector's mapping first.
const ouraWorkoutActivities = (rows: OuraWorkoutRow[], counted: CountedMovement, tz: string) =>
  sourceSessionActivities(ouraActivitySessions(rows), counted, tz)
const none = { activityLogs: [], sessions: [] }

describe('ouraWorkoutActivities (#3087)', () => {
  it('maps a ride to the app\'s cycle type, on the local day of its start, for its duration', () => {
    expect(ouraWorkoutActivities([workout('cycling', at(12), at(12, 45), { distanceM: 15_000 })], none, TZ))
      .toEqual([{ date: day, activityType: 'cycle', durationMin: 45, distanceKm: 15 }])
  })

  it('keeps an activity the app has no type for under its Oura name', () => {
    const [a] = ouraWorkoutActivities([workout('houseWork', at(12), at(12, 30))], none, TZ)
    expect(a).toMatchObject({ activityType: 'houseWork', unmappedActivity: 'house work', durationMin: 30 })
  })

  it('skips a workout that overlaps a saved activity log', () => {
    const counted = { activityLogs: [{ date: day, startTime: '12:10:00', endTime: '12:40:00' }], sessions: [] }
    expect(ouraWorkoutActivities([workout('walking', at(12), at(12, 30))], counted, TZ)).toEqual([])
  })

  it('skips a workout inside a strength session, which the app already costs', () => {
    const counted = { activityLogs: [], sessions: [{ startedAt: at(11, 50), completedAt: at(13) }] }
    expect(ouraWorkoutActivities([workout('strengthTraining', at(12), at(12, 45))], counted, TZ)).toEqual([])
  })

  it('skips a workout the owner reviewed without logging: a dismissal', () => {
    expect(ouraWorkoutActivities([workout('cycling', at(12), at(12, 45), { reviewed: true })], none, TZ)).toEqual([])
  })

  // A log stores clock times, so one that crosses midnight has its end before its start.
  it('skips a workout inside a logged walk that crosses midnight', () => {
    const lateWalk = workout('walking', at(23, 40), at(24, 20))
    const counted = { activityLogs: [{ date: day, startTime: '23:30:00', endTime: '00:30:00' }], sessions: [] }
    expect(ouraWorkoutActivities([lateWalk], counted, TZ)).toEqual([])
    const byDuration = { activityLogs: [{ date: day, startTime: '23:30:00', endTime: '00:30:00', durationMin: 60 }], sessions: [] }
    expect(ouraWorkoutActivities([lateWalk], byDuration, TZ)).toEqual([])
  })

  it('counts a workout that only touches a log end to end', () => {
    const counted = { activityLogs: [{ date: day, startTime: '11:00:00', endTime: '12:00:00' }], sessions: [] }
    expect(ouraWorkoutActivities([workout('cycling', at(12), at(12, 45))], counted, TZ)).toHaveLength(1)
  })
})

describe('Oura activity names against the MET table (#3087)', () => {
  it('matches camelCase Oura names to the table\'s words', () => {
    expect(metIdForActivityName('houseWork')).toBe(36)
    expect(metIdForActivityName('strengthTraining')).toBe(8)
    expect(metIdForActivityName('crossCountrySkiing')).toBe(3)
    expect(metIdForActivityName('hiit')).toBe(30)
  })

  it('names every on-foot Oura activity the way the MET table does', () => {
    expect(ON_FOOT_ACTIVITIES.filter(a => metIdForActivityName(a) == null)).toEqual([])
  })

  it('finds nothing for a name the table does not use', () => {
    expect(metIdForActivityName('americanFootball')).toBeNull()
    expect(metIdForActivityName('')).toBeNull()
  })
})

describe('Oura workouts in computeActiveEnergy (#3087)', () => {
  const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }

  it('an unnamed Oura activity earns nothing rather than the generic fallback', () => {
    const r = computeActiveEnergy({
      profile, strengthSessions: [], pedometerSteps: null,
      activities: [{ activityType: 'americanFootball', unmappedActivity: 'american football', durationMin: 60 }],
    })
    expect(r.activityKcal).toBe(0)
  })

  it('an on-foot Oura activity takes its steps back out at walking cadence', () => {
    const [tennis] = ouraWorkoutActivities([workout('tennis', at(12), at(12, 40))], none, TZ)
    const r = computeActiveEnergy({ profile, strengthSessions: [], pedometerSteps: 9_000, activities: [tennis] })
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, 9_000 - 40 * WALKING_CADENCE_SPM))
  })

  it('an Oura ride leaves the step term alone', () => {
    const [ride] = ouraWorkoutActivities([workout('cycling', at(12), at(12, 40))], none, TZ)
    const r = computeActiveEnergy({ profile, strengthSessions: [], pedometerSteps: 9_000, activities: [ride] })
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, 9_000))
  })

  it('an Oura walk takes its steps back out of the passive term, as a logged walk does', () => {
    const [walk] = ouraWorkoutActivities([workout('walking', at(12), at(12, 30), { distanceM: 2_000 })], none, TZ)
    const r = computeActiveEnergy({ profile, strengthSessions: [], pedometerSteps: 9_000, activities: [walk] })
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, 9_000 - 2 * 1_300))
  })
})

// #3853: how a logged activity becomes the window the source's copy is matched against.
describe('movementWindows (#3853)', () => {
  const none = { sessions: [] as CountedMovement['sessions'] }
  const log = (over: Record<string, unknown>) => ({ date: day, startTime: '07:00', endTime: '07:00', durationMin: null, ...over })
  const minutes = (w: [number, number] | undefined) => (w![1] - w![0]) / 60_000
  it('reads an end equal to the start with a duration as start + duration, as before', () => {
    const w = movementWindows({ ...none, activityLogs: [log({ durationMin: 45 })] }, TZ)
    expect(w).toHaveLength(1)
    expect(minutes(w[0])).toBe(45)
    // So the source copy of that workout is still matched, not counted twice.
    const sourced = ouraActivitySessions([{ day, activity: 'running', distanceM: null, reviewed: false, startDatetime: at(7, 5), endDatetime: at(7, 40) }])
    expect(sourceSessionActivities(sourced, { ...none, activityLogs: [log({ durationMin: 45 })] }, TZ)).toEqual([])
  })
  it('gives an end equal to the start with no usable duration no window', () => {
    expect(movementWindows({ ...none, activityLogs: [log({}), log({ durationMin: 0 })] }, TZ)).toEqual([])
  })
  it('keeps an overnight log and drops a mistyped rolled span with no duration', () => {
    const w = movementWindows({ ...none, activityLogs: [log({ startTime: '23:30', endTime: '00:30' }), log({ startTime: '15:50', endTime: '15:40' })] }, TZ)
    expect(w).toHaveLength(1)
    expect(minutes(w[0])).toBe(60)
  })
})
