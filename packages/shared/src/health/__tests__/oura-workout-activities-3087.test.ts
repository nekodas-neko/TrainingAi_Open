// #3087: Oura's own workouts were missing from the energy budget. These pin which ones now count,
// how they are typed, and that nothing already counted is paid for twice.
import { describe, it, expect } from 'vitest'
import { ouraWorkoutActivities, type OuraWorkoutRow } from '../oura-workout-activities'
import { computeActiveEnergy, stepEnergyKcal, WALKING_CADENCE_SPM } from '../daily-energy'
import { metIdForOuraActivity, OURA_ON_FOOT_ACTIVITIES } from '../workout-energy'
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../../date-utils'

const TZ = 'Australia/Brisbane'
const day = shiftDateStr(todayInTz(TZ), -1)
// Anchored to local midday, so the local day cannot flip on a zone edge.
const at = (hour: number, min = 0) => new Date(dateStrMidnightInTz(day, TZ).getTime() + (hour * 60 + min) * 60_000)
const workout = (activity: string, from: Date, to: Date, over: Partial<OuraWorkoutRow> = {}): OuraWorkoutRow =>
  ({ activity, startDatetime: from, endDatetime: to, distanceM: null, reviewed: false, ...over })
const none = { activityLogs: [], sessions: [] }

describe('ouraWorkoutActivities (#3087)', () => {
  it('maps a ride to the app\'s cycle type, on the local day of its start, for its duration', () => {
    expect(ouraWorkoutActivities([workout('cycling', at(12), at(12, 45), { distanceM: 15_000 })], none, TZ))
      .toEqual([{ date: day, activityType: 'cycle', durationMin: 45, distanceKm: 15 }])
  })

  it('keeps an activity the app has no type for under its Oura name', () => {
    const [a] = ouraWorkoutActivities([workout('houseWork', at(12), at(12, 30))], none, TZ)
    expect(a).toMatchObject({ activityType: 'houseWork', ouraActivity: 'houseWork', durationMin: 30 })
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
    expect(metIdForOuraActivity('houseWork')).toBe(36)
    expect(metIdForOuraActivity('strengthTraining')).toBe(8)
    expect(metIdForOuraActivity('crossCountrySkiing')).toBe(3)
    expect(metIdForOuraActivity('hiit')).toBe(30)
  })

  it('names every on-foot Oura activity the way the MET table does', () => {
    expect(OURA_ON_FOOT_ACTIVITIES.filter(a => metIdForOuraActivity(a) == null)).toEqual([])
  })

  it('finds nothing for a name the table does not use', () => {
    expect(metIdForOuraActivity('americanFootball')).toBeNull()
    expect(metIdForOuraActivity('')).toBeNull()
  })
})

describe('Oura workouts in computeActiveEnergy (#3087)', () => {
  const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }

  it('an unnamed Oura activity earns nothing rather than the generic fallback', () => {
    const r = computeActiveEnergy({
      profile, strengthSessions: [], pedometerSteps: null,
      activities: [{ activityType: 'americanFootball', ouraActivity: 'americanFootball', durationMin: 60 }],
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
