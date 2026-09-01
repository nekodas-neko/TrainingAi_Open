/**
 * BF-97 — a scanned meal groups in the diary, and the group carries its own name.
 *
 * BF-39 shipped grouping for SAVED meals and the case that motivated it stayed open: a scan has no
 * saved meal to be named from, and `groupDiaryEntries` deliberately refuses to head a group it
 * cannot name. So the group is minted here, with the dish name the user confirmed.
 *
 * **The assertions that matter are the two negatives.** A single entry must mint nothing — a group
 * of one is collapsed back to a plain row anyway, so an id there is a row that renders as a meal
 * for one frame and then does not. And a batch with no usable name must mint nothing either, or the
 * diary is handed exactly the un-nameable group its own rule exists to refuse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fakeStore } = vi.hoisted(() => ({
  fakeStore: {
    getMealTypes:   vi.fn().mockResolvedValue([]),
    upsertFoodItem: vi.fn().mockResolvedValue(undefined),
    upsertFoodLog:  vi.fn().mockResolvedValue(undefined),
    queueMutation:  vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/local-store', () => ({ getLocalStore: () => fakeStore }))
vi.mock('@/lib/local-store/push-then-revalidate', () => ({ pushThenRevalidate: vi.fn() }))
vi.mock('@/lib/cache-groups', () => ({ invalidateNutritionWrite: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/meal-reminders', () => ({ cancelMealReminder: vi.fn(() => Promise.resolve()) }))

import { logFoodEntries, ingredientsToEntries } from '../log-food'
import { normalizeMealGroupName, MEAL_GROUP_NAME_MAX_CHARS } from '../meal-group-name'

const INGREDIENTS = [
  { name: 'Pulled Beef', weightG: 200, caloriesPer100g: 200, proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 10 },
  { name: 'Carrots',     weightG: 80,  caloriesPer100g: 41,  proteinPer100g: 0.9, carbsPer100g: 10, fatPer100g: 0.2 },
  { name: 'Broccoli',    weightG: 90,  caloriesPer100g: 34,  proteinPer100g: 2.8, carbsPer100g: 7, fatPer100g: 0.4 },
]

/** Every `upsertFoodLog` call's group fields, in call order. */
function writtenGroups() {
  return fakeStore.upsertFoodLog.mock.calls.map(([r]) => ({
    mealGroupId: r.mealGroupId ?? null,
    mealGroupName: r.mealGroupName ?? null,
  }))
}

describe('logFoodEntries — the scanned group (BF-97)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('gives every row of a multi-item scan ONE group id and the dish name', async () => {
    const entries = ingredientsToEntries(INGREDIENTS, 1)
    const logs = await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', 'Beef and vegetables')

    const groups = writtenGroups()
    expect(groups).toHaveLength(3)
    expect(new Set(groups.map(g => g.mealGroupId)).size).toBe(1)
    expect(groups[0].mealGroupId).toBeTruthy()
    expect(groups.every(g => g.mealGroupName === 'Beef and vegetables')).toBe(true)

    // The optimistic rows carry it too, or the diary draws the scan flat until the next read —
    // which is the reported symptom, just for a few seconds.
    expect(logs).toHaveLength(3)
    expect(new Set(logs.map(l => l.mealGroupId)).size).toBe(1)
    expect(logs[0].mealGroupId).toBe(groups[0].mealGroupId)
    expect(logs.every(l => l.mealGroupName === 'Beef and vegetables')).toBe(true)
  })

  // The outbox payload must carry every field the web route accepts, or the APK's scan lands
  // grouped locally and flat on the server — the exact drift the offline-sync rule is about.
  it('queues the grouping in the outbox payload, not only in the local row', async () => {
    const entries = ingredientsToEntries(INGREDIENTS, 1)
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', 'Beef and vegetables')

    const foodLogMutations = fakeStore.queueMutation.mock.calls
      .map(([m]) => m)
      .filter(m => m.domain === 'food_logs')
    expect(foodLogMutations).toHaveLength(3)
    expect(new Set(foodLogMutations.map(m => m.payload.mealGroupId)).size).toBe(1)
    expect(foodLogMutations.every(m => m.payload.mealGroupName === 'Beef and vegetables')).toBe(true)
    // The same group the local row got — two ids here would group on-device and not on the server.
    expect(foodLogMutations[0].payload.mealGroupId).toBe(writtenGroups()[0].mealGroupId)
  })

  it('mints nothing for a single entry — a group of one is collapsed back to a plain row', async () => {
    const entries = ingredientsToEntries(INGREDIENTS.slice(0, 1), 1)
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', 'Pulled Beef')

    expect(writtenGroups()).toEqual([{ mealGroupId: null, mealGroupName: null }])
  })

  it('mints nothing when there is no name to head the group with', async () => {
    const entries = ingredientsToEntries(INGREDIENTS, 1)
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', '   ')

    expect(writtenGroups().every(g => g.mealGroupId === null && g.mealGroupName === null)).toBe(true)
  })

  it('mints nothing when the caller passes no name at all — the pre-BF-97 behaviour, unchanged', async () => {
    const entries = ingredientsToEntries(INGREDIENTS, 1)
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1')

    expect(writtenGroups().every(g => g.mealGroupId === null && g.mealGroupName === null)).toBe(true)
  })

  it('gives two scans on one day two groups, so the diary cannot merge them', async () => {
    const entries = ingredientsToEntries(INGREDIENTS, 1)
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', 'Beef and vegetables')
    await logFoodEntries(entries, '2026-09-01', 'meal-type-1', 'u1', 'Australia/Brisbane', 'Beef and vegetables')

    const ids = new Set(writtenGroups().map(g => g.mealGroupId))
    expect(ids.size).toBe(2)
  })
})

describe('normalizeMealGroupName', () => {
  it('trims, and treats nothing-but-space as no name', () => {
    expect(normalizeMealGroupName('  Beef and vegetables  ')).toBe('Beef and vegetables')
    expect(normalizeMealGroupName('   ')).toBeNull()
    expect(normalizeMealGroupName('')).toBeNull()
  })

  it('is null for anything that is not a string', () => {
    for (const v of [null, undefined, 42, {}, ['a']]) expect(normalizeMealGroupName(v)).toBeNull()
  })

  // Truncation rather than rejection: an over-long name reaches the push branch inside an outbox
  // mutation, and a 4xx there quarantines the mutation — losing the whole food log over a header.
  it('truncates an over-long name instead of refusing it', () => {
    const long = 'a'.repeat(MEAL_GROUP_NAME_MAX_CHARS + 40)
    const out = normalizeMealGroupName(long)!
    expect(out).toHaveLength(MEAL_GROUP_NAME_MAX_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })

  it('leaves a name exactly at the limit alone', () => {
    const exact = 'a'.repeat(MEAL_GROUP_NAME_MAX_CHARS)
    expect(normalizeMealGroupName(exact)).toBe(exact)
  })
})
