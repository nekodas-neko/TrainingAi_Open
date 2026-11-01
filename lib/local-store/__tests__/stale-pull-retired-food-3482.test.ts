// #3482 item 2. `pullDelta` has no in-flight guard, so a pull that read the server BEFORE a merge can
// apply AFTER the pull that carried the tombstone. Its live entry forgets the retired id and the
// duplicate shows again. What heals it is the cursor: `setLastSyncAt` is unconditional, so the stale
// pull moves it back to its own `syncedAt`, and the next pull re-delivers the tombstone. This pins
// that. (#3484 later serialised the apply-and-cursor section so overlapping pulls cannot interleave
// their writes; this file still pins the self-heal for pulls that land in sequence.)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
vi.mock('../index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../index')>()
  const { SQLiteLocalStore } = await import('../sqlite-backend')
  const store = new SQLiteLocalStore()
  return { ...actual, getLocalStore: () => store }
})

import { pullDelta, _resetSyncBackoff } from '../sync-engine'
import { openVectorDb } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'

const BASE = {
  programs: [], progressionStyles: [], bodyMetrics: [], sleepSessions: [], moodLogs: [],
  activityLogs: [], workoutSessions: [],
}
const food = (id: string, deletedAt: string | null) => ({
  id, name: 'Sunsol Granola', brand: 'Sunsol', servingSizeG: 45, calories: 200, proteinG: 5, carbsG: 28,
  fatG: 7, source: 'manual', createdAt: '2026-10-01T00:00:00.000Z', deletedAt,
})
const T_OLD = '2026-10-10T10:00:00.000Z'   // the stale pull read the server here, before the merge
const T_MERGE = '2026-10-10T10:05:00.000Z'
const T_NEW = '2026-10-10T10:06:00.000Z'

const urls: string[] = []
function serve(...pages: Record<string, unknown>[]) {
  const queue = [...pages]
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.startsWith('/api/sync/pull')) return { ok: true, status: 200, json: async () => ({}) }
    urls.push(url)
    return { ok: true, status: 200, json: async () => ({ ...BASE, ...queue.shift() }) }
  }))
}

beforeEach(() => { urls.length = 0; openVectorDb(); _resetSyncBackoff() })

describe('a stale pull applied after the pull that carried a tombstone (#3482)', () => {
  it('moves the cursor back, so the next pull re-delivers the tombstone and the food is hidden again', async () => {
    const store = new SQLiteLocalStore()
    // Hold the duplicate with a saved-meal ingredient so the tombstone keeps its row (hidden, not dropped).
    serve({ syncedAt: '2026-10-10T09:00:00.000Z', foodItems: [food('keeper', null), food('extra', null)] })
    await pullDelta('u', true)
    const { runSQL } = await import('./parity/node-sqlite-service')
    await runSQL(`INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier) VALUES ('i1','m1','extra',1)`)

    // The newer pull lands first and carries the tombstone.
    serve({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
    await pullDelta('u', true)
    expect(await store.getRetiredFoodIds()).toEqual(['extra'])
    expect(await store.getLastSyncAt()).toEqual(new Date(T_NEW))

    // The older pull (read before the merge) lands second, with the food live.
    serve({ syncedAt: T_OLD, foodItems: [food('extra', null)] })
    await pullDelta('u', true)
    expect(await store.getRetiredFoodIds()).toEqual([])          // the id is forgotten: the duplicate is back
    expect((await store.searchFoodItems('granola')).map(f => f.id).sort()).toEqual(['extra', 'keeper'])
    expect(await store.getLastSyncAt()).toEqual(new Date(T_OLD)) // and the cursor moved back with it

    // The next pull asks from the older cursor, so the server sends the tombstone again.
    serve({ syncedAt: T_NEW, foodItems: [food('extra', T_MERGE)] })
    await pullDelta('u', true)
    expect(urls[urls.length - 1]).toContain(`since=${T_OLD}`)
    expect(await store.getRetiredFoodIds()).toEqual(['extra'])
    expect((await store.searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
  })
})
