// Migration 269 (BF-129) — 22 catalogue rows carried `equipment = '{}'`, and both equipment
// filters read an empty list as an unconditional pass, so an unlabelled row cleared EVERY
// equipment selection anyone could make. Three of the 22 were machines, which is how a home gym
// with no machines was offered Machine Chest Press.
//
// These assert the migration's BEHAVIOUR against rows this test creates itself, rather than
// asserting the catalogue's current contents: the catalogue is only partly seeded (production held
// 151 rows against a freshly-migrated 141, because POST /api/exercises writes to the same shared
// table at runtime), so a test pinned to live rows would be asserting whatever a user last added.
//
// Runs only against a real Postgres. CI's "Tests" job sets DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const migrationSql = () =>
  readFileSync(
    join(process.cwd(), 'lib/data/postgres/migrations/269_exercise_library_equipment_backfill.sql'),
    'utf8',
  )

describe.skipIf(!canRun)('migration 269 — exercise_library equipment backfill (BF-129)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  // Names the migration touches. Reset to '{}' before each case so the assertions are about what
  // the migration DOES, not about whether it happened to have run already.
  const NAMED = ['Machine Chest Press', 'Cable Crunch Abs', 'Rack Pull', 'Side Plank', 'Weighted Dip']

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
  })

  afterEach(async () => { await lock.release() })

  beforeEach(async () => { await lock.acquire() })

  afterAll(async () => {
    // Leave the catalogue as the migration would: re-run it so a reset row does not outlive the file.
    if (!canRun) return
    await pool.query(migrationSql())
  })

  const equipmentOf = async (name: string): Promise<string[] | null> => {
    const { rows } = await pool.query('SELECT equipment FROM exercise_library WHERE name = $1', [name])
    return rows[0]?.equipment ?? null
  }

  it('labels every row it names, and gives each the equipment its name implies', async () => {
    await pool.query(`UPDATE exercise_library SET equipment = '{}' WHERE name = ANY($1)`, [NAMED])
    for (const name of NAMED) {
      if (await equipmentOf(name) === null) continue // not in this database's seed
      expect(await equipmentOf(name)).toEqual([])
    }

    await pool.query(migrationSql())

    const expected: Record<string, string[]> = {
      'Machine Chest Press': ['machine'],
      'Cable Crunch Abs':    ['cable'],
      'Rack Pull':           ['barbell'],
      'Side Plank':          ['bodyweight'],
      'Weighted Dip':        ['bodyweight', 'machine'],
    }
    for (const [name, equipment] of Object.entries(expected)) {
      const actual = await equipmentOf(name)
      if (actual === null) continue
      expect(actual, name).toEqual(equipment)
    }
  })

  it('does not overwrite a row that already declares equipment', async () => {
    if (await equipmentOf('Rack Pull') === null) return
    await pool.query(`UPDATE exercise_library SET equipment = $1 WHERE name = 'Rack Pull'`, [['kettlebell']])

    await pool.query(migrationSql())

    // The UPDATE is guarded on the row still being unlabelled, so a later correction survives a
    // replay. Migration Check replays every file against the schema it just built.
    expect(await equipmentOf('Rack Pull')).toEqual(['kettlebell'])
  })

  it('leaves no selectable row unlabelled among the names it covers', async () => {
    await pool.query(`UPDATE exercise_library SET equipment = '{}' WHERE name = ANY($1)`, [NAMED])
    await pool.query(migrationSql())

    const { rows } = await pool.query(
      `SELECT name FROM exercise_library
       WHERE name = ANY($1) AND merged_into IS NULL AND coalesce(array_length(equipment, 1), 0) = 0`,
      [NAMED],
    )
    expect(rows.map(r => r.name)).toEqual([])
  })
})
