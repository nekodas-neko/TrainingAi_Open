import { describe, it, expect } from 'vitest'
import { computeActiveEnergy, stepEnergyKcal, STEPS_PER_KM, WALKING_CADENCE_SPM } from '../daily-energy'
import { activeEnergyForDay } from '../../nutrition/day-budget'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'

// #3082: a walk detected from the ring's MET and saved by the owner was paid twice — its MET kcal as
// a logged activity, and its steps again inside the day's pedometer total — because the steps
// already inside a logged walk were only subtracted when it had a distance, and a detected walk is
// saved with none (`exercise-review-sheet.tsx`). The fixtures are the three rows the issue names.

const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }
const TZ = 'Australia/Brisbane'
const DAY = '2026-10-14'
// Anchored to local midday, not to UTC or to midnight, so the day filter cannot flip on a zone.
const midday = (day: string) => new Date(dateStrMidnightInTz(day, TZ).getTime() + 12 * 3_600_000)

// What `exercise-review-sheet.tsx` saves for a ring walk: duration, no distance, no steps.
const detectedWalk = { date: DAY, activityType: 'walk', durationMin: 22, distanceKm: null, steps: null }
const manualWalk = { date: DAY, activityType: 'walk', durationMin: 40, distanceKm: 3, steps: null }
const cycle = { date: DAY, activityType: 'cycle', durationMin: 30, distanceKm: 9, steps: null }

const PEDOMETER = 9_000

function day(activities: { date: string; activityType: string; durationMin: number | null; distanceKm: number | null; steps: number | null }[]) {
  return activeEnergyForDay({
    day: DAY, dayStartUtc: dateStrMidnightInTz(DAY, TZ), dayEndUtc: dateStrMidnightInTz(shiftDateStr(DAY, 1), TZ), profile,
    workouts: [{ id: 'lift', startedAt: midday(DAY), completedAt: new Date(midday(DAY).getTime() + 45 * 60_000) }],
    avgBpmBySession: new Map(), activities, steps: PEDOMETER,
  })
}

describe('#3082 a saved detected walk is not counted twice', () => {
  it('removes a detected walk\'s duration-estimated steps from the passive step term', () => {
    const r = day([detectedWalk])
    expect(r.activityKcal).toBeGreaterThan(0)
    // The walk's own 22 min at walking cadence come out of the pedometer total, and only those.
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER - 22 * WALKING_CADENCE_SPM))
    expect(r.stepsKcal).toBeLessThan(stepEnergyKcal(profile, PEDOMETER))
  })

  it('still uses the distance for a manual walk that has one, not its duration', () => {
    const r = day([manualWalk])
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER - 3 * STEPS_PER_KM))
  })

  it('leaves the step term alone for an activity whose steps never reach the pedometer', () => {
    const r = day([cycle])
    expect(r.activityKcal).toBeGreaterThan(0)
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER))
  })

  it('subtracts all three together as the sum of their parts', () => {
    const r = day([detectedWalk, manualWalk, cycle])
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER - 22 * WALKING_CADENCE_SPM - 3 * STEPS_PER_KM))
  })

  it('prefers a row\'s stored steps over its distance or duration', () => {
    const r = day([{ ...manualWalk, steps: 4_200 }])
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER - 4_200))
  })

  it('ignores an activity filed under another day', () => {
    const r = day([{ ...detectedWalk, date: '2026-10-13' }])
    expect(r.activityKcal).toBe(0)
    expect(r.stepsKcal).toBe(stepEnergyKcal(profile, PEDOMETER))
  })

  it('never takes the step term below zero when the walk out-steps the pedometer', () => {
    const r = computeActiveEnergy({
      profile, strengthSessions: [], pedometerSteps: 1_000,
      activities: [{ activityType: 'walk', durationMin: 60, distanceKm: null }],
    })
    expect(r.stepsKcal).toBe(0)
  })
})
