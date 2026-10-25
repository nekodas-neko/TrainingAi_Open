// #3153 — `oura_sessions.deleted_at`, the session tombstone column. It ships alone, before the code
// that writes and reads it, so this checks only the column: nullable with no default, a timestamptz,
// a live row reads it as null, and a value round-trips through Postgres.
//
// Runs against a real Postgres (DATABASE_URL) and skips without one. Synthetic values only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003153'

describe.skipIf(!canRun)('oura_sessions.deleted_at (#3153)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'issue-3153@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`DELETE FROM oura_sessions WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades oura_sessions
  })

  it('is a nullable timestamptz with no default', async () => {
    const col = (await pool.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'oura_sessions' AND column_name = 'deleted_at'`)).rows
    expect(col).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }])
  })

  it('reads null on a row written without it, and round-trips a value', async () => {
    await pool.query(
      `INSERT INTO oura_sessions (user_id, oura_id, day, session_type) VALUES ($1, 't3153-a', '2026-10-09', 'meditation')`, [USER])
    const read = async () => (await pool.query(`SELECT deleted_at FROM oura_sessions WHERE user_id = $1 AND oura_id = 't3153-a'`, [USER])).rows[0].deleted_at
    expect(await read()).toBeNull()
    const at = new Date('2026-10-09T02:00:00.000Z')
    await pool.query(`UPDATE oura_sessions SET deleted_at = $2 WHERE user_id = $1 AND oura_id = 't3153-a'`, [USER, at])
    expect(await read()).toEqual(at)
    await pool.query(`UPDATE oura_sessions SET deleted_at = NULL WHERE user_id = $1 AND oura_id = 't3153-a'`, [USER])
    expect(await read()).toBeNull()
  })
})
