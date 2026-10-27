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
    CREATE TABLE saved_meals (
      id TEXT PRIMARY KEY, name TEXT, servings REAL, image_data_uri TEXT, created_at TEXT, updated_at TEXT,
      deleted_at TEXT, sync_status TEXT);
    CREATE TABLE saved_meal_meal_types (saved_meal_id TEXT, meal_type_id TEXT, PRIMARY KEY (saved_meal_id, meal_type_id));
    CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT);
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

// #3459. A retired food that something on the device still points at must not show in the catalog,
// and must be dropped once nothing points at it, with no later tombstone to trigger that.
describe('a retired food still held by a local reference (#3459)', () => {
  const store = () => new SQLiteLocalStore()
  const TOMB = '2026-10-03T00:00:00Z'
  const savedMeal = (items: { id: string; foodItemId: string }[]) => ({
    id: 'm1', name: 'Bowl', servings: 1, imageDataUri: null, createdAt: '2026-10-01T00:00:00Z',
    items: items.map(i => ({ ...i, savedMealId: 'm1', quantityMultiplier: 1 })),
  })

  it('is hidden from search, barcode, calorie-match and recent foods at once, and removed once the saved meal is re-pointed', async () => {
    await apply({ foodItems: [food('keeper', { barcode: '111' }), food('extra', { barcode: '111', updatedAt: '2026-10-02T00:00:00Z' })] })
    db.current!.prepare(`INSERT INTO saved_meal_items VALUES ('i1','m1','extra',1)`).run()
    await apply({ foodItems: [food('extra', { barcode: '111', deletedAt: TOMB })] })

    expect(ids()).toEqual(['extra', 'keeper'])   // held by the ingredient
    expect((await store().searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
    expect((await store().searchFoodItems('')).map(f => f.id)).toEqual(['keeper'])
    expect((await store().getFoodItemByBarcode('111'))?.id).toBe('keeper')
    expect((await store().findFoodItemsByCalories(200)).map(f => f.id)).toEqual(['keeper'])

    // The saved-meals sheet opens: the server list has the ingredient on the keeper.
    await store().hydrateSavedMeals([savedMeal([{ id: 'i1', foodItemId: 'keeper' }])] as never)
    expect(ids()).toEqual(['keeper'])
    expect(await store().getSyncMeta('retiredFoodIds')).toBe('[]')
  })

  it('stays hidden while an unsynced log holds it, and goes at the pull that re-points the log', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    db.current!.prepare(`INSERT INTO food_logs VALUES ('l1','2026-10-02','mt-1','extra',NULL,NULL,NULL,1,'2026-10-02T01:00:00Z','2026-10-02T01:00:00Z',NULL,'pending')`).run()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    expect(ids()).toEqual(['extra', 'keeper'])
    expect((await store().searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
    expect((await store().getRecentFoodItems(10)).map(f => f.id)).toEqual([])

    // The log is pushed (synced), then a LATER pull carries it re-pointed. No tombstone arrives again.
    db.current!.prepare(`UPDATE food_logs SET sync_status='synced' WHERE id='l1'`).run()
    await apply({ foodLogs: [log('l1', 'keeper')] })
    expect(ids()).toEqual(['keeper'])
    expect(await store().getSyncMeta('retiredFoodIds')).toBe('[]')
    expect(await store().getFoodLogsWithItems('2026-10-02')).toHaveLength(1)
  })

  it('a food that was never retired is not hidden', async () => {
    await apply({ foodItems: [food('keeper'), food('other', { name: 'Other Granola' })] })
    expect((await store().searchFoodItems('granola')).map(f => f.id).sort()).toEqual(['keeper', 'other'])
  })
})

// #3468. Nothing used to take an id off the retired list, so a food the server brought back stayed
// hidden. Only a pulled row with an explicit `deletedAt: null` forgets; the day-list hydrate sends
// foods with no `deletedAt` and must not.
describe('a retired food that is revived (#3468)', () => {
  const store = () => new SQLiteLocalStore()
  const TOMB = '2026-10-03T00:00:00Z'
  const holdBySavedMeal = () => db.current!.prepare(`INSERT INTO saved_meal_items VALUES ('i1','m1','extra',1)`).run()
  const retiredMeta = () => store().getSyncMeta('retiredFoodIds')

  it('is searchable again and leaves the list when a pull carries it live', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    holdBySavedMeal()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    expect((await store().searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
    expect(JSON.parse((await retiredMeta())!)).toEqual(['extra'])

    await apply({ foodItems: [food('extra', { deletedAt: null })] })
    expect((await store().searchFoodItems('granola')).map(f => f.id).sort()).toEqual(['extra', 'keeper'])
    expect(await retiredMeta()).toBe('[]')
  })

  it('is no longer deleted at the next pull once nothing references it', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    holdBySavedMeal()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    await apply({ foodItems: [food('extra', { deletedAt: null })] })
    db.current!.prepare(`DELETE FROM saved_meal_items`).run()
    await apply({ foodLogs: [] })
    expect(ids()).toEqual(['extra', 'keeper'])
  })

  it('a pull with no deletedAt key (the day-list upsert) does not forget, and does not re-create a dropped row', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    holdBySavedMeal()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    const { deletedAt: _omit, ...noDeletedAt } = food('extra')
    await apply({ foodItems: [noDeletedAt] })
    expect(JSON.parse((await retiredMeta())!)).toEqual(['extra'])
    expect((await store().searchFoodItems('granola')).map(f => f.id)).toEqual(['keeper'])
  })

  it('forgets only the revived id, keeps the others', async () => {
    await apply({ foodItems: [food('keeper'), food('extra'), food('extra2')] })
    db.current!.prepare(`INSERT INTO saved_meal_items VALUES ('i1','m1','extra',1), ('i2','m1','extra2',1)`).run()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB }), food('extra2', { deletedAt: TOMB })] })
    await apply({ foodItems: [food('extra', { deletedAt: null })] })
    expect(JSON.parse((await retiredMeta())!)).toEqual(['extra2'])
  })

  it('the last word on an id wins: a tombstone then a live entry in one delta keeps the row (#3482)', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    await apply({ foodItems: [food('extra', { deletedAt: TOMB }), food('extra', { deletedAt: null })] })
    expect(ids()).toEqual(['extra', 'keeper'])
    expect(await retiredMeta()).toBe('[]')
    // and the other order still drops it
    await apply({ foodItems: [food('extra', { deletedAt: null }), food('extra', { deletedAt: TOMB })] })
    expect(ids()).toEqual(['keeper'])
  })

  it('does not rewrite the retired list when a pull leaves it unchanged (#3482)', async () => {
    await apply({ foodItems: [food('keeper'), food('extra')] })
    holdBySavedMeal()
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    const spy = vi.spyOn(SQLiteLocalStore.prototype, 'setSyncMeta')
    await apply({ foodItems: [food('keeper')] })
    await apply({ foodItems: [food('extra', { deletedAt: TOMB })] })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('a malformed or missing stored list reads as empty and a pull still works', async () => {
    expect(await store().getRetiredFoodIds()).toEqual([])
    for (const bad of ['not json', '{"a":1}', '"extra"', '[1,null,"x"]']) {
      db.current!.prepare(`INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('retiredFoodIds', ?)`).run(bad)
      await apply({ foodItems: [food('extra', { deletedAt: null })] })
      expect(JSON.parse((await retiredMeta())!)).toEqual([])   // the sweep also drops 'x': no such row
    }
    expect((await store().searchFoodItems('granola')).map(f => f.id)).toEqual(['extra'])
  })
})
