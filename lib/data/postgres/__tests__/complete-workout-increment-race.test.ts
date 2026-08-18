// Q-473: four concurrent `POST /api/complete-workout` for ONE session left `sessions_in_phase`
// at 3 — reproduced in 4 of 5 measured trials. Every racer read `completed_at IS NULL` before any
// of them wrote, so every racer believed it was the first completion and incremented.
//
// The guarded UPDATE was never the problem: `completeWorkoutSession` carries
// `isNull(completed_at)` in its WHERE, so the database already elects exactly one winner. It just
// returned void, throwing away the affected-row count that says which one. This proves the count
// is now returned, and that it is the winner-electing one — a plain `IS NULL` read cannot make
// that claim, because the whole failure is that two readers agree.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000000473'

describe.skipIf(!canRun)('completeWorkoutSession elects one winner (Q-473)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `complete-race-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  async function freshSession(): Promise<string> {
    const r = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Q-473 race', $2) RETURNING id`,
      [TEST_USER_ID, new Date(Date.now() - 60 * 60_000)],
    )
    return r.rows[0].id
  }

  it('returns true exactly once across four simultaneous completions', async () => {
    const id = await freshSession()
    const at = new Date()

    const results = await Promise.all(
      Array.from({ length: 4 }, () => repo.completeWorkoutSession(id, TEST_USER_ID, at)),
    )

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('returns false on a sequential replay, and does not move completed_at', async () => {
    const id = await freshSession()
    const first = new Date(Date.now() - 30 * 60_000)

    expect(await repo.completeWorkoutSession(id, TEST_USER_ID, first)).toBe(true)
    expect(await repo.completeWorkoutSession(id, TEST_USER_ID, new Date())).toBe(false)

    const r = await pool.query('SELECT completed_at FROM workout_sessions WHERE id = $1', [id])
    expect(new Date(r.rows[0].completed_at).getTime()).toBe(first.getTime())
  })

  // The end-to-end claim, which is what was actually measured as wrong: four simultaneous
  // completions of one session must advance sessions_in_phase by exactly 1. The unit test above
  // proves the primitive; this proves the caller uses it.
  it('advances sessions_in_phase exactly once across four simultaneous completeWorkoutFromPayload calls', async () => {
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'Q-473 program', false) RETURNING id`,
      [TEST_USER_ID],
    )
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Q-473 session', 1) RETURNING id`,
      [prog.rows[0].id],
    )
    const programSessionId = ps.rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, sessions_in_phase) VALUES ($1, $2, 0)`,
      [TEST_USER_ID, programSessionId],
    )
    // Q-474: the live link is workout_sessions.session_id. Populating program_session_id instead
    // makes the periodization block skip entirely and the race look absent.
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'Q-473 race', $3) RETURNING id`,
      [TEST_USER_ID, programSessionId, new Date(Date.now() - 60 * 60_000)],
    )
    const workoutSessionId = ws.rows[0].id

    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')

    // Warm the module graph and the connection pool on a throwaway session first. Without this the
    // four calls do NOT race: the first one pays for the lazy `import('@/lib/data')`, the
    // getRepository singleton and four cold pg connections, and finishes writing before the others
    // reach their read — so the bug this test exists for does not reproduce and the test passes on
    // the broken code. Verified both ways before this line was added.
    const warm = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, 'Q-473 warm', now()) RETURNING id`,
      [TEST_USER_ID],
    )
    await Promise.all([
      completeWorkoutFromPayload(TEST_USER_ID, { workoutSessionId: warm.rows[0].id }),
      ...Array.from({ length: 3 }, () => pool.query('SELECT 1')),
    ])

    await Promise.all(
      Array.from({ length: 4 }, () => completeWorkoutFromPayload(TEST_USER_ID, { workoutSessionId })),
    )

    // incrementSessionsInPhase is fire-and-forget (advisory — it must never fail a completion),
    // so let the in-flight ones land before reading.
    await new Promise(r => setTimeout(r, 500))
    const after = await pool.query(
      'SELECT sessions_in_phase FROM session_periodization WHERE user_id = $1 AND program_session_id = $2',
      [TEST_USER_ID, programSessionId],
    )
    expect(after.rows[0].sessions_in_phase).toBe(1)

    await pool.query('DELETE FROM programs WHERE id = $1', [prog.rows[0].id])
  })

  it('returns false for another user, so a cross-account call cannot claim the completion', async () => {
    const id = await freshSession()
    const otherUser = '00000000-0000-4000-8000-000000000474'

    expect(await repo.completeWorkoutSession(id, otherUser, new Date())).toBe(false)

    const r = await pool.query('SELECT completed_at FROM workout_sessions WHERE id = $1', [id])
    expect(r.rows[0].completed_at).toBeNull()
  })
})
