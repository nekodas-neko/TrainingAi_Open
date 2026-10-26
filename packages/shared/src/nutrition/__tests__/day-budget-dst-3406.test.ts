// #3406: `activeEnergyForDay` ended the day at `dayStartUtc + 86_400_000`, an hour off on a Sydney
// 23-hour or 25-hour day. The caller now passes the next local midnight.
import { describe, it, expect } from 'vitest'
import { activeEnergyForDay } from '../day-budget'
import { dateStrMidnightInTz, shiftDateStr } from '../../date-utils'

const TZ = 'Australia/Sydney'
const HOUR = 3_600_000
const profile = { ageYears: 33, weightKg: 80, sex: 'male' as const }

function kcalFor(day: string, startedAt: Date) {
  return activeEnergyForDay({
    day,
    dayStartUtc: dateStrMidnightInTz(day, TZ),
    dayEndUtc: dateStrMidnightInTz(shiftDateStr(day, 1), TZ),
    profile,
    workouts: [{ id: 'lift', startedAt, completedAt: new Date(startedAt.getTime() + HOUR) }],
    avgBpmBySession: new Map(),
    activities: [],
    steps: null,
  }).workoutKcal
}

describe('#3406 a daylight-saving day ends at the next local midnight', () => {
  it('keeps a session in the last hour of a 25-hour day (2027-04-04)', () => {
    const next = dateStrMidnightInTz('2027-04-05', TZ)
    // 23:30 local on the 25-hour day is 24.5 h after its midnight: past `start + 24 h`.
    expect(kcalFor('2027-04-04', new Date(next.getTime() - 30 * 60_000))).toBeGreaterThan(0)
  })

  it('does not take the next day\'s first hour into a 23-hour day (2026-10-04)', () => {
    const next = dateStrMidnightInTz('2026-10-05', TZ)
    // 00:30 on the 5th is 23.5 h after the 4th's midnight: before `start + 24 h`, but the 5th's.
    expect(kcalFor('2026-10-04', new Date(next.getTime() + 30 * 60_000))).toBe(0)
  })
})
