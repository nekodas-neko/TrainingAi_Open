import { describe, it, expect } from 'vitest'
import { computeEveningReminderAction, computeWeeklyRecapReminderAction } from '../day-review-reminders'

describe('computeEveningReminderAction', () => {
  it('schedules 50 minutes before bedtime when nothing scheduled yet today', () => {
    const now = new Date('2026-07-06T10:00:00')
    const action = computeEveningReminderAction(22, 0, now, '2026-07-06', null)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(action.at.getHours()).toBe(21)
      expect(action.at.getMinutes()).toBe(10)
    }
  })

  it('skips if already scheduled today', () => {
    const now = new Date('2026-07-06T10:00:00')
    expect(computeEveningReminderAction(22, 0, now, '2026-07-06', '2026-07-06')).toEqual({ type: 'skip' })
  })

  it('skips if bedtime-minus-50min has already passed today', () => {
    const now = new Date('2026-07-06T23:00:00')
    expect(computeEveningReminderAction(22, 0, now, '2026-07-06', null)).toEqual({ type: 'skip' })
  })

  it('re-schedules on a new day even if a prior day was already scheduled', () => {
    const now = new Date('2026-07-07T10:00:00')
    const action = computeEveningReminderAction(22, 0, now, '2026-07-07', '2026-07-06')
    expect(action.type).toBe('schedule')
  })
})

describe('computeWeeklyRecapReminderAction', () => {
  it('schedules this week\'s Sunday 18:00 when checked mid-week', () => {
    const wednesday = new Date('2026-07-08T09:00:00') // a Wednesday
    const action = computeWeeklyRecapReminderAction(wednesday, null)
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') {
      expect(action.at.getDay()).toBe(0) // Sunday
      expect(action.at.getHours()).toBe(18)
      expect(action.sundayIso).toBe('2026-07-12')
    }
  })

  it('skips if already scheduled for this week\'s Sunday', () => {
    const wednesday = new Date('2026-07-08T09:00:00')
    expect(computeWeeklyRecapReminderAction(wednesday, '2026-07-12')).toEqual({ type: 'skip' })
  })

  it('skips once past 18:00 on the Sunday itself (missed window, not re-targeted)', () => {
    const sundayNight = new Date('2026-07-12T19:00:00')
    expect(computeWeeklyRecapReminderAction(sundayNight, null)).toEqual({ type: 'skip' })
  })

  it('re-targets the following Sunday once the calendar has moved past this week\'s', () => {
    const nextMonday = new Date('2026-07-13T09:00:00')
    const action = computeWeeklyRecapReminderAction(nextMonday, '2026-07-12')
    expect(action.type).toBe('schedule')
    if (action.type === 'schedule') expect(action.sundayIso).toBe('2026-07-19')
  })
})
