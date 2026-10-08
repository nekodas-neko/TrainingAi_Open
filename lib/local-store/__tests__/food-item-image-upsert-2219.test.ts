// Issue 2219 (BF-35). A food's picture survives every later write to its local row.
//
// `upsertFoodItem` used `image_data_uri = excluded.image_data_uri`, so any write that offered null
// blanked a thumbnail the phone already held: logging the food again from Recent, logging a saved
// meal that contains it, and a pull of a row whose server copy had never received the picture (the
// outbox payload omitted it until this issue). `barcode` has been COALESCEd since LB-158; this is
// the same rule for the picture.
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
const PIC2 = 'data:image/png;base64,iVBORw0KGgo='

const record = (over: Record<string, unknown> = {}) => ({
  id: 'fi-1', name: 'Sunsol Granola', brand: 'Sunsol', servingSizeG: 45, calories: 200,
  proteinG: 5, carbsG: 28, fatG: 7, fiberG: null, sugarG: null, sodiumMg: null, satFatG: null,
  source: 'barcode', barcode: '9300675024235', imageDataUri: PIC, updatedAt: '2026-10-01T00:00:00Z',
  ...over,
}) as never

beforeEach(() => {
  db.current = new DatabaseSync(':memory:')
  db.current.exec(`
    CREATE TABLE food_items (
      id TEXT PRIMARY KEY, name TEXT, brand TEXT, serving_size_g REAL, calories REAL, protein_g REAL,
      carbs_g REAL, fat_g REAL, fiber_g REAL, sugar_g REAL, sodium_mg REAL, sat_fat_g REAL,
      source TEXT, barcode TEXT, image_data_uri TEXT, updated_at TEXT);
  `)
})

const stored = () => db.current!.prepare(`SELECT barcode, image_data_uri FROM food_items WHERE id = 'fi-1'`).get() as
  { barcode: string | null; image_data_uri: string | null }

describe('upsertFoodItem keeps the picture and the barcode', () => {
  it('a NON-NULL picture and barcode land', async () => {
    await new SQLiteLocalStore().upsertFoodItem(record())
    expect(stored()).toEqual({ barcode: '9300675024235', image_data_uri: PIC })
  })

  it('a later write that offers null does not blank them', async () => {
    const s = new SQLiteLocalStore()
    await s.upsertFoodItem(record())
    await s.upsertFoodItem(record({ imageDataUri: null, barcode: null, updatedAt: '2026-10-02T00:00:00Z' }))
    expect(stored()).toEqual({ barcode: '9300675024235', image_data_uri: PIC })
  })

  it('a pull that carries a picture replaces a stored one', async () => {
    const s = new SQLiteLocalStore()
    await s.upsertFoodItem(record())
    await s.upsertFoodItem(record({ imageDataUri: PIC2 }))
    expect(stored().image_data_uri).toBe(PIC2)
  })

  it('a row that never had a picture stays null (the placeholder is a first-class state)', async () => {
    await new SQLiteLocalStore().upsertFoodItem(record({ imageDataUri: null }))
    expect(stored().image_data_uri).toBeNull()
  })
})
