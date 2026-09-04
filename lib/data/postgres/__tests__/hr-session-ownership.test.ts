import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Q-155, the residual its own mutation harness is structurally blind to.
//
// That harness neutralises `user_id` PREDICATES. These three methods had no predicate to neutralise:
// `getSetDetailsForSession`, `getSetTimestampsForSession` and `markHrSynced` took a session id and
// constrained ownership NOWHERE — no predicate, no join condition, no pre-check. They were safe only
// because every caller happened to pass an id from a user-scoped query, which is a property of the
// callers and not of these functions. Two had no production caller at all.
//
// `scripts/check-repository-user-scoping.js` cannot see this either: it fails a method that TAKES
// `userId` and never uses it. Nothing catches one that never asked for it.
//
// Runs against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000155aa'
const USER_B = '00000000-0000-4000-8000-0000000155bb'

describe.skipIf(!canRun)('HR session reads and writes are owner-scoped (Q-155)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let bSessionId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()

    for (const [id, tag] of [[USER_A, 'a'], [USER_B, 'b']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone)
         VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `hr-session-ownership-${tag}@example.com`])
    }

    // One completed session belonging to B, with one exercise and one set under it.
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'ownership fixture', now() - interval '2 hours', now() - interval '1 hour')
       RETURNING id`, [USER_B])
    bSessionId = ws.rows[0].id

    const el = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1, 'B SECRET SQUAT', 1000, now()) RETURNING id`, [bSessionId])

    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, set_start_ms, set_end_ms)
       VALUES ($1, 1, 100, 5, 1000, 2000)`, [el.rows[0].id])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  // The fixture has to be able to fail. If B's own read came back empty these would all pass
  // vacuously, which is the trap Q-155 records from its own first attempt.
  it('B can read their own session — the control', async () => {
    expect((await repo.getSetDetailsForSession(USER_B, bSessionId)).length).toBeGreaterThan(0)
    expect((await repo.getSetTimestampsForSession(USER_B, bSessionId)).length).toBeGreaterThan(0)
  })

  it('A cannot read B\'s set details by guessing the session id', async () => {
    expect(await repo.getSetDetailsForSession(USER_A, bSessionId)).toEqual([])
  })

  it('A cannot read B\'s set timestamps by guessing the session id', async () => {
    expect(await repo.getSetTimestampsForSession(USER_A, bSessionId)).toEqual([])
  })

  // The write, and the most serious of the three: a read leaks, a write changes someone else's row.
  it('A cannot stamp hr_synced_at on B\'s session', async () => {
    await repo.markHrSynced(USER_A, bSessionId)
    const { rows } = await pool.query(
      `SELECT hr_synced_at FROM workout_sessions WHERE id = $1`, [bSessionId])
    expect(rows[0].hr_synced_at).toBeNull()
  })

  it('…while B can stamp their own', async () => {
    await repo.markHrSynced(USER_B, bSessionId)
    const { rows } = await pool.query(
      `SELECT hr_synced_at FROM workout_sessions WHERE id = $1`, [bSessionId])
    expect(rows[0].hr_synced_at).not.toBeNull()
  })
})
