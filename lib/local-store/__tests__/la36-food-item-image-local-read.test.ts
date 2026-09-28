// LA-36 — a food's picture is stored on the device as bytes (BF-35) so it renders offline, and every
// local read now returns it, as the server's rowToFoodItem always has. The three local reads that
// dropped it: search, recent foods, and the item embedded in a day's logs.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

const db = { current: null as DatabaseSync | null }
vi.mock('@/lib/sqlite/sqlite-service', () => ({
  runSQL: vi.fn(async (sql: string, p: unknown[] = []) => { db.current!.prepare(sql).run(...(p as never[])) }),
  querySQL: vi.fn(async (sql: string, p: unknown[] = []) => db.current!.prepare(sql).all(...(p as never[]))),
  beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
}))

import { SQLiteLocalStore } from '../sqlite-backend'

const PIC = 'data:image/webp;base64,UklGRg=='

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE food_items (
      id TEXT PRIMARY KEY, name TEXT, brand TEXT, serving_size_g REAL, calories REAL, protein_g REAL,
      carbs_g REAL, fat_g REAL, fiber_g REAL, sugar_g REAL, sodium_mg REAL, sat_fat_g REAL,
      source TEXT, barcode TEXT, image_data_uri TEXT, updated_at TEXT);
    CREATE TABLE food_logs (
      id TEXT PRIMARY KEY, date TEXT, meal_type_id TEXT, food_item_id TEXT, quantity_multiplier REAL,
      logged_at TEXT, saved_meal_id TEXT, meal_group_id TEXT, meal_group_name TEXT, deleted_at TEXT);
    INSERT INTO food_items (id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source, image_data_uri, updated_at)
      VALUES ('with-pic', 'LA36 Scanned Bar', 50, 200, 10, 20, 8, 'barcode', '${PIC}', '2026-09-28T01:00:00Z'),
             ('no-pic',   'LA36 Typed Oats', 40, 150, 5, 27, 3, 'manual', NULL, '2026-09-27T01:00:00Z');
    INSERT INTO food_logs (id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
      VALUES ('log-1', '2026-09-28', 'mt-1', 'with-pic', 1, '2026-09-28T01:05:00Z'),
             ('log-2', '2026-09-28', 'mt-1', 'no-pic',   1, '2026-09-28T01:06:00Z');
  `)
})

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map(x => [x.id, x]))

describe('local food reads carry the picture (LA-36)', () => {
  it('search returns it, and null for a food without one', async () => {
    const items = byId(await new SQLiteLocalStore().searchFoodItems('la36'))
    expect(items['with-pic'].imageDataUri).toBe(PIC)
    expect(items['no-pic'].imageDataUri).toBeNull()
  })

  it('recent foods return it', async () => {
    const items = byId(await new SQLiteLocalStore().getRecentFoodItems(10))
    expect(items['with-pic'].imageDataUri).toBe(PIC)
    expect(items['no-pic'].imageDataUri).toBeNull()
  })

  it("the item embedded in a day's logs returns it", async () => {
    const logs = await new SQLiteLocalStore().getFoodLogsWithItems('2026-09-28')
    const pics = Object.fromEntries(logs.map(l => [l.foodItemId, l.foodItem?.imageDataUri]))
    expect(pics).toEqual({ 'with-pic': PIC, 'no-pic': null })
  })
})
