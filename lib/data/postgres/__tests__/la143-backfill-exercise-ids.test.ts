// LA-143 — migration 295 fills session_exercises.exercise_id from exercise_library by name, only where
// it is NULL. Runs in a throwaway database holding just the two tables, so its UPDATE cannot touch
// rows other test files own.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { withDatabase } from './migration-test-lock'

const canRun = !!process.env.DATABASE_URL
const MIGRATION = readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/295_backfill_session_exercise_ids.sql'), 'utf8')
const PROBE_DB = 'la143_backfill_probe'

describe.skipIf(!canRun)('migration 295 — backfill session_exercises.exercise_id (LA-143)', () => {
  let admin: Pool
  let probe: Pool

  beforeAll(async () => {
    admin = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, 'postgres'), max: 1 })
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.query(`CREATE DATABASE ${PROBE_DB}`)
    probe = new Pool({ connectionString: withDatabase(process.env.DATABASE_URL!, PROBE_DB), max: 1 })
  })

  afterAll(async () => {
    if (!canRun) return
    await probe?.end()
    await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`)
    await admin.end()
  })

  beforeEach(async () => {
    await probe.query(`
      DROP TABLE IF EXISTS session_exercises; DROP TABLE IF EXISTS exercise_library;
      CREATE TABLE exercise_library (id uuid PRIMARY KEY, name text NOT NULL UNIQUE);
      CREATE TABLE session_exercises (id serial PRIMARY KEY, exercise_name text NOT NULL, exercise_id uuid);
      INSERT INTO exercise_library VALUES
        ('00000000-0000-4000-8000-00000000000a', 'Bench Press'),
        ('00000000-0000-4000-8000-00000000000b', 'Squat');
      INSERT INTO session_exercises (exercise_name, exercise_id) VALUES
        ('Bench Press', NULL),
        ('Squat', NULL),
        ('Squat', '00000000-0000-4000-8000-0000000000cc'),
        ('Made-up Lift', NULL);
    `)
  })

  const rows = async () => (await probe.query(
    `SELECT exercise_name, exercise_id::text FROM session_exercises ORDER BY id`)).rows

  it('fills a NULL from the library by name, never overwrites a set value, and leaves a no-match alone', async () => {
    await probe.query(MIGRATION)
    expect(await rows()).toEqual([
      { exercise_name: 'Bench Press', exercise_id: '00000000-0000-4000-8000-00000000000a' },
      { exercise_name: 'Squat', exercise_id: '00000000-0000-4000-8000-00000000000b' },
      { exercise_name: 'Squat', exercise_id: '00000000-0000-4000-8000-0000000000cc' },
      { exercise_name: 'Made-up Lift', exercise_id: null },
    ])
  })

  it('is a no-op on a second run', async () => {
    await probe.query(MIGRATION)
    const once = await rows()
    await probe.query(MIGRATION)
    expect(await rows()).toEqual(once)
  })
})
