// #3896 step 3: migration 202611212318 adds exercise_preferences. Nothing reads or writes it yet
// (steps 4 and 5 do), so this pins the migration itself: it re-runs cleanly, the unique keys refuse a
// second row for a lift, every CHECK refuses a bad value, a bare row means "no preference", a user's
// delete cascades, and the claude_ro view shows only the owner's rows.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { exercisePreferences } from '@/lib/data/postgres/schema'

const canRun = !!process.env.DATABASE_URL
const FILE = '202611212318_exercise_preferences.sql'
const USER_A = '00000000-0000-4000-8000-0000000038a1'
const USER_B = '00000000-0000-4000-8000-0000000038a2'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations', FILE), 'utf8')

describe('schema.ts matches migration 202611212318 (#3896)', () => {
  // No database needed: the Drizzle table is compared with what the SQL file declares.
  const body = () => migrationSql().split('CREATE TABLE IF NOT EXISTS exercise_preferences (')[1].split('\n);')[0]
  it('has the same columns in both', () => {
    const declared = body().split('\n').map(l => l.trim())
      .filter(l => /^[a-z_]+\s+(uuid|text|smallint|integer|timestamptz)\b/.test(l))
      .map(l => l.split(/\s+/)[0]).sort()
    expect(getTableConfig(exercisePreferences).columns.map(c => c.name).sort()).toEqual(declared)
  })
  it('has the same constraints and index in both', () => {
    const cfg = getTableConfig(exercisePreferences)
    const sqlNames = [...body().matchAll(/CONSTRAINT (\w+)/g)].map(m => m[1]).sort()
    const tsNames = [...cfg.checks.map(c => c.name), ...cfg.uniqueConstraints.map(u => u.name)]
      .filter((n): n is string => !!n).sort()
    // The name-empty CHECK is inline in the SQL (column check), named in schema.ts.
    expect(tsNames.filter(n => n !== 'exercise_preferences_exercise_name_check')).toEqual(sqlNames)
    expect(cfg.indexes.map(i => i.config.name)).toEqual(['exercise_preferences_user_exercise_id_key'])
    expect(migrationSql()).toContain('exercise_preferences_user_exercise_id_key')
  })
})

