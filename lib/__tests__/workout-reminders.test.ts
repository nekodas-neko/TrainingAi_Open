import { describe, it, expect } from 'vitest'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { computeWorkoutReminderAction, type WorkoutReminderAction } from '../workout-reminders'

const SESSION = 'Push'

// A wall-clock time in the USER's zone, not the device's. This helper used to call setHours,
// which is device-local — the same bug the implementation had, so the two agreed (LB-148).
const TZ = 'Australia/Brisbane'
const at = (hour: number, minute = 0): Date =>
  fromZonedTime(`2026-06-17T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`, TZ)
const hhmm = (d: Date) => formatInTimeZone(d, TZ, 'HH:mm')

describe('computeWorkoutReminderAction', () => {
  it('returns cancel when not a training day', () => {
    expect(computeWorkoutReminderAction(false, SESSION, true, '18:00')).toEqual({ type: 'cancel' })
  })

  it('returns cancel when reminder is disabled', () => {
    expect(computeWorkoutReminderAction(true, SESSION, false, '18:00')).toEqual({ type: 'cancel' })
  })

  it('returns cancel when reminder time is null', () => {
    expect(computeWorkoutReminderAction(true, SESSION, true, null)).toEqual({ type: 'cancel' })
  })

  it('returns cancel when sessionName is undefined', () => {
    expect(computeWorkoutReminderAction(true, undefined, true, '18:00')).toEqual({ type: 'cancel' })
  })

  it('schedules a future notification when before reminder time', () => {
    const now = at(14, 0)  // 2pm, reminder at 6pm
    const action = computeWorkoutReminderAction(true, SESSION, true, '18:00', now) as { type: 'schedule'; at: Date; sessionName: string }
    expect(action.type).toBe('schedule')
    expect(action.sessionName).toBe('Push')
    expect(hhmm(action.at)).toBe('18:00')
  })

  it('fires immediate notification when reminder time has already passed', () => {
    const now = at(20, 0)  // 8pm, reminder was at 6pm
    const action = computeWorkoutReminderAction(true, SESSION, true, '18:00', now, false)
    expect(action).toEqual({ type: 'immediate', sessionName: 'Push' })
  })

  it('skips when already notified today', () => {
    const now = at(20, 0)
    const action = computeWorkoutReminderAction(true, SESSION, true, '18:00', now, true)
    expect(action).toEqual({ type: 'skip' })
  })

  it('schedules correctly with non-zero minutes in reminder time', () => {
    const now = at(9, 30)  // 9:30am, reminder at 9:45am
    const action = computeWorkoutReminderAction(true, SESSION, true, '09:45', now) as { type: 'schedule'; at: Date }
    expect(action.type).toBe('schedule')
    expect(hhmm(action.at)).toBe('09:45')
  })
})
