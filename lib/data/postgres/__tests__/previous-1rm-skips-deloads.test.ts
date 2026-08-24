import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// Q-298. `listPrevious1rm` gated on `IS NOT NULL`, so a deload's deliberate `estimated_1rm = 0`
// became "your previous 1RM" whenever the last-but-one session for an exercise was a deload.
//
// That fed a signal pair to the AI that contradicted itself: `oneRmTrendStatus` guards
// `previous <= 0` and reported **flat**, while `signals.ts`'s `rm1ChangeKg` (`current - prev`) has no
// such guard and reported the lifter's **entire 1RM as a gain since last time**.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000029801'
const EX = 'Q298 Bench'

describe.skipIf(!canRun)('listPrevious1rm skips deliberately-unestimated deloads', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  /** One session with one exercise log, `daysAgo` back. */
  const logSession = async (daysAgo: number, estimated1rm: number, deloaded: boolean) => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Q298', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval + interval '50 min')
       RETURNING id`, [TEST_USER_ID, String(daysAgo)])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval)`,
      [rows[0].id, EX, estimated1rm, deloaded, String(daysAgo)])
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `q298-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    await pool.query(
      `DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  // The defect, exactly: newest is a real session, the one before it was a deload.
  it('reaches past a deload to the last REAL estimate', async () => {
    await logSession(10, 100, false)   // a real max, three sessions back
    await logSession(5, 0, true)       // …then a deload, which stores 0 on purpose
    await logSession(1, 105, false)    // …then today's real session

    expect((await repo.listPrevious1rm(TEST_USER_ID)).get(EX)).toBe(100)
  })

  it('still returns the previous estimate when no deload intervenes', async () => {
    await logSession(5, 100, false)
    await logSession(1, 105, false)
    expect((await repo.listPrevious1rm(TEST_USER_ID)).get(EX)).toBe(100)
  })

  // A zero must never be handed out as a previous estimate, whatever produced it — the flag is the
  // provenance, the `> 0` is the guarantee, and the guarantee should not depend on the flag.
  it('omits the exercise entirely when every prior estimate was a deload', async () => {
    await logSession(5, 0, true)
    await logSession(1, 105, false)
    expect((await repo.listPrevious1rm(TEST_USER_ID)).get(EX)).toBeUndefined()
  })
})
