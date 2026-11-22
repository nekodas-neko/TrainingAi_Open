// #3898 step 1: migration 202611212239 adds source_rest_periods and source_day_tags. Nothing reads or
// writes them yet (step 2 does), so this pins the migration itself: it re-runs cleanly and is
// recorded, the unique key refuses a duplicate source record, one day-tags table holds both
// generations of a source's tag without loss, a user's delete cascades, and the claude_ro views show
// only the owner's rows.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { sourceRestPeriods, sourceDayTags } from '@/lib/data/postgres/schema'

const canRun = !!process.env.DATABASE_URL
const FILE = '202611212239_source_rest_periods_and_day_tags.sql'
const USER_A = '00000000-0000-4000-8000-00000000389a'
const USER_B = '00000000-0000-4000-8000-00000000389b'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations', FILE), 'utf8')

const columnsOf = async (pool: import('pg').Pool, table: string) =>
  (await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table])).rows.map(r => r.column_name).sort()

describe('schema.ts matches migration 202611212239 (#3898)', () => {
  // No database needed: the Drizzle columns are compared with the columns the SQL file declares.
  const declared = (table: string) => {
    const body = migrationSql().split(`CREATE TABLE IF NOT EXISTS ${table} (`)[1].split('\n);')[0]
    return body.split('\n')
      .map(l => l.trim())
      .filter(l => /^[a-z_]+\s+(uuid|text|date|timestamptz|jsonb|text\[\])\b/.test(l))
      .map(l => l.split(/\s+/)[0])
      .sort()
  }
  it.each([
    ['source_rest_periods', sourceRestPeriods],
    ['source_day_tags', sourceDayTags],
  ])('%s has the same columns in both', (name, table) => {
    expect(getTableConfig(table).columns.map(c => c.name).sort()).toEqual(declared(name))
  })
})

