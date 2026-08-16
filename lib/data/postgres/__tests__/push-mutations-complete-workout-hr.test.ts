// Q-123(a): the outbox's complete_workout branch fired only the Oura HR *sync* half of the
// completion side effects, and only when the push request carried an origin+cookie — so a workout
// completed offline never got per-set HR attribution. That was a silent regression of the Q-11
// Defect B fix, which landed on the web route alone. Both paths now call
// syncAndAttributeSessionHr, and this proves the push path reaches the attribution half.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job
// has no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

// Was …c0de, which reconcile-counters.test.ts also used. Two DB-touching files on one id delete each
// other's rows in parallel workers; `scripts/check-test-user-ids.js` keeps them distinct.
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d0a4'

// The attribution pass is fire-and-forget by design (a completion must never block on it), so
// poll rather than assert immediately.
async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await read()
    if (v) return v
    if (Date.now() > deadline) return null
    await new Promise(r => setTimeout(r, 100))
  }
}

describe.skipIf(!canRun)('pushMutations complete_workout — HR attribution parity (Q-123a)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let workoutSessionId: string

  const startedAt = new Date(Date.now() - 60 * 60_000)
  const completedAt = new Date(Date.now() - 30 * 60_000)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `hr-attribution-${TEST_USER_ID}@example.com`],
    )

    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'HR Attribution Test', $2) RETURNING id`,
      [TEST_USER_ID, startedAt],
    )
    workoutSessionId = ws.rows[0].id

    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'Barbell Bench Press', 480, $2) RETURNING id`,
      [workoutSessionId, new Date(startedAt.getTime() + 11 * 60_000)],
    )
    // set_start_ms/set_end_ms are what the per-set attribution windows on — a set row without
    // them yields no set_hr_stats no matter how much HR is stored.
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, reps, weight_kg, intensity_pct, set_start_ms, set_end_ms)
       VALUES ($1, 1, 8, 60, 75, $2, $3)`,
      [
        el.rows[0].id,
        startedAt.getTime() + 10 * 60_000,
        startedAt.getTime() + 11 * 60_000,
      ],
    )

    // A minute-by-minute HR series across the session window, so there is something real to
    // attribute rather than an empty-readings no-op.
    const readings: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let i = 0; i < 45; i++) {
      const at = new Date(startedAt.getTime() + i * 60_000)
      params.push(at, 100 + (i % 20))
      readings.push(`($1, $${params.length - 1}, $${params.length}, 'workout')`)
    }
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${readings.join(',')}
       ON CONFLICT (user_id, timestamp) DO NOTHING`,
      params,
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('attributes per-workout and per-set HR when the completion arrives through the outbox', async () => {
    const result = await repo.pushMutations(TEST_USER_ID, [{
      id: 'mut-hr-1',
      domain: 'complete_workout',
      date: '2026-08-08',
      payload: { workoutSessionId, completedAtMs: completedAt.getTime() },
    } as never])
    expect(result.errors).toHaveLength(0)

    const workoutStats = await waitFor(async () => {
      const { rows } = await pool.query(
        `SELECT readings_count FROM workout_hr_stats WHERE user_id = $1 AND workout_session_id = $2`,
        [TEST_USER_ID, workoutSessionId],
      )
      return rows[0] ?? null
    })
    expect(workoutStats).not.toBeNull()
    expect(Number(workoutStats!.readings_count)).toBeGreaterThan(0)

    const setStats = await waitFor(async () => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM set_hr_stats WHERE user_id = $1 AND workout_session_id = $2`,
        [TEST_USER_ID, workoutSessionId],
      )
      return rows[0]?.n > 0 ? rows[0] : null
    })
    expect(setStats).not.toBeNull()
  })
})
