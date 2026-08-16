import { describe, it, expect } from 'vitest'
import { computeMovedHours, moveHoursGoal } from '../hourly-movement'

const TZ = 'Australia/Brisbane' // UTC+10, no DST
const DAY = '2026-07-22'
// Brisbane local hour H → UTC timestamp on DAY (UTC+10, so local H = UTC (H-10), wrapping to prev day for H<10).
function atLocalHour(hour: number, minute = 0): Date {
  const utcHour = hour - 10
  if (utcHour >= 0) return new Date(`2026-07-22T${String(utcHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
  return new Date(`2026-07-21T${String(utcHour + 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
}

describe('computeMovedHours', () => {
  it('counts a distinct local hour as moved when HR exceeds the rest threshold', () => {
    // maxHr 190, restingHr 50 → reserve 140. HR_REST_THRESHOLD is 0.05 of reserve ≈ 7bpm above rest.
    const hrRows = [
      { timestamp: atLocalHour(9, 5), bpm: 65 },   // hrr = 15/140 ≈ 0.107 > 0.05 → moved
      { timestamp: atLocalHour(9, 30), bpm: 52 },  // hrr ≈ 0.014 → at rest, doesn't re-count the hour
      { timestamp: atLocalHour(14, 10), bpm: 120 }, // clearly moved
    ]
    const moved = computeMovedHours({ hrRows, maxHr: 190, restingHr: 50, tz: TZ, dateIso: DAY })
    expect(moved).toBe(2) // hours 9 and 14
  })

  it('does not count a purely resting hour', () => {
    // Hour 11, not 3: since Q-188 the count is restricted to waking hours, so a 3am fixture would
    // return 0 for the WRONG reason and would still pass with the rest threshold broken.
    const hrRows = [{ timestamp: atLocalHour(11, 0), bpm: 51 }] // hrr ≈ 0.007, at rest
    expect(computeMovedHours({ hrRows, maxHr: 190, restingHr: 50, tz: TZ, dateIso: DAY })).toBe(0)
  })

  it('excludes readings from a different local day', () => {
    const hrRows = [{ timestamp: atLocalHour(9, 5), bpm: 120 }]
    expect(computeMovedHours({ hrRows, maxHr: 190, restingHr: 50, tz: TZ, dateIso: '2026-07-21' })).toBe(0)
  })

  it('returns 0 for an empty series (an honest zero, not fabricated)', () => {
    expect(computeMovedHours({ hrRows: [], maxHr: 190, restingHr: 50, tz: TZ, dateIso: DAY })).toBe(0)
  })
})

describe('moveHoursGoal', () => {
  it('defaults to a 15-hour waking window (7am–10pm)', () => {
    expect(moveHoursGoal()).toBe(15)
  })
  it('respects custom wake/sleep hours, floored at 1', () => {
    expect(moveHoursGoal(6, 23)).toBe(17)
    expect(moveHoursGoal(10, 10)).toBe(1)
  })
})

// Q-188 (2026-08-11): `computeMovedHours` counted any hour in 0–23 while `moveHoursGoal()` divided
// by `sleepHour − wakeHour`. Numerator and denominator measured different windows, so the ratio was
// structurally ≥ 1 and the contributor (weight 12) pinned at 100 whatever the goal was — it could
// never carry information. `wakeHour`/`sleepHour` were already on the input type and simply unread.
describe('moved hours and the goal measure the same window (Q-188)', () => {
  // Awake every hour 0–23, HR clearly above rest. Before the fix this returned 24 against a goal
  // of 15 — the shape that made the contributor a constant.
  const allDayRows = Array.from({ length: 24 }, (_, h) => ({ timestamp: atLocalHour(h, 30), bpm: 120 }))
  const base = { maxHr: 190, restingHr: 50, tz: TZ, dateIso: DAY }

  it('never counts more hours than the goal asks for — the invariant that was violated', () => {
    // The property, not the number: this is what would have caught the original bug, and it holds
    // for any wake/sleep pair because both sides use the same half-open [wake, sleep) window.
    for (const [wakeHour, sleepHour] of [[7, 22], [6, 23], [9, 17], [0, 24], [22, 23]] as const) {
      const moved = computeMovedHours({ ...base, hrRows: allDayRows, wakeHour, sleepHour })
      expect(moved).toBeLessThanOrEqual(moveHoursGoal(wakeHour, sleepHour))
    }
  })

  it('ignores movement outside waking hours', () => {
    // 3am and 5am are real movement, but not toward a daytime goal.
    const nightOnly = [
      { timestamp: atLocalHour(3, 0), bpm: 120 },
      { timestamp: atLocalHour(5, 0), bpm: 130 },
    ]
    expect(computeMovedHours({ ...base, hrRows: nightOnly })).toBe(0)
  })

  it('counts the boundaries the goal counts: wake inclusive, sleep exclusive', () => {
    const atWake  = [{ timestamp: atLocalHour(7, 0), bpm: 120 }]
    const atSleep = [{ timestamp: atLocalHour(22, 0), bpm: 120 }]
    expect(computeMovedHours({ ...base, hrRows: atWake,  wakeHour: 7, sleepHour: 22 })).toBe(1)
    expect(computeMovedHours({ ...base, hrRows: atSleep, wakeHour: 7, sleepHour: 22 })).toBe(0)
  })

  it('a fully active waking day reaches the goal exactly, and no further', () => {
    const moved = computeMovedHours({ ...base, hrRows: allDayRows, wakeHour: 7, sleepHour: 22 })
    expect(moved).toBe(moveHoursGoal(7, 22)) // 15 of 15 — 100%, not 160%
  })
})
