import { describe, it, expect } from 'vitest'
import { activeEnergyForDay } from '../day-budget'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'

// #3266: a call in the middle of a session must not be credited as exercise. The day's budget costs
// a strength session from its span, so it takes the time the workout was paused out of it.
// The fixtures anchor the session to local midday, so the day filter cannot flip on a zone.

const profile = { ageYears: 33, weightKg: 82, sex: 'male' as const }
const TZ = 'Australia/Brisbane'
const DAY = '2026-10-14'
const startedAt = new Date(dateStrMidnightInTz(DAY, TZ).getTime() + 12 * 3_600_000)
const completedAt = new Date(startedAt.getTime() + 60 * 60_000)

function lift(pausedSec?: number | null) {
  return activeEnergyForDay({
    day: DAY, dayStartUtc: dateStrMidnightInTz(DAY, TZ), dayEndUtc: dateStrMidnightInTz(shiftDateStr(DAY, 1), TZ), profile,
    workouts: [{ id: 'lift', startedAt, completedAt, ...(pausedSec === undefined ? {} : { pausedSec }) }],
    avgBpmBySession: new Map(), activities: [], steps: null,
  })
}

describe('#3266 paused time is not exercise', () => {
  it('credits a paused session for the minutes it was under way', () => {
    const whole = lift().workoutKcal
    const paused = lift(1_200).workoutKcal
    expect(whole).toBeGreaterThan(0)
    expect(paused).toBeLessThan(whole)
    // 40 of the 60 minutes: the energy follows the duration, not some other term.
    expect(paused / whole).toBeCloseTo(40 / 60, 1)
  })

  it('leaves a session with no pause, or saved before pause existed, exactly as it was', () => {
    expect(lift(0).workoutKcal).toBe(lift().workoutKcal)
    expect(lift(null).workoutKcal).toBe(lift().workoutKcal)
  })
})
