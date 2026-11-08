import { describe, it, expect } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'
import {
  bedtimeAt,
  dayReviewReminderAt,
  endOfDayMealReminderAt,
  hasUnloggedRequiredMeal,
  mealReminderText,
  mealWindowEndAt,
  supplementReminderAt,
  supplementReminderDue,
  supplementReminderText,
  weeklyRecapReminderAt,
} from '../reminders/daily-reminders'

// #3653: the rules both apps schedule from. Every instant is the user's wall clock in their zone.
const BNE = 'Australia/Brisbane'
const SYD = 'Australia/Sydney'
const local = (d: Date | null, tz: string) => (d ? formatInTimeZone(d, tz, 'yyyy-MM-dd HH:mm') : null)

describe('supplement reminders', () => {
  const s = { name: 'Creatine', active: true, reminderEnabled: true, reminderTime: '08:00', loggedToday: false }

  it('is due only while on, timed, still taken and not yet ticked', () => {
    expect(supplementReminderDue(s)).toBe(true)
    expect(supplementReminderDue({ ...s, loggedToday: true })).toBe(false)
    expect(supplementReminderDue({ ...s, reminderEnabled: false })).toBe(false)
    expect(supplementReminderDue({ ...s, reminderTime: null })).toBe(false)
    expect(supplementReminderDue({ ...s, active: false })).toBe(false)
  })

  it('fires at the stored time in the user\'s zone, whatever zone the phone is in', () => {
    expect(supplementReminderAt('2026-07-06', '08:00', BNE)?.toISOString()).toBe('2026-07-05T22:00:00.000Z')
    expect(supplementReminderAt('2026-07-06', '08:00', 'Europe/London')?.toISOString()).toBe('2026-07-06T07:00:00.000Z')
    expect(supplementReminderAt('2026-07-06', 'soon', BNE)).toBeNull()
  })

  it('keeps 08:00 across a DST change', () => {
    // Sydney moves to daylight time early on Sunday 5 Oct 2025: the offset is +10 the day before, +11 after.
    expect(local(supplementReminderAt('2025-10-04', '08:00', SYD), SYD)).toBe('2025-10-04 08:00')
    expect(local(supplementReminderAt('2025-10-05', '08:00', SYD), SYD)).toBe('2025-10-05 08:00')
    expect(supplementReminderAt('2025-10-04', '08:00', SYD)?.toISOString()).toBe('2025-10-03T22:00:00.000Z')
    expect(supplementReminderAt('2025-10-05', '08:00', SYD)?.toISOString()).toBe('2025-10-04T21:00:00.000Z')
  })

  it('uses the current app\'s words', () => {
    expect(supplementReminderText('Creatine')).toEqual({ title: 'Supplement reminder', body: "Don't forget to log Creatine!" })
  })
})

describe('meal reminders', () => {
  it('fires at the end of the window, 23:59 for one that runs to midnight', () => {
    expect(local(mealWindowEndAt('2026-07-06', 10, BNE), BNE)).toBe('2026-07-06 10:00')
    expect(local(mealWindowEndAt('2026-07-06', 24, BNE), BNE)).toBe('2026-07-06 23:59')
  })

  it('uses the current app\'s words', () => {
    expect(mealReminderText('🍳', 'Breakfast')).toEqual({ title: 'Meal reminder', body: "Don't forget to log 🍳 Breakfast!" })
  })

  it('asks before bed only while a required group has nothing logged', () => {
    const types = [{ id: 'b', required: true }, { id: 's', required: false }]
    expect(hasUnloggedRequiredMeal(types, new Set())).toBe(true)
    expect(hasUnloggedRequiredMeal(types, new Set(['b']))).toBe(false)
    expect(hasUnloggedRequiredMeal([{ id: 's', required: false }], new Set())).toBe(false)
  })
})

describe('bedtime reminders', () => {
  const bed = { bedtimeHour: 22, bedtimeMinute: 30 }

  it('counts back from bedtime: 30 min for meals, 50 for the day review', () => {
    expect(local(endOfDayMealReminderAt('2026-07-06', bed, BNE), BNE)).toBe('2026-07-06 22:00')
    expect(local(dayReviewReminderAt('2026-07-06', bed, BNE), BNE)).toBe('2026-07-06 21:40')
  })

  it('puts an after-midnight bedtime on the night that ends the day', () => {
    expect(local(bedtimeAt('2026-07-06', { bedtimeHour: 0, bedtimeMinute: 30 }, BNE), BNE)).toBe('2026-07-07 00:30')
    expect(local(endOfDayMealReminderAt('2026-07-06', { bedtimeHour: 0, bedtimeMinute: 15 }, BNE), BNE)).toBe('2026-07-06 23:45')
  })

  it('keeps the wall time on the DST day', () => {
    expect(local(dayReviewReminderAt('2025-10-05', { bedtimeHour: 22, bedtimeMinute: 0 }, SYD), SYD)).toBe('2025-10-05 21:10')
  })
})

describe('weekly recap', () => {
  it('is Sunday 18:00 on or after the day', () => {
    expect(weeklyRecapReminderAt('2026-07-08', BNE).sunday).toBe('2026-07-12')
    expect(weeklyRecapReminderAt('2026-07-12', BNE).sunday).toBe('2026-07-12')
    expect(local(weeklyRecapReminderAt('2026-07-08', BNE).at, BNE)).toBe('2026-07-12 18:00')
  })
})
