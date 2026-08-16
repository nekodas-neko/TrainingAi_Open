// The BLE rollup derives `oura_id` as `ble:<startDs>` from the ring's own counter — no user
// component — while `sleep_sessions.oura_id` was GLOBALLY unique. Two people wearing rings collide,
// and because the rollup's insert arbitrates on (user_id, sleep_start) the collision surfaces as an
// unhandled unique violation, which aggregateOuraRawSamples files into `stepErrors` rather than
// throwing. The second user's sleep would silently stop landing.
//
// Migration 166 moves the constraint to (user_id, oura_id) WHERE oura_id IS NOT NULL.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-00000000fa01'
const USER_B = '00000000-0000-4000-8000-00000000fa02'
// The exact shape the rollup produces: identical for both users, because it is derived from the
// ring counter alone.
const COLLIDING_ID = 'ble:1000000'

describe.skipIf(!canRun)('sleep_sessions.oura_id — per-user uniqueness (migration 166)', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `oura-id-scope-${tag}@example.com`])
      await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    for (const id of [USER_A, USER_B]) {
      await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [id])
    }
  })

  const insert = (userId: string, ouraId: string | null, startIso: string) => pool.query(
    `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id)
     VALUES ($1, '2026-07-20', $2::timestamptz, $2::timestamptz + interval '7 hours', 7, $3)`,
    [userId, startIso, ouraId])

  it('lets two users hold the same ring-derived id', async () => {
    await insert(USER_A, COLLIDING_ID, '2026-07-19T12:00:00Z')
    // Before migration 166 this threw sleep_sessions_oura_id_key and user B's night vanished.
    await expect(insert(USER_B, COLLIDING_ID, '2026-07-19T13:00:00Z')).resolves.toBeDefined()

    const { rows } = await pool.query(
      `SELECT user_id FROM sleep_sessions WHERE oura_id = $1 ORDER BY user_id`, [COLLIDING_ID])
    expect(rows).toHaveLength(2)
  })

  it('still rejects a duplicate id within one user', async () => {
    await expect(insert(USER_A, COLLIDING_ID, '2026-07-19T20:00:00Z')).rejects.toThrow()
  })

  it('leaves rows without an id alone — most nights have none', async () => {
    // The index is partial on oura_id IS NOT NULL, and Postgres treats NULLs as distinct anyway;
    // manual and Health Connect nights must not start colliding with each other.
    await expect(insert(USER_A, null, '2026-07-21T12:00:00Z')).resolves.toBeDefined()
    await expect(insert(USER_A, null, '2026-07-22T12:00:00Z')).resolves.toBeDefined()
  })
})
