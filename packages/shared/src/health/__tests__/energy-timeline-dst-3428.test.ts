// #3428: the day-log HR trace is on the clock face, so a meal must land on the clock hour it was eaten in
// too, or on a Sydney 23- or 25-hour day the intake bars sit an hour away from the burn they are drawn against.
import { describe, it, expect } from 'vitest'
import { buildEnergyTimeline } from '../energy-timeline'
import { dateStrMidnightInTz } from '../../date-utils'

const TZ = 'Australia/Sydney'
const HOUR = 3_600_000
const BASE = { restingHr: 60, restingBaseKcal: 1_680, activeKcal: 480, hr: [] }

function bucketOfMeal(day: string, elapsedHours: number, tz?: string) {
  const dayStartMs = dateStrMidnightInTz(day, TZ).getTime()
  const t = buildEnergyTimeline({
    ...BASE, dayStartMs, ...(tz ? { tz } : {}),
    intake: [{ atMs: dayStartMs + elapsedHours * HOUR + 30 * 60_000, kcal: 500 }],
  })
  return t.buckets.findIndex(b => b.intakeKcal > 0)
}

describe('buildEnergyTimeline on a daylight-saving day (#3428)', () => {
  it('puts a meal after the change on its clock hour on a 25-hour day (2027-04-04)', () => {
    // 5.5 h after midnight is 04:30 on the clock (the 2:00 hour happened twice).
    expect(bucketOfMeal('2027-04-04', 5, TZ)).toBe(4)
    expect(bucketOfMeal('2027-04-04', 5)).toBe(5) // elapsed, as before, when no zone is given
  })

  it('keeps a meal in the last hour of a 25-hour day', () => {
    expect(bucketOfMeal('2027-04-04', 24, TZ)).toBe(23) // 23:30; elapsed minute 1470 would be dropped
  })

  it('puts a meal after the change on its clock hour on a 23-hour day (2026-10-04)', () => {
    // 4.5 h after midnight is 05:30 on the clock (the clock skipped 02:00–03:00).
    expect(bucketOfMeal('2026-10-04', 4, TZ)).toBe(5)
  })

  it('does not take the next day\'s first hour into a 23-hour day', () => {
    expect(bucketOfMeal('2026-10-04', 23, TZ)).toBe(-1) // 00:30 on the 5th
  })
})
