import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '../../date-utils'
import { pickSleepCardNight, sleepNightDateLabel } from '../sleep-card-night'

const TZ = 'Australia/Brisbane' // UTC+10, no DST

// Brisbane wall-clock `HH:mm` on `day` as an ISO instant.
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+10:00`).toISOString()
const shift = shiftDateStr

/** A night that ended on `date`: 22:30 the evening before to 06:30 (8 h). */
const night = (date: string, id = date) => ({
  id, date, sleepStart: at(shift(date, -1), '22:30'), sleepEnd: at(date, '06:30'), durationHours: 8,
})
/** A daytime nap on `date`. */
const nap = (date: string, id = `nap-${date}`) => ({
  id, date, sleepStart: at(date, '14:00'), sleepEnd: at(date, '14:40'), durationHours: 0.67,
})
/** A one-hour bout on the evening of `date`, which the band calls night but is not that date's night. */
const eveningBout = (date: string, id = `eve-${date}`) => ({
  id, date, sleepStart: at(date, '21:30'), sleepEnd: at(date, '22:30'), durationHours: 1,
})

interface TestRow { id: string; date: string; sleepStart: string | null; sleepEnd: string | null; durationHours: number }
const pick = (rows: TestRow[], today = '2026-10-18') =>
  pickSleepCardNight(rows, today, TZ)

describe('pickSleepCardNight', () => {
  it('shows the night dated today', () => {
    const r = pick([night('2026-10-18'), night('2026-10-17')])
    expect(r.night?.date).toBe('2026-10-18')
    expect(r.label).toBe('Night ending 18 Oct')
  })

  it('falls back to yesterday when today has no night yet', () => {
    const r = pick([night('2026-10-17'), night('2026-10-15')])
    expect(r.night?.date).toBe('2026-10-17')
    expect(r.label).toBe('Night ending 17 Oct')
  })

  it('does not depend on row order', () => {
    const r = pick([night('2026-10-15'), night('2026-10-18'), night('2026-10-17')])
    expect(r.night?.date).toBe('2026-10-18')
  })

  it('does not show an older night as current and says when it was', () => {
    const r = pick([night('2026-10-15')])
    expect(r.night).toBeNull()
    expect(r.label).toBe('Last recorded 15 Oct')
  })

  it('ignores a row dated after today', () => {
    const r = pick([night('2026-10-19'), night('2026-10-17')])
    expect(r.night?.date).toBe('2026-10-17')
  })

  it('shows a wake after midnight dated today', () => {
    const early = { id: 'early', date: '2026-10-18', sleepStart: at('2026-10-18', '00:30'), sleepEnd: at('2026-10-18', '05:00'), durationHours: 4.5 }
    expect(pick([early, night('2026-10-17')]).night?.id).toBe('early')
  })

  it('handles an empty list and month boundaries', () => {
    expect(pick([])).toEqual({ night: null, label: 'No night recorded' })
    expect(pick([night('2026-09-30')], '2026-10-01').night?.date).toBe('2026-09-30')
  })

  it('takes a row with no times as a night, since it cannot be told from one', () => {
    const untimed = { id: 'manual', date: '2026-10-18', sleepStart: null, sleepEnd: null, durationHours: 7 }
    expect(pick([untimed, night('2026-10-17')]).night?.id).toBe('manual')
  })

  describe('a nap or a short evening bout is not a night (the canonical rule in sleep-night.ts)', () => {
    it('passes a nap today over for yesterday\'s night', () => {
      const r = pick([nap('2026-10-18'), night('2026-10-17')])
      expect(r.night?.id).toBe('2026-10-17')
      expect(r.label).toBe('Night ending 17 Oct')
    })

    it('passes a one-hour evening bout today over for yesterday\'s night', () => {
      const r = pick([eveningBout('2026-10-18'), night('2026-10-17')])
      expect(r.night?.id).toBe('2026-10-17')
      expect(r.label).toBe('Night ending 17 Oct')
    })

    it('with only a nap, shows no night rather than captioning the nap', () => {
      const r = pick([nap('2026-10-18')])
      expect(r.night).toBeNull()
      expect(r.label).toBe('No night recorded')
    })

    it('with only an evening bout, shows no night', () => {
      const r = pick([eveningBout('2026-10-18')])
      expect(r.night).toBeNull()
      expect(r.label).toBe('No night recorded')
    })

    it('says "Last recorded" for the stale real night when only a nap is recent', () => {
      const r = pick([nap('2026-10-18'), night('2026-10-14')])
      expect(r.night).toBeNull()
      expect(r.label).toBe('Last recorded 14 Oct')
    })

    it('still prefers today\'s real night over a nap the same day', () => {
      expect(pick([nap('2026-10-18'), night('2026-10-18'), night('2026-10-17')]).night?.id).toBe('2026-10-18')
    })
  })

  it('formats the date label without a timezone, through the shared formatter', () => {
    expect(sleepNightDateLabel('2026-01-05')).toBe('5 Jan')
    expect(sleepNightDateLabel('2026-10-18')).toBe('18 Oct')
    expect(sleepNightDateLabel('2026-09-15')).toBe('15 Sept')
    expect(sleepNightDateLabel('garbage')).toBe('garbage')
  })
})
