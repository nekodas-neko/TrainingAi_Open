// Migration 148 (audit finding Q-12) — bodyweight 1RM history rebased onto the fixed BW_REF,
// and the two phantom bodyweight PRs re-derived from the corrected logs.
//
// The estimate backfill targets specific production row ids, so what is testable here is the
// half that runs everywhere: the PR re-derive, plus the guarantee that the id-targeted UPDATE
// is inert on a database that does not carry those rows (every fresh/dev/CI database).
//
// Runs only against a real Postgres. NOTE: CI's "Tests" job DOES set DATABASE_URL, so these run
// there; reproduce CI locally by setting it too, or vitest silently skips ~49 tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL

const USER_A = '00000000-0000-4000-8000-0000000b0d01'
const USER_B = '00000000-0000-4000-8000-0000000b0d02'
const EX_NAME = 'Q12 Test Pull-Up'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/148_bodyweight_1rm_fixed_reference.sql'), 'utf8')

describe.skipIf(!canRun)('migration 148 — bodyweight PR re-derive (Q-12)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    // After `pool` is assigned: the lock resolves it lazily, and acquiring first would call
    // getPool() on an undefined binding.
    await lock.acquire()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `q12-${id}@example.com`],
      )
    }
    await pool.query(
      `INSERT INTO exercise_library (name, exercise_type, muscles) VALUES ($1, 'bodyweight', '[]'::jsonb)
       ON CONFLICT (name) DO UPDATE SET exercise_type = 'bodyweight'`,
      [EX_NAME],
    )
  })

  afterAll(async () => {
    await lock.release()
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM exercise_library WHERE name = $1`, [EX_NAME])
  })

  // Seeds one session carrying one exercise log at `oneRm`, and returns the log's logged_at.
  async function seedLog(userId: string, oneRm: number, daysAgo: number): Promise<Date> {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Q12', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval)
       RETURNING id`,
      [userId, String(daysAgo)],
    )
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, volume, logged_at)
       VALUES ($1, $2, $3::double precision, $3::double precision * 0.8, 0, now() - ($4 || ' days')::interval)
       RETURNING logged_at`,
      [ws.rows[0].id, EX_NAME, oneRm, String(daysAgo)],
    )
    return el.rows[0].logged_at
  }

  it('moves a PR off the latest log and onto the all-time best, without crossing users', async () => {
    // User A's best is the OLDER log — exactly the production shape, where the changeover
    // session was recorded as a PR while a stronger earlier session was ignored.
    const bestA = await seedLog(USER_A, 118, 30)
    await seedLog(USER_A, 113, 5)
    // User B trains the same movement but is much weaker. A re-derive that grouped by
    // exercise_name alone would stamp A's 118 onto B's record.
    const bestB = await seedLog(USER_B, 90, 10)

    await pool.query(
      `INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at)
       VALUES ($1, $3, 113, now()), ($2, $3, 60, now())`,
      [USER_A, USER_B, EX_NAME],
    )

    await pool.query(migrationSql())

    const rows = (await pool.query(
      `SELECT user_id, estimated_1rm, achieved_at FROM personal_records WHERE exercise_name = $1`,
      [EX_NAME])).rows
    const byUser = new Map(rows.map(r => [r.user_id, r]))

    expect(Number(byUser.get(USER_A).estimated_1rm)).toBe(118)
    expect(new Date(byUser.get(USER_A).achieved_at).getTime()).toBe(new Date(bestA).getTime())
    expect(Number(byUser.get(USER_B).estimated_1rm)).toBe(90)
    expect(new Date(byUser.get(USER_B).achieved_at).getTime()).toBe(new Date(bestB).getTime())
  })

  it('is idempotent — a second run changes nothing', async () => {
    const before = (await pool.query(
      `SELECT user_id, estimated_1rm, achieved_at FROM personal_records WHERE exercise_name = $1 ORDER BY user_id`,
      [EX_NAME])).rows
    await pool.query(migrationSql())
    const after = (await pool.query(
      `SELECT user_id, estimated_1rm, achieved_at FROM personal_records WHERE exercise_name = $1 ORDER BY user_id`,
      [EX_NAME])).rows
    expect(after).toEqual(before)
  })

  it('leaves a deloaded log out of the re-derive', async () => {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, is_early_deload)
       VALUES ($1, 'Q12 deload', now(), now(), true) RETURNING id`,
      [USER_A],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, volume, logged_at)
       VALUES ($1, $2, 400, 320, 0, now())`,
      [ws.rows[0].id, EX_NAME],
    )
    await pool.query(migrationSql())
    const [row] = (await pool.query(
      `SELECT estimated_1rm FROM personal_records WHERE user_id = $1 AND exercise_name = $2`,
      [USER_A, EX_NAME])).rows
    expect(Number(row.estimated_1rm)).toBe(118)
  })

  it('the id-targeted estimate backfill is inert on a database without those rows', async () => {
    // Every fresh, dev and CI database is in this state — the statement must simply match nothing
    // rather than error or touch unrelated logs.
    const before = (await pool.query(
      `SELECT count(*)::int AS n FROM exercise_logs WHERE exercise_name = $1`, [EX_NAME])).rows[0].n
    await pool.query(migrationSql())
    const after = (await pool.query(
      `SELECT count(*)::int AS n FROM exercise_logs WHERE exercise_name = $1`, [EX_NAME])).rows[0].n
    expect(after).toBe(before)
  })
})
