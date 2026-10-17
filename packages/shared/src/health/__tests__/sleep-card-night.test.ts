import { describe, expect, it } from 'vitest'
import { pickSleepCardNight, sleepNightDateLabel } from '../sleep-card-night'

const row = (date: string, id = date) => ({ date, id })

describe('pickSleepCardNight', () => {
  it('shows the night dated today', () => {
    const r = pickSleepCardNight([row('2026-10-18'), row('2026-10-17')], '2026-10-18')
    expect(r.night?.date).toBe('2026-10-18')
    expect(r.label).toBe('Night ending 18 Oct')
  })

  it('falls back to yesterday when today has no night yet', () => {
    const r = pickSleepCardNight([row('2026-10-17'), row('2026-10-15')], '2026-10-18')
    expect(r.night?.date).toBe('2026-10-17')
    expect(r.label).toBe('Night ending 17 Oct')
  })

  it('does not depend on row order', () => {
    const r = pickSleepCardNight([row('2026-10-15'), row('2026-10-18'), row('2026-10-17')], '2026-10-18')
    expect(r.night?.date).toBe('2026-10-18')
  })

  it('does not show an older night as current and says when it was', () => {
    const r = pickSleepCardNight([row('2026-10-15')], '2026-10-18')
    expect(r.night).toBeNull()
    expect(r.label).toBe('Last recorded 15 Oct')
  })

  it('ignores a row dated after today', () => {
    const r = pickSleepCardNight([row('2026-10-19'), row('2026-10-17')], '2026-10-18')
    expect(r.night?.date).toBe('2026-10-17')
  })

  it('handles an empty list and month boundaries', () => {
    expect(pickSleepCardNight([], '2026-10-18')).toEqual({ night: null, label: 'No night recorded' })
    expect(pickSleepCardNight([row('2026-09-30')], '2026-10-01').night?.date).toBe('2026-09-30')
  })

  it('formats the date label without a timezone', () => {
    expect(sleepNightDateLabel('2026-01-05')).toBe('5 Jan')
    expect(sleepNightDateLabel('garbage')).toBe('garbage')
  })
})
