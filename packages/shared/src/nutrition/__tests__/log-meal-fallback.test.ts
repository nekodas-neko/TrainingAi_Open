import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SavedMeal } from '../../types/nutrition'

// BF-12. The sibling `log-meal.test.ts` mocks `getLocalStore` to a working store, so it only ever
// exercises the offline-first path. This file mocks it to `null` — the K4 `isLocalStoreDead` state
// the owner's device was actually in — which is the only way to reach the web fallback where the
// serial-fetch defect lived.
vi.mock('@/lib/local-store', () => ({ getLocalStore: () => null }))
vi.mock('@/lib/local-store/sync-engine', () => ({ pushMutations: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/cache-groups', () => ({ invalidateNutritionWrite: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/meal-reminders', () => ({ cancelMealReminder: vi.fn(() => Promise.resolve()) }))

import { logMealItems } from '../log-meal'

function mealOf(names: string[]): SavedMeal {
  return {
    id: 'meal-x', userId: 'u1', name: 'Fallback Meal', createdAt: new Date(),
    items: names.map((name, i) => ({
      id: `smi-${i}`, savedMealId: 'meal-x', foodItemId: `item-${i}`, quantityMultiplier: 1,
      foodItem: {
        id: `item-${i}`, userId: 'u1', name, servingSizeG: 100,
        calories: 100, proteinG: 10, carbsG: 5, fatG: 2,
        source: 'manual' as const, region: 'AU', createdAt: new Date(),
      },
    })),
    totals: { calories: 100 * names.length, proteinG: 10 * names.length, carbsG: 5 * names.length, fatG: 2 * names.length },
  }
}

/** A fetch stub whose POST responses stay pending until the test releases them. */
function deferredFetch() {
  const releases: Array<(v: unknown) => void> = []
  const deletes: string[] = []
  const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') {
      deletes.push(url)
      return Promise.resolve({ ok: true, json: async () => ({}) })
    }
    const i = releases.length
    return new Promise(resolve => {
      releases.push(() => resolve({ ok: true, json: async () => ({ id: `log-${i}`, loggedAt: '2026-08-24T10:00:00.000Z' }) }))
    })
  })
  return { fetchMock, releases, deletes }
}

describe('logMealItems — web fallback (BF-12)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('fires every ingredient POST concurrently, not one round trip at a time', async () => {
    const { fetchMock, releases } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)

    const pending = logMealItems(mealOf(['Spaghetti', 'Turkey Mince', 'Passata']), '2026-08-24', 'mt-1', 'u1')
    // Let the microtask queue drain so every concurrently-started fetch has been called.
    await Promise.resolve()
    await Promise.resolve()

    // The regression in one assertion: serially, only the FIRST POST would have been issued while
    // all three are still unresolved. This is what the owner felt as a ~20s chain.
    expect(fetchMock).toHaveBeenCalledTimes(3)

    releases.forEach(r => r(null))
    await pending
    vi.unstubAllGlobals()
  })

  it('returns the optimistic entries in meal order, not completion order', async () => {
    const releases: Array<() => void> = []
    const fetchMock = vi.fn((_url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: async () => ({}) })
      const i = releases.length
      return new Promise(resolve => {
        releases.push(() => resolve({ ok: true, json: async () => ({ id: `log-${i}`, loggedAt: '2026-08-24T10:00:00.000Z' }) }))
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const pending = logMealItems(mealOf(['A', 'B', 'C']), '2026-08-24', 'mt-1', 'u1')
    await Promise.resolve(); await Promise.resolve()
    // Resolve backwards — completion order is deliberately the reverse of meal order.
    for (const r of [...releases].reverse()) r()

    const out = await pending
    expect(out.map(o => o.foodItem.name)).toEqual(['A', 'B', 'C'])
    vi.unstubAllGlobals()
  })

  it('rolls back EVERY row that landed when one sibling fails, not just the ones before it', async () => {
    // The concurrency fix makes this distinction load-bearing. `Promise.all` rejects on the first
    // failure without reporting which siblings succeeded, so those rows would be stranded
    // server-side — invisible to the rollback, and duplicates on the next tap. Serially this could
    // not happen, which is why it needs a test now and did not before.
    const deletes: string[] = []
    let n = 0
    const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        deletes.push(url)
        return Promise.resolve({ ok: true, json: async () => ({}) })
      }
      const i = n++
      // The MIDDLE item fails, so there is a successful row on either side of the failure.
      if (i === 1) return Promise.resolve({ ok: false, json: async () => ({}) })
      return Promise.resolve({ ok: true, json: async () => ({ id: `log-${i}`, loggedAt: '2026-08-24T10:00:00.000Z' }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      logMealItems(mealOf(['A', 'B', 'C']), '2026-08-24', 'mt-1', 'u1'),
    ).rejects.toThrow()

    // Both survivors deleted — log-0 (before the failure) and log-2 (after it). A first-failure
    // abort would have deleted only log-0 and left log-2 behind.
    expect(deletes.sort()).toEqual([
      '/api/nutrition/food-logs/log-0',
      '/api/nutrition/food-logs/log-2',
    ])
    vi.unstubAllGlobals()
  })
})
