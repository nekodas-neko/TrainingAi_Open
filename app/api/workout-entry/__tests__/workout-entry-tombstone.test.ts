// Integration test: SYN-3 — editing an exercise log down to fewer sets must
// tombstone the removed tail sets (deleted_at) instead of hard-DELETEing them,
// so a device that hasn't pulled yet still sees the deletion via getSyncDelta,
// and re-adding a set later resurrects the same row.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else
// (CI's "Tests" job has no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000007a11'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

function jsonReq(url: string, body: object) {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never
}

describe.skipIf(!canRun)('workout-entry PATCH tail-set tombstone (SYN-3)', () => {
  let pool: import('pg').Pool
  let workoutSessionId: string
  let exerciseLogId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `tombstone-test-${TEST_USER_ID}@example.com`],
    )
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Tombstone Test', now()) RETURNING id`,
      [TEST_USER_ID],
    )
    workoutSessionId = ws.rows[0].id
    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, 'Bench Press', now()) RETURNING id`,
      [workoutSessionId],
    )
    exerciseLogId = el.rows[0].id
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('tombstones a removed tail set, then resurrects it on re-add', async () => {
    const { PATCH } = await import('../route')

    // Log 3 sets.
    let res = await PATCH(jsonReq('http://localhost/api/workout-entry', {
      exerciseLogId, weights: [100, 100, 100], reps: [5, 5, 5],
    }))
    expect(res.status).toBe(200)
    let rows = await pool.query(
      `SELECT set_number, deleted_at FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`,
      [exerciseLogId],
    )
    expect(rows.rows.map(r => r.set_number)).toEqual([1, 2, 3])
    expect(rows.rows.every(r => r.deleted_at === null)).toBe(true)

    // Edit down to 2 sets — set 3 must be tombstoned, not hard-deleted.
    res = await PATCH(jsonReq('http://localhost/api/workout-entry', {
      exerciseLogId, weights: [100, 100], reps: [5, 5],
    }))
    expect(res.status).toBe(200)
    rows = await pool.query(
      `SELECT set_number, deleted_at FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`,
      [exerciseLogId],
    )
    expect(rows.rows.length).toBe(3) // still 3 physical rows — set 3 tombstoned, not deleted
    const set3 = rows.rows.find(r => r.set_number === 3)
    expect(set3?.deleted_at).not.toBeNull()

    // Re-edit back to 3 sets — set 3 must resurrect (deleted_at cleared) via the same row.
    res = await PATCH(jsonReq('http://localhost/api/workout-entry', {
      exerciseLogId, weights: [100, 100, 110], reps: [5, 5, 4],
    }))
    expect(res.status).toBe(200)
    rows = await pool.query(
      `SELECT set_number, weight_kg, deleted_at FROM set_logs WHERE exercise_log_id = $1 ORDER BY set_number`,
      [exerciseLogId],
    )
    expect(rows.rows.length).toBe(3)
    const resurrected = rows.rows.find(r => r.set_number === 3)
    expect(resurrected?.deleted_at).toBeNull()
    expect(Number(resurrected?.weight_kg)).toBe(110)
  })
})
