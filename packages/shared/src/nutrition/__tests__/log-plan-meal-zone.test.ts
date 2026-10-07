/**
 * RV-179 — `logPlanMeal` picked a meal bucket from the DEVICE's hour while taking a `tz`.
 *
 * With no suggested time it fell back to `now.getHours()`, so a phone set to another zone filed a
 * 7 am Brisbane log under whatever bucket that zone's hour fell in. It now reads the hour in `tz`.
 * The test runs in whatever zone the suite runs in; the instant is chosen so the two readings land
 * in different buckets in UTC and in Brisbane alike.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ logFoodEntries: vi.fn(async (..._args: unknown[]) => []) }))
vi.mock('@trainingai/shared/nutrition/log-food', () => ({ logFoodEntries: h.logFoodEntries }))

import { logPlanMeal } from '../log-plan-meal'
import type { MealType } from '../../types/nutrition'

const mt = (id: string, start: number, end: number): MealType => ({
  id, userId: 'u', name: id, emoji: '🍽️', sortOrder: 0, timeStartHour: start, timeEndHour: end,
  remindersEnabled: false, required: false, createdAt: new Date(),
})
const TYPES = [mt('breakfast', 5, 11), mt('lunch', 11, 15), mt('dinner', 17, 22)]
const MEAL = { name: 'Oats', ingredients: [{ name: 'Oats', weightG: 100, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 7 }] }

// 19:00 UTC on 6 Oct is 05:00 on 7 Oct in Brisbane (UTC+10, no DST): breakfast there, dinner in UTC.
const NOW = new Date('2026-10-06T19:00:00Z')

beforeEach(() => h.logFoodEntries.mockClear())

describe('logPlanMeal with no suggested time (RV-179)', () => {
  it('files the log under the bucket for the hour in the caller’s zone', async () => {
    await logPlanMeal(MEAL as never, TYPES, '2026-10-07', 'u', NOW, 'Australia/Brisbane')
    expect(h.logFoodEntries.mock.calls[0][2]).toBe('breakfast')
  })

  it('reads a different zone differently, so it is the argument and not the machine', async () => {
    await logPlanMeal(MEAL as never, TYPES, '2026-10-06', 'u', NOW, 'UTC')
    expect(h.logFoodEntries.mock.calls[0][2]).toBe('dinner')
  })

  it('still prefers the plan’s own suggested time over any clock', async () => {
    await logPlanMeal({ ...MEAL, suggestedTime: '12:30' } as never, TYPES, '2026-10-07', 'u', NOW, 'Australia/Brisbane')
    expect(h.logFoodEntries.mock.calls[0][2]).toBe('lunch')
  })
})
