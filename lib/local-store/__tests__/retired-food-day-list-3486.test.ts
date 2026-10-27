// #3486. A merged-away food must not come back on a second device through the day-list hydrate.
//
// The sweep forgets a retired id as soon as its local row is gone, so the remembered-ids skip from
// #3474 protects nothing once the device has dropped the food. If another device then logs against
// the retired food, opening that day re-created it as a live row, and no later pull re-sent its
// tombstone (its `deleted_at` never changed, and the food query follows logs, which now point at the
// keeper). The server's day list now carries each food's `deletedAt`, and the hydrate skips it.
//
// End to end: the real merge job, `getSyncDelta`, `listFoodLogs`, `pullDelta` and the day-list
// hydrate against the shipped `SQLiteLocalStore` on in-memory node:sqlite. Only the HTTP hop is
// replaced, by a JSON round trip of what the routes would send.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => holder.store }))

import { openVectorDb } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'
import { pullDelta, _resetSyncBackoff } from '../sync-engine'
import { toLocalFoodItems, toLocalFoodLogs } from '@/app/nutrition/food-log-hydration'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000348601'
const DAY = '2026-10-01'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe.skipIf(!canRun)('a retired food does not return through the day-list hydrate (#3486)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let merge: typeof import('@/lib/nutrition/merge-look-alike-foods').mergeLookAlikeFoods
  let mealTypeId: string

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    merge = (await import('@/lib/nutrition/merge-look-alike-foods')).mergeLookAlikeFoods
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `retired-day-list-3486-${USER}@example.com`],
    )
  })

  const wipe = async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM food_items WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM meal_types WHERE user_id = $1`, [USER])
  }
  afterAll(async () => {
    if (!canRun) return
    try { await wipe() } finally { await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) }
  })

  beforeEach(async () => {
    await wipe()
    const { rows } = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1, 'Lunch') RETURNING id`, [USER])
    mealTypeId = rows[0].id
    _resetSyncBackoff()
    openVectorDb()
    holder.store = new SQLiteLocalStore()
    // The pull asks `/api/sync/pull?since=…`; answer with the real delta for that cursor.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const since = new Date(new URL(url, 'http://local').searchParams.get('since')!)
      const delta = await repo.getSyncDelta(USER, since)
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(delta)) }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const addFood = async () => (await pool.query(
    `INSERT INTO food_items (user_id, name, brand, serving_size_g, calories, protein_g, carbs_g, fat_g, source, region)
     VALUES ($1, 'Sunsol Granola', 'Sunsol', 100, 200, 10, 25, 5, 'manual', 'AU') RETURNING id`, [USER])).rows[0].id as string
  const addLog = async (foodItemId: string) => (await pool.query(
    `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier) VALUES ($1,$2,$3,$4,1) RETURNING id`,
    [USER, DAY, mealTypeId, foodItemId])).rows[0].id as string

  /** What opening the day does: fetch the day list, then hydrate the foods and logs it names. */
  const openDay = async (store: SQLiteLocalStore) => {
    const server = JSON.parse(JSON.stringify(await repo.listFoodLogs(USER, DAY))) as FoodLogWithItem[]
    const nowIso = new Date().toISOString()
    await store.applyDelta({
      foodItems: toLocalFoodItems(server, nowIso, await store.getRetiredFoodIds()),
      foodLogs: toLocalFoodLogs(server, DAY, nowIso),
    })
    return server
  }

  it('device B drops the retired food, a straggler log arrives, and opening the day leaves only the keeper', async () => {
    // The keeper has the history, so it is the keeper; the extra has none yet, so a pull can drop it.
    const keeper = await addFood()
    const extra = await addFood()
    await addLog(keeper)
    const store = holder.store as SQLiteLocalStore

    await pullDelta(USER, true)
    expect((await store.searchFoodItems('granola')).map(f => f.id).sort()).toEqual([keeper, extra].sort())

    // 1. The merge runs; device B pulls it, drops the retired food and forgets its id.
    await sleep(10)
    const first = await merge(db, USER, { dryRun: false })
    expect(first.ok).toBe(true)
    await sleep(10)
    await pullDelta(USER, true)
    expect(await store.getRetiredFoodIds()).toEqual([])
    expect((await store.searchFoodItems('granola')).map(f => f.id)).toEqual([keeper])

    // 2. Another device, still holding the old food, pushes a log on it.
    const straggler = await addLog(extra)

    // 3. Device B opens that day. The day list carries the food's retirement, and the hydrate skips it.
    const server = await openDay(store)
    const row = server.find(l => l.id === straggler)!
    expect(row.foodItem.deletedAt).toBeTruthy()
    expect(server.find(l => l.foodItemId === keeper)!.foodItem.deletedAt).toBeNull()
    expect((await store.searchFoodItems('granola')).map(f => f.id)).toEqual([keeper])

    // 4. A second merge moves the straggler; device B pulls it. Search still shows only the keeper.
    await sleep(10)
    const second = await merge(db, USER, { dryRun: false })
    expect(second.ok).toBe(true)
    await sleep(10)
    await pullDelta(USER, true)
    await openDay(store)
    expect((await store.searchFoodItems('granola')).map(f => f.id)).toEqual([keeper])
    const { rows: [moved] } = await pool.query(`SELECT food_item_id FROM food_logs WHERE id = $1`, [straggler])
    expect(moved.food_item_id).toBe(keeper)
  })
})
