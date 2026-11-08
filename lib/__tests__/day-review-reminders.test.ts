import { describe, it, expect } from 'vitest'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { computeEveningReminderAction, computeWeeklyRecapReminderAction } from '../day-review-reminders'

// Every instant is a wall time in the user's zone, never the container's (LB-148, #3653).
const TZ = 'Australia/Brisbane'
const at = (local: string, tz = TZ) => fromZonedTime(local, tz)
const clock = (d: Date, tz = TZ) => formatInTimeZone(d, tz, 'EEE HH:mm')

describe('computeEveningReminderAction', () => {
  it('schedules 50 minutes before bedtime when nothing scheduled yet today', () => {
    const action = computeEveningReminderAction(22, 0, at('2026-07-06T12:00:00'), '2026-07-06', null, TZ)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(clock(action.at)).toBe('Mon 21:10')
  })

  it('skips if already scheduled today', () => {
    expect(computeEveningReminderAction(22, 0, at('2026-07-06T12:00:00'), '2026-07-06', '2026-07-06', TZ)).toEqual({ type: 'skip' })
  })

  it('skips if bedtime-minus-50min has already passed today', () => {
    expect(computeEveningReminderAction(22, 0, at('2026-07-06T23:00:00'), '2026-07-06', null, TZ)).toEqual({ type: 'skip' })
  })

  it('re-schedules on a new day even if a prior day was already scheduled', () => {
    const action = computeEveningReminderAction(22, 0, at('2026-07-07T12:00:00'), '2026-07-07', '2026-07-06', TZ)
    expect(action.type).toBe('schedule')
  })

  it('fires at the user\'s wall clock, not the phone\'s, in a zone with DST', () => {
    const tz = 'Australia/Sydney'
    // 5 Oct 2025 is the Sunday Sydney moves to daylight time; the evening is already AEDT.
    const action = computeEveningReminderAction(22, 0, at('2025-10-05T12:00:00', tz), '2025-10-05', null, tz)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(clock(action.at, tz)).toBe('Sun 21:10')
      expect(action.at.toISOString()).toBe('2025-10-05T10:10:00.000Z')
    }
  })

  it('puts an after-midnight bedtime on the night that ends today, not this morning', () => {
    const action = computeEveningReminderAction(0, 30, at('2026-07-06T12:00:00'), '2026-07-06', null, TZ)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(clock(action.at)).toBe('Mon 23:40')
  })
})

describe('computeWeeklyRecapReminderAction', () => {
  it('schedules this week\'s Sunday 18:00 when checked mid-week', () => {
    const action = computeWeeklyRecapReminderAction(at('2026-07-08T12:00:00'), null, TZ) // a Wednesday
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(clock(action.at)).toBe('Sun 18:00')
      expect(action.sundayIso).toBe('2026-07-12')
    }
  })

  it('skips if already scheduled for this week\'s Sunday', () => {
    expect(computeWeeklyRecapReminderAction(at('2026-07-08T12:00:00'), '2026-07-12', TZ)).toEqual({ type: 'skip' })
  })

  it('skips once past 18:00 on the Sunday itself (missed window, not re-targeted)', () => {
    expect(computeWeeklyRecapReminderAction(at('2026-07-12T19:00:00'), null, TZ)).toEqual({ type: 'skip' })
  })

  it('re-targets the following Sunday once the calendar has moved past this week\'s', () => {
    const action = computeWeeklyRecapReminderAction(at('2026-07-13T12:00:00'), '2026-07-12', TZ)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(action.sundayIso).toBe('2026-07-19')
  })

  it('reads the day in the user\'s zone: Sunday 07:00 in Brisbane is still Saturday in UTC', () => {
    const action = computeWeeklyRecapReminderAction(at('2026-07-12T07:00:00'), null, TZ)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(action.sundayIso).toBe('2026-07-12')
  })
})
