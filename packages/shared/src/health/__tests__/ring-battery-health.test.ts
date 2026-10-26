import { describe, it, expect } from 'vitest'
import { dailyDrain, summariseRingBattery, type RingBatteryReading } from '../ring-battery-health'

const TZ = 'Australia/Brisbane'
const H = 3_600_000
// Local midnight in Brisbane (UTC+10, no DST) on 2026-10-10.
const D0 = Date.UTC(2026, 9, 9, 14, 0, 0)

/** One reading every 2 h from `startHour`, falling `perHour` points an hour from `from`. */
function fall(startHour: number, hours: number, from: number, perHour: number): RingBatteryReading[] {
  const out: RingBatteryReading[] = []
  for (let h = 0; h <= hours; h += 2) out.push({ tsMs: D0 + (startHour + h) * H, percent: Math.round(from - perHour * h), charging: false })
  return out
}

describe('dailyDrain', () => {
  it('gives drain per 24 h from the falls inside a day', () => {
    // 100 -> 76 over 24 h of two-hourly readings: 1 point an hour.
    const days = dailyDrain(fall(0, 24, 100, 1), TZ)
    expect(days.map(d => d.day)).toContain('2026-10-10')
    expect(days.find(d => d.day === '2026-10-10')!.drainPct).toBeCloseTo(24, 0)
  })

  it('leaves out a day with less than the minimum off-charger time', () => {
    expect(dailyDrain(fall(0, 6, 100, 1), TZ)).toEqual([])
  })

  it('does not count a gap too long to tell, a charge, or a charging reading', () => {
    const r: RingBatteryReading[] = [
      { tsMs: D0, percent: 90, charging: false },
      { tsMs: D0 + 12 * H, percent: 50, charging: false }, // 12 h gap
      { tsMs: D0 + 14 * H, percent: 80, charging: false }, // a rise
      { tsMs: D0 + 16 * H, percent: 70, charging: true },
    ]
    expect(dailyDrain(r, TZ)).toEqual([])
  })

  it('ignores readings outside 0..100', () => {
    expect(dailyDrain([{ tsMs: D0, percent: 140, charging: false }, { tsMs: D0 + H, percent: 100, charging: false }], TZ)).toEqual([])
  })
})

describe('summariseRingBattery', () => {
  // Four days at 1 point an hour, charged back to 100 each night, ending 2026-10-13 12:00.
  const readings: RingBatteryReading[] = []
  for (let day = 0; day < 4; day++) {
    for (let h = 0; h < 24; h += 2) readings.push({ tsMs: D0 + (day * 24 + h) * H, percent: 100 - h, charging: false })
  }
  const now = D0 + (3 * 24 + 22) * H

  it('derives drain, days left, the charge gap and the last charge', () => {
    const s = summariseRingBattery(readings, TZ, now)
    expect(s.drainPerDayPct).toBeCloseTo(24, 0)
    expect(s.latest).toMatchObject({ percent: 78, charging: false, ageMinutes: 0 })
    expect(s.daysBetweenCharges).toBeCloseTo(1, 1)
    expect(s.daysLeft).toBeCloseTo(78 / 24, 1)
    expect(s.lastChargedMs).not.toBeNull()
    expect(s.series.length).toBeGreaterThanOrEqual(3)
  })

  it('reports the age of the newest reading and no days left while charging', () => {
    const s = summariseRingBattery([...readings, { tsMs: now + H, percent: 40, charging: true }], TZ, now + H + 30 * 60_000)
    expect(s.latest).toMatchObject({ charging: true, ageMinutes: 30 })
    expect(s.daysLeft).toBeNull()
  })

  it('has nothing to say without readings, and no drain from fewer than three days', () => {
    expect(summariseRingBattery([], TZ, now)).toMatchObject({ latest: null, drainPerDayPct: null, daysLeft: null, series: [] })
    expect(summariseRingBattery(fall(0, 24, 100, 1), TZ, now).drainPerDayPct).toBeNull()
  })
})