describe.skipIf(!canRun)('migration 202611212318 — exercise preferences (#3896)', () => {
  let pool: import('pg').Pool
  let libId: string
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await runMigrationSql(pool, migrationSql())
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `prefs-${id}@example.com`])
    }
    libId = (await pool.query(
      `INSERT INTO exercise_library (name) VALUES ('Test Lift 3896') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`)).rows[0].id
  })

  beforeEach(async () => { await lock.acquire() })
  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [libId])
  })

  const add = (userId: string, name: string, cols: Record<string, unknown> = {}, exerciseId: string | null = null) => {
    const all = { user_id: userId, exercise_name: name, exercise_id: exerciseId, source: 'coach', ...cols }
    const keys = Object.keys(all)
    return pool.query(
      `INSERT INTO exercise_preferences (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(all))
  }
  const refused = (p: Promise<unknown>, constraint: string) =>
    expect(p).rejects.toMatchObject({ code: '23514', constraint })

  it('re-runs cleanly', async () => {
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migrationSql())
    const cols = (await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'exercise_preferences'`)).rows.map(r => r.column_name)
    expect(cols).toContain('one_shot_set_at')
  })

  it('a bare row means no preference: every preference column is null', async () => {
    await add(USER_A, 'bare')
    const { rows } = await pool.query(
      `SELECT rep_min, rep_max, rest_sec, next_load_step, sets_delta, one_shot_set_at, deleted_at
         FROM exercise_preferences WHERE user_id = $1 AND exercise_name = 'bare'`, [USER_A])
    expect(rows[0]).toEqual({ rep_min: null, rep_max: null, rest_sec: null, next_load_step: null, sets_delta: null, one_shot_set_at: null, deleted_at: null })
  })

  it('refuses a second row for the same user and lift, by name and by id', async () => {
    await add(USER_A, 'dup')
    await expect(add(USER_A, 'dup')).rejects.toMatchObject({ code: '23505', constraint: 'exercise_preferences_lift_key' })
    await add(USER_B, 'dup') // another user: a different row
    await add(USER_A, 'by-id-1', {}, libId)
    await expect(add(USER_A, 'by-id-2', {}, libId)).rejects.toMatchObject({ code: '23505', constraint: 'exercise_preferences_user_exercise_id_key' })
    await add(USER_B, 'by-id-1', {}, libId)
    await add(USER_A, 'no-id-1'); await add(USER_A, 'no-id-2') // rows without an id do not collide
  })

  it('stores each of the four things', async () => {
    await add(USER_A, 'four', {
      rep_min: 10, rep_max: 15, rest_sec: 90, next_load_step: 'lighter', sets_delta: -1, one_shot_set_at: '2026-11-21T08:00:00Z',
    })
    const { rows } = await pool.query(
      `SELECT rep_min, rep_max, rest_sec, next_load_step, sets_delta FROM exercise_preferences WHERE user_id = $1 AND exercise_name = 'four'`, [USER_A])
    expect(rows[0]).toEqual({ rep_min: 10, rep_max: 15, rest_sec: 90, next_load_step: 'lighter', sets_delta: -1 })
  })

  it.each([
    ['rep_min below 1', { rep_min: 0, rep_max: 5 }],
    ['rep_min above rep_max', { rep_min: 12, rep_max: 8 }],
    ['rep_max above 30', { rep_min: 10, rep_max: 31 }],
    ['only rep_min', { rep_min: 8 }],
    ['only rep_max', { rep_max: 12 }],
  ])('refuses a bad rep range: %s', async (_n, cols) => {
    await refused(add(USER_A, 'bad-reps', cols), 'exercise_preferences_rep_range_check')
  })

  it('accepts the edges of the rep range', async () => {
    await add(USER_A, 'edge-1', { rep_min: 1, rep_max: 1 })
    await add(USER_A, 'edge-30', { rep_min: 30, rep_max: 30 })
  })

  it('refuses a negative rest and accepts zero', async () => {
    await refused(add(USER_A, 'rest-neg', { rest_sec: -1 }), 'exercise_preferences_rest_sec_check')
    await add(USER_A, 'rest-zero', { rest_sec: 0 })
  })

  it('refuses a one-shot step outside lighter / heavier, a set change outside ±1, and a bad source', async () => {
    const at = '2026-11-21T08:00:00Z'
    await refused(add(USER_A, 'step-bad', { next_load_step: 'same', one_shot_set_at: at }), 'exercise_preferences_next_load_step_check')
    await refused(add(USER_A, 'delta-2', { sets_delta: 2, one_shot_set_at: at }), 'exercise_preferences_sets_delta_check')
    await refused(add(USER_A, 'delta-0', { sets_delta: 0, one_shot_set_at: at }), 'exercise_preferences_sets_delta_check')
    await refused(add(USER_A, 'src-bad', { source: 'chat' }), 'exercise_preferences_source_check')
    await add(USER_A, 'heavier', { next_load_step: 'heavier', one_shot_set_at: at })
    await add(USER_A, 'plus-one', { sets_delta: 1, one_shot_set_at: at })
  })

  it('a one-shot always carries when it was set, and when set is never alone', async () => {
    await refused(add(USER_A, 'one-no-at', { next_load_step: 'lighter' }), 'exercise_preferences_one_shot_check')
    await refused(add(USER_A, 'at-no-one', { one_shot_set_at: '2026-11-21T08:00:00Z' }), 'exercise_preferences_one_shot_check')
  })

  it('consuming a one-shot is one update and leaves the lasting preference alone', async () => {
    await add(USER_A, 'consume', { rep_min: 10, rep_max: 15, next_load_step: 'lighter', one_shot_set_at: '2026-11-21T08:00:00Z' })
    await pool.query(
      `UPDATE exercise_preferences SET next_load_step = NULL, sets_delta = NULL, one_shot_set_at = NULL
        WHERE user_id = $1 AND exercise_name = 'consume'`, [USER_A])
    const { rows } = await pool.query(`SELECT rep_min, next_load_step FROM exercise_preferences WHERE user_id = $1 AND exercise_name = 'consume'`, [USER_A])
    expect(rows[0]).toEqual({ rep_min: 10, next_load_step: null })
  })

  it('a tombstoned row still holds the key, so setting it again revives it', async () => {
    await add(USER_A, 'tomb', { rep_min: 8, rep_max: 12, deleted_at: '2026-11-21T08:00:00Z' })
    await expect(add(USER_A, 'tomb')).rejects.toMatchObject({ code: '23505' })
  })

  it('cascades on the user, and keeps the row when the library lift goes (id set null)', async () => {
    const tmp = '00000000-0000-4000-8000-0000000038a3'
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`, [tmp, `prefs-${tmp}@example.com`])
    await add(tmp, 'gone')
    await pool.query(`DELETE FROM users WHERE id = $1`, [tmp])
    expect((await pool.query(`SELECT 1 FROM exercise_preferences WHERE user_id = $1`, [tmp])).rowCount).toBe(0)

    const lib = (await pool.query(`INSERT INTO exercise_library (name) VALUES ('Test Lift 3896 b') RETURNING id`)).rows[0].id
    await add(USER_B, 'orphan', {}, lib)
    await pool.query(`DELETE FROM exercise_library WHERE id = $1`, [lib])
    const { rows } = await pool.query(`SELECT exercise_id FROM exercise_preferences WHERE user_id = $1 AND exercise_name = 'orphan'`, [USER_B])
    expect(rows[0].exercise_id).toBeNull()
  })

  it("the committed claude_ro view is scoped to the owner's rows only", async () => {
    const file = readFileSync(join(process.cwd(), 'lib/data/postgres/claude-ro-views.sql'), 'utf8')
    const m = file.match(/CREATE VIEW claude_ro\.exercise_preferences AS[\s\S]*?;\n/)
    expect(m).not.toBeNull()
    expect(m![0]).toContain(`WHERE t.user_id = current_setting('app.claude_ro_owner', true)::uuid`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE SCHEMA IF NOT EXISTS claude_ro')
      await client.query(m![0].replace('CREATE VIEW', 'CREATE OR REPLACE VIEW'))
      for (const u of [USER_A, USER_B]) {
        await client.query(`INSERT INTO exercise_preferences (user_id, exercise_name, source) VALUES ($1, 'scope', 'coach') ON CONFLICT DO NOTHING`, [u])
      }
      await client.query(`SELECT set_config('app.claude_ro_owner', $1, true)`, [USER_B])
      const rows = await client.query(`SELECT user_id FROM claude_ro.exercise_preferences`)
      expect(rows.rows.length).toBeGreaterThan(0)
      expect(new Set(rows.rows.map(r => r.user_id))).toEqual(new Set([USER_B]))
      await client.query(`SELECT set_config('app.claude_ro_owner', '00000000-0000-4000-8000-0000000000ff', true)`)
      expect((await client.query(`SELECT 1 FROM claude_ro.exercise_preferences`)).rowCount).toBe(0)
    } finally {
      await client.query('ROLLBACK'); client.release()
    }
  })
})
