import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { computeMealReminderActions, type MealTypeForReminders } from '../meal-reminders'
import type { LocalMealType } from '@/lib/local-store/types'

const ROOT = path.resolve(__dirname, '../..')
const code = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function localType(over: Partial<LocalMealType> = {}): LocalMealType {
  return {
    id: 'm1', name: 'Lunch', emoji: '🥗', sortOrder: 1,
    timeStartHour: 11, timeEndHour: 14, remindersEnabled: true, required: true, ...over,
  }
}

/**
 * RV-183 — the meal reminder reconcile read the server for a domain the device owns.
 *
 * Food logs are offline-first, so `/api/nutrition/food-logs` holds whatever has synced while the
 * device holds the truth. A meal logged offline kept nagging you to log it until the next pull, and
 * the reconcile spent two GETs reaching that conclusion on every launch and every resume.
 */
describe('RV-183 — the local meal-type row satisfies the reminder logic directly', () => {
  it('a LocalMealType is assignable with no mapping and no invented fields', () => {
    // The point of narrowing to a Pick: LocalMealType lacks userId/sortOrder/timeStartHour/createdAt
    // and this compiles anyway, because none of them are read. If someone widens the parameter back
    // to MealType, this line stops compiling — which is the guard.
    const types: MealTypeForReminders[] = [localType()]
    expect(types[0].id).toBe('m1')
  })

  it('cancels the reminder for a meal that has been logged', () => {
    const [action] = computeMealReminderActions([localType()], [{ mealTypeId: 'm1' }], new Date('2026-09-25T12:00:00'))
    expect(action).toEqual({ mealTypeId: 'm1', type: 'cancel' })
  })

  it('still schedules one for a meal that has not', () => {
    const [action] = computeMealReminderActions([localType()], [], new Date('2026-09-25T12:00:00'))
    expect(action.type).toBe('scheduled')
  })

  it('cancels when reminders are off for that meal, logged or not', () => {
    const [action] = computeMealReminderActions([localType({ remindersEnabled: false })], [], new Date('2026-09-25T12:00:00'))
    expect(action).toEqual({ mealTypeId: 'm1', type: 'cancel' })
  })
})

describe('RV-183 — the reconcile reads the device first', () => {
  it('goes to the local store before the API', () => {
    const src = code('components/sync-provider.tsx')
    expect(src).toMatch(/store\.getMealTypes\(\)/)
    expect(src).toMatch(/store\.getFoodLogs\(today\)/)
  })

  it('an empty meal-type table falls through instead of cancelling everything', () => {
    // An unhydrated store has zero meal types; a user genuinely has some. Treating the first as the
    // second would cancel every reminder on a cold device. Zero FOOD LOGS is different — that is
    // the case the reminder exists for, so it must NOT gate the local branch.
    const src = code('components/sync-provider.tsx')
    expect(src).toMatch(/if \(types\.length > 0\)/)
    expect(src).not.toMatch(/logs\.length > 0/)
  })

  it('keeps the API fallback for the web and a store that failed to open', () => {
    const src = code('components/sync-provider.tsx')
    expect(src).toMatch(/if \(mealTypeList == null\)/)
    expect(src).toMatch(/'nutrition-meal-types'/)
  })
})