describe.skipIf(!canRun)('migration 202611212239 — source rest periods and day tags (#3898)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await runMigrationSql(pool, migrationSql())
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `tags-${id}@example.com`])
    }
  })

  beforeEach(async () => { await lock.acquire() })
  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  const addTag = (userId: string, recordId: string, source = 'oura_cloud') =>
    pool.query(
      `INSERT INTO source_day_tags (user_id, source, source_record_id, start_day, start_at)
       VALUES ($1, $2, $3, '2026-11-18', '2026-11-18T08:00:00+10:00')`, [userId, source, recordId])
  const addRest = (userId: string, recordId: string, source = 'oura_cloud') =>
    pool.query(
      `INSERT INTO source_rest_periods (user_id, source, source_record_id, start_day)
       VALUES ($1, $2, $3, '2026-11-10')`, [userId, source, recordId])

  it('re-runs cleanly, and the file is recorded by the runner', async () => {
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migrationSql())
    expect(await columnsOf(pool, 'source_rest_periods')).toContain('source_record_id')
    expect(await columnsOf(pool, 'source_day_tags')).toContain('tag_codes')
    const recorded = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [FILE])
    // The runner records every applied file; a bare test database may have been built another way.
    if ((await pool.query(`SELECT to_regclass('schema_migrations') AS t`)).rows[0].t) {
      expect(recorded.rowCount).toBe(1)
    }
  })

  it('refuses a duplicate source record, per user and source, in both tables', async () => {
    await addRest(USER_A, 'dup-rest')
    await expect(addRest(USER_A, 'dup-rest')).rejects.toMatchObject({ code: '23505', constraint: 'source_rest_periods_record_key' })
    await addTag(USER_A, 'dup-tag')
    await expect(addTag(USER_A, 'dup-tag')).rejects.toMatchObject({ code: '23505', constraint: 'source_day_tags_record_key' })
    // The same id under another source, or for another user, is a different record.
    await expect(addTag(USER_A, 'dup-tag', 'other_source')).resolves.toBeTruthy()
    await expect(addTag(USER_B, 'dup-tag')).resolves.toBeTruthy()
  })

  it('refuses an empty source or source record id', async () => {
    await expect(addTag(USER_A, 'x', '')).rejects.toMatchObject({ code: '23514' })
    await expect(addRest(USER_A, '')).rejects.toMatchObject({ code: '23514' })
  })

  it('holds a text-only note, a custom tag with a span, and a multi-code older tag without loss', async () => {
    await pool.query(
      `INSERT INTO source_day_tags (user_id, source, source_record_id, start_day, end_day, start_at, end_at, tag_codes, custom_name, comment)
       VALUES ($1, 'oura_cloud', 'shape-1', '2026-11-18', '2026-11-19', '2026-11-18T20:00:00+10:00', '2026-11-19T06:00:00+10:00', '{custom}', 'late dinner', 'ate at nine'),
              ($1, 'oura_cloud', 'shape-2', '2026-11-18', NULL, '2026-11-18T08:00:00+10:00', NULL, '{}', NULL, 'just a note'),
              ($1, 'oura_cloud', 'shape-3', '2026-11-18', NULL, '2026-11-18T09:00:00+10:00', NULL, '{a_code,b_code}', NULL, NULL)`, [USER_A])
    const { rows } = await pool.query(
      `SELECT source_record_id, tag_codes, custom_name, comment, end_at IS NULL AS open_ended
         FROM source_day_tags WHERE user_id = $1 AND source_record_id LIKE 'shape-%' ORDER BY source_record_id`, [USER_A])
    expect(rows).toEqual([
      { source_record_id: 'shape-1', tag_codes: ['custom'], custom_name: 'late dinner', comment: 'ate at nine', open_ended: false },
      { source_record_id: 'shape-2', tag_codes: [], custom_name: null, comment: 'just a note', open_ended: true },
      { source_record_id: 'shape-3', tag_codes: ['a_code', 'b_code'], custom_name: null, comment: null, open_ended: true },
    ])
  })

  it('holds a rest period that is still on, with its episodes, and defaults episodes to []', async () => {
    await pool.query(
      `INSERT INTO source_rest_periods (user_id, source, source_record_id, start_day, episodes)
       VALUES ($1, 'oura_cloud', 'ep-1', '2026-11-10', '[{"at":"2026-11-11T07:00:00+10:00","tags":["x"]}]')`, [USER_A])
    await addRest(USER_A, 'ep-2')
    const { rows } = await pool.query(
      `SELECT source_record_id, end_day, episodes FROM source_rest_periods
        WHERE user_id = $1 AND source_record_id LIKE 'ep-%' ORDER BY source_record_id`, [USER_A])
    expect(rows).toEqual([
      { source_record_id: 'ep-1', end_day: null, episodes: [{ at: '2026-11-11T07:00:00+10:00', tags: ['x'] }] },
      { source_record_id: 'ep-2', end_day: null, episodes: [] },
    ])
  })

  it('cascades on the user, and leaves the other user alone', async () => {
    const tmp = '00000000-0000-4000-8000-00000000389c'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')`,
      [tmp, `tags-${tmp}@example.com`])
    await addTag(tmp, 'gone'); await addRest(tmp, 'gone')
    await pool.query(`DELETE FROM users WHERE id = $1`, [tmp])
    for (const t of ['source_day_tags', 'source_rest_periods']) {
      expect((await pool.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [tmp])).rowCount).toBe(0)
    }
    expect((await pool.query(`SELECT 1 FROM source_day_tags WHERE user_id = $1`, [USER_A])).rowCount).toBeGreaterThan(0)
  })

  it("the committed claude_ro view definitions are scoped to the owner's rows only", async () => {
    // The two CREATE VIEW statements are taken from the committed file and run inside a transaction
    // that is rolled back, so the check does not depend on the boot rebuild having run or on the
    // claude_readonly role existing. The owner setting is changed per transaction.
    const file = readFileSync(join(process.cwd(), 'lib/data/postgres/claude-ro-views.sql'), 'utf8')
    const stmt = (view: string) => {
      const m = file.match(new RegExp(`CREATE VIEW claude_ro\\.${view} AS[\\s\\S]*?;\\n`))
      expect(m, `${view} is in claude-ro-views.sql`).not.toBeNull()
      expect(m![0]).toContain(`WHERE t.user_id = current_setting('app.claude_ro_owner', true)::uuid`)
      return m![0].replace('CREATE VIEW', 'CREATE OR REPLACE VIEW')
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('CREATE SCHEMA IF NOT EXISTS claude_ro')
      await client.query(stmt('source_day_tags'))
      await client.query(stmt('source_rest_periods'))
      for (const u of [USER_A, USER_B]) {
        await client.query(
          `INSERT INTO source_day_tags (user_id, source, source_record_id, start_day, start_at)
           VALUES ($1, 'oura_cloud', 'scope', '2026-11-18', '2026-11-18T08:00:00+10:00')`, [u])
        await client.query(
          `INSERT INTO source_rest_periods (user_id, source, source_record_id, start_day)
           VALUES ($1, 'oura_cloud', 'scope', '2026-11-10')`, [u])
      }
      await client.query(`SELECT set_config('app.claude_ro_owner', $1, true)`, [USER_B])
      for (const v of ['source_day_tags', 'source_rest_periods']) {
        const rows = await client.query(`SELECT user_id, source_record_id FROM claude_ro.${v}`)
        expect(rows.rows.length).toBeGreaterThan(0)
        expect(new Set(rows.rows.map(r => r.user_id))).toEqual(new Set([USER_B]))
      }
      await client.query(`SELECT set_config('app.claude_ro_owner', '00000000-0000-4000-8000-0000000000ff', true)`)
      expect((await client.query(`SELECT 1 FROM claude_ro.source_rest_periods`)).rowCount).toBe(0)
    } finally {
      await client.query('ROLLBACK'); client.release()
    }
  })
})
