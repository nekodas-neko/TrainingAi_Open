// #2417. A food the server merged into a keeper arrives in the pull with `deletedAt`. The device
// drops the row, unless a log or saved meal on the device still points at it: a log whose food is
// missing is not drawn, and a log is never dropped.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  withTransaction: vi.fn(async (fn: (tx: { run: (sql: string, p?: unknown[]) => Promise<void> }) => Promise<unknown>) => fn({ run: (await import('@/lib/sqlite/sqlite-service')).runSQL })),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const food = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: 'Sunsol Granola', brand: 'Sunsol', servingSizeG: 45, calories: 200, proteinG: 5, carbsG: 28, fatG: 7,
  fiberG: null, sugarG: null, sodiumMg: null, satFatG: null, source: 'manual', barcode: null, imageDataUri: null,
  updatedAt: '2026-10-01T00:00:00Z', deletedAt: null, ...over,
})
const log = (id: string, foodItemId: string) => ({
  id, date: '2026-10-02', mealTypeId: 'mt-1', foodItemId, savedMealId: null, mealGroupId: null, mealGroupName: null,
  quantityMultiplier: 1, loggedAt: '2026-10-02T01:00:00Z', updatedAt: '2026-10-02T01:00:00Z', deletedAt: null, syncStatus: 'synced',
})

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE food_items (
      id TEXT PRIMARY KEY, name TEXT, brand TEXT, serving_size_g REAL, calories REAL, protein_g REAL,
      carbs_g REAL, fat_g REAL, fiber_g REAL, sugar_g REAL, sodium_mg REAL, sat_fat_g REAL,
      source TEXT, barcode TEXT, image_data_uri TEXT, updated_at TEXT);
    CREATE TABLE food_logs (
      id TEXT PRIMARY KEY, date TEXT, meal_type_id TEXT, food_item_id TEXT, saved_meal_id TEXT, meal_group_id TEXT,
      meal_group_name TEXT, quantity_multiplier REAL, logged_at TEXT, updated_at TEXT, deleted_at TEXT, sync_status TEXT);
    CREATE TABLE saved_meal_items (id TEXT PRIMARY KEY, saved_meal_id TEXT, food_item_id TEXT, quantity_multiplier REAL);
  `)
})

const ids = () => (db.current!.prepare(`SELECT id FROM food_items ORDER BY id`).all() as { id: string }[]).map(r => r.id)
const apply = (d: Record<string, unknown>) => new SQLiteLocalStore().applyDelta(d as never)

describe('a pulled tombstoned food (#2417)', () => {
  it('is dropped when nothing on the device uses it', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    await apply({ foodItems: [food('extra', { deletedAt: '2026-10-03T00:00:00Z' })] })
    expect(ids()).toEqual(['keeper'])
  })

  it('is not stored when it arrives first and unused', async () => {
    await apply({ foodItems: [food('extra', { deletedAt: '2026-10-03T00:00:00Z' })] })
    expect(ids()).toEqual([])
  })

  it('is kept while a log on the device still points at it, so the log is still drawn', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')], foodLogs: [log('l1', 'extra')] })
    await apply({ foodItems: [food('extra', { deletedAt: '2026-10-03T00:00:00Z' })] })
    expect(ids()).toEqual(['extra', 'keeper'])
    const day = await new SQLiteLocalStore().getFoodLogsWithItems('2026-10-02')
    expect(day.map(d => d.id)).toEqual(['l1'])
  })

  it('is kept when the log that needs it arrives in the same pull', async () => {
    await apply({ foodItems: [food('extra', { deletedAt: '2026-10-03T00:00:00Z' })], foodLogs: [log('l1', 'extra')] })
    expect(ids()).toEqual(['extra'])
    expect(await new SQLiteLocalStore().getFoodLogsWithItems('2026-10-02')).toHaveLength(1)
  })

  it('is kept while a saved meal on the device uses it', async () => {
    await apply({ foodItems: [food('extra')] })
    db.current!.prepare(`INSERT INTO saved_meal_items VALUES ('i1','m1','extra',1)`).run()
    await apply({ foodItems: [food('extra', { deletedAt: '2026-10-03T00:00:00Z' })] })
    expect(ids()).toEqual(['extra'])
  })

  it('a log the server already re-pointed to the keeper no longer holds it', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')], foodLogs: [log('l1', 'extra')] })
    await apply({ foodItems: [food('keeper'), food('extra', { deletedAt: '2026-10-03T00:00:00Z' })], foodLogs: [log('l1', 'keeper')] })
    expect(ids()).toEqual(['keeper'])
    expect(await new SQLiteLocalStore().getFoodLogsWithItems('2026-10-02')).toHaveLength(1)
  })
})
