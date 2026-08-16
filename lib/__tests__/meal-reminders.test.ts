import { describe, it, expect } from 'vitest'
import {
  computeMealReminderActions,
  mealReminderNotificationId,
  type MealReminderAction,
} from '../meal-reminders'
import type { MealType, FoodLog } from '@trainingai/shared/types/nutrition'

function makeMealType(overrides: Partial<MealType> = {}): MealType {
  return {
    id: 'meal-1',
    userId: 'user-1',
    name: 'Breakfast',
    emoji: '🍳',
    sortOrder: 0,
    timeStartHour: 6,
    timeEndHour: 10,
    remindersEnabled: true,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeFoodLog(mealTypeId: string): Pick<FoodLog, 'mealTypeId'> {
  return { mealTypeId }
}

describe('computeMealReminderActions', () => {
  it('cancels the reminder when a food log already exists for the meal type', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10 })
    const now = new Date('2026-06-13T12:00:00')
    const actions = computeMealReminderActions([mealType], [makeFoodLog('meal-1')], now)

    expect(actions).toEqual<MealReminderAction[]>([{ mealTypeId: 'meal-1', type: 'cancel' }])
  })

  it('cancels the reminder when remindersEnabled is false, even if unlogged and window passed', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10, remindersEnabled: false })
    const now = new Date('2026-06-13T12:00:00')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([{ mealTypeId: 'meal-1', type: 'cancel' }])
  })

  it('fires an immediate catch-up notification when the window has passed and nothing is logged', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10 })
    const now = new Date('2026-06-13T12:00:00')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'immediate', emoji: '🍳', name: 'Breakfast' },
    ])
  })

  it('schedules a one-shot notification for the window end time when the window is still ahead', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10 })
    const now = new Date('2026-06-13T08:00:00')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'scheduled', at: new Date('2026-06-13T10:00:00'), emoji: '🍳', name: 'Breakfast' },
    ])
  })

  it('treats "now" exactly at the window end time as passed (immediate)', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10 })
    const now = new Date('2026-06-13T10:00:00')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'immediate', emoji: '🍳', name: 'Breakfast' },
    ])
  })

  it('clamps timeEndHour === 24 to 23:59 same day when scheduling', () => {
    const mealType = makeMealType({ id: 'meal-1', name: 'Evening Snack', emoji: '🌙', timeStartHour: 21, timeEndHour: 24 })
    const now = new Date('2026-06-13T20:00:00')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'scheduled', at: new Date('2026-06-13T23:59:00'), emoji: '🌙', name: 'Evening Snack' },
    ])
  })

  it('clamps timeEndHour === 24 to 23:59 and fires immediate if already past it', () => {
    const mealType = makeMealType({ id: 'meal-1', name: 'Evening Snack', emoji: '🌙', timeStartHour: 21, timeEndHour: 24 })
    const now = new Date('2026-06-13T23:59:30')
    const actions = computeMealReminderActions([mealType], [], now)

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'immediate', emoji: '🌙', name: 'Evening Snack' },
    ])
  })

  it('skips re-notifying when the catch-up notification was already sent today', () => {
    const mealType = makeMealType({ id: 'meal-1', timeStartHour: 6, timeEndHour: 10 })
    const now = new Date('2026-06-13T12:00:00')
    const actions = computeMealReminderActions([mealType], [], now, new Set(['meal-1']))

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-1', type: 'skip' },
    ])
  })

  it('still fires the immediate notification for a meal type not in notifiedToday', () => {
    const breakfast = makeMealType({ id: 'meal-breakfast', name: 'Breakfast', emoji: '🍳', timeStartHour: 6, timeEndHour: 10 })
    const lunch = makeMealType({ id: 'meal-lunch', name: 'Lunch', emoji: '🥗', timeStartHour: 11, timeEndHour: 13 })
    const now = new Date('2026-06-13T14:00:00')
    const actions = computeMealReminderActions([breakfast, lunch], [], now, new Set(['meal-breakfast']))

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-breakfast', type: 'skip' },
      { mealTypeId: 'meal-lunch', type: 'immediate', emoji: '🥗', name: 'Lunch' },
    ])
  })

  it('computes independent actions for multiple meal types', () => {
    const breakfast = makeMealType({ id: 'meal-breakfast', name: 'Breakfast', emoji: '🍳', timeStartHour: 6, timeEndHour: 10 })
    const lunch = makeMealType({ id: 'meal-lunch', name: 'Lunch', emoji: '🥗', timeStartHour: 12, timeEndHour: 15 })
    const dinner = makeMealType({ id: 'meal-dinner', name: 'Dinner', emoji: '🍽️', timeStartHour: 17, timeEndHour: 21 })
    const now = new Date('2026-06-13T13:00:00')

    const actions = computeMealReminderActions(
      [breakfast, lunch, dinner],
      [makeFoodLog('meal-breakfast')],
      now,
    )

    expect(actions).toEqual<MealReminderAction[]>([
      { mealTypeId: 'meal-breakfast', type: 'cancel' },
      { mealTypeId: 'meal-lunch', type: 'scheduled', at: new Date('2026-06-13T15:00:00'), emoji: '🥗', name: 'Lunch' },
      { mealTypeId: 'meal-dinner', type: 'scheduled', at: new Date('2026-06-13T21:00:00'), emoji: '🍽️', name: 'Dinner' },
    ])
  })
})

describe('mealReminderNotificationId', () => {
  it('returns a deterministic id for the same meal type id', () => {
    const id1 = mealReminderNotificationId('meal-type-uuid-abc')
    const id2 = mealReminderNotificationId('meal-type-uuid-abc')
    expect(id1).toBe(id2)
  })

  it('returns an id within the 9200-9999 range', () => {
    const id = mealReminderNotificationId('some-uuid-1234-5678')
    expect(id).toBeGreaterThanOrEqual(9200)
    expect(id).toBeLessThanOrEqual(9999)
  })

  it('returns different ids for different meal type ids', () => {
    const id1 = mealReminderNotificationId('meal-type-uuid-aaa')
    const id2 = mealReminderNotificationId('meal-type-uuid-bbb')
    expect(id1).not.toBe(id2)
  })
})
