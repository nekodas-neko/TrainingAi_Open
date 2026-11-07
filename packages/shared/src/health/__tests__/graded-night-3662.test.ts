// #3662 — one picker for "a date's main night", the one the Sleep score and the sleep card use.
// Four readers each had their own rule (first row with a source id, last write wins, every period),
// so a date with an overnight and a long daytime rest, or a split night, read differently on each.
// Synthetic windows only.
import { describe, it, expect } from 'vitest'
import { gradedNightForDate, canonicalNightsByDate, nightSessions } from '../sleep-night'
import { scoreSleepForDate } from '../sleep-score-for-date'
import type { SleepSession } from '../../types/body'

const TZ = 'Australia/Brisbane'
const bne = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+10:00`)
const row = (id: string, date: string, start: Date, end: Date, hours: number): SleepSession => ({
  id, userId: 'u', date, sleepStart: start, sleepEnd: end, durationHours: hours, createdAt: end, ouraId: id,
})

const night = row('night', '2026-09-23', bne('2026-09-22', '21:27'), bne('2026-09-23', '06:01'), 7.92)
const rest = row('rest', '2026-09-23', bne('2026-09-23', '10:42'), bne('2026-09-23', '17:25'), 6.17)

describe('gradedNightForDate (#3662)', () => {
  it('takes the overnight over a long daytime rest, in either order', () => {
    for (const rows of [[rest, night], [night, rest]]) {
      const picked = gradedNightForDate(rows, '2026-09-23', TZ)
      expect(picked?.sleepEnd).toEqual(night.sleepEnd)
      expect(picked?.durationHours).toBeCloseTo(7.92, 5)
    }
  })

  it('joins a split night into the one night the score grades', () => {
    const a = row('a', '2026-09-24', bne('2026-09-23', '22:30'), bne('2026-09-24', '02:00'), 3.5)
    const b = row('b', '2026-09-24', bne('2026-09-24', '03:30'), bne('2026-09-24', '07:15'), 3.75)
    const picked = gradedNightForDate([a, b], '2026-09-24', TZ)
    expect(picked?.sleepStart).toEqual(a.sleepStart)
    expect(picked?.sleepEnd).toEqual(b.sleepEnd)
    expect(picked?.durationHours).toBeCloseTo(7.25, 5)
  })

  it('is the night scoreSleepForDate scores', () => {
    const rows = [rest, night]
    expect(gradedNightForDate(rows, '2026-09-23', TZ)).toEqual(scoreSleepForDate(rows, '2026-09-23', TZ)?.night ?? null)
  })

  it('has no night for a date with only a nap', () => {
    const nap = row('nap', '2026-09-25', bne('2026-09-25', '14:00'), bne('2026-09-25', '14:40'), 0.67)
    expect(gradedNightForDate([nap], '2026-09-25', TZ)).toBeNull()
  })
})

describe('canonicalNightsByDate (#3662)', () => {
  it('returns one night per date, the graded one', () => {
    const other = row('n2', '2026-09-24', bne('2026-09-23', '22:00'), bne('2026-09-24', '06:00'), 8)
    const byDate = canonicalNightsByDate(nightSessions([rest, night, other], TZ), TZ)
    expect(byDate.map(n => n.date)).toEqual(['2026-09-23', '2026-09-24'])
    expect(byDate[0].sleepEnd).toEqual(night.sleepEnd)
  })
})
