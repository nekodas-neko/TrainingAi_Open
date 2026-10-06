import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// #2297. A baseline session logs one unprescribed set, so its estimate is AMRAP-scaled, while a
// prescribed set's estimate is divided back up by its own %1RM. `listRecent1rm` paired them, so a
// program rebuild read as every compound declining at once (the baseline run) and then as the
// same amount gained (the next run). The production window was 09-07 → 09-12: bench 103.75
// (prescribed) → 82.75 (baseline, 60 kg × 15) → 91.25 (prescribed).
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000229701'
const EX = 'Issue2297 Bench'

describe.skipIf(!canRun)('listRecent1rm never pairs a baseline estimate with a prescribed one', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  /** One session with one exercise log, `daysAgo` back. */
  const logSession = async (daysAgo: number, estimated1rm: number, phaseType: string | null = null) => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type)
       VALUES ($1, 'Issue2297', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval + interval '50 min', $3)
       RETURNING id`, [TEST_USER_ID, String(daysAgo), phaseType])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, false, now() - ($4 || ' days')::interval)`,
      [rows[0].id, EX, estimated1rm, String(daysAgo)])
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `issue2297-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  // The run straight after a rebuild: the baseline is the newest measurement, and there is
  // nothing like-for-like to compare it with. "−21 kg" was this pair.
  it('reports the baseline as latest with no previous', async () => {
    await logSession(20, 103.75)
    await logSession(10, 82.75, 'baseline')

    const recent = (await repo.listRecent1rm(TEST_USER_ID)).get(EX)
    expect(recent).toEqual({ latest: 82.75 })
    expect((await repo.listPrevious1rm(TEST_USER_ID)).get(EX)).toBeUndefined()
  })

  // The run after that: compared with the last prescribed estimate, reaching past the baseline.
  // Before the fix this read 82.75 → 91.25, a "gain" of the baseline's under-scaling.
  it('compares the next prescribed estimate with the last prescribed one, past the baseline', async () => {
    await logSession(20, 103.75)
    await logSession(10, 82.75, 'baseline')
    await logSession(2, 91.25)

    const recent = (await repo.listRecent1rm(TEST_USER_ID)).get(EX)
    expect(recent).toEqual({ latest: 91.25, previous: 103.75 })
    expect((await repo.listPrevious1rm(TEST_USER_ID)).get(EX)).toBe(103.75)
  })

  // A new lifter: the baseline is the only estimate, and the first prescribed one has nothing
  // prescribed before it. Silence until a real pair exists, rather than a delta against the test.
  it('reports no previous until two prescribed estimates exist', async () => {
    await logSession(10, 80, 'baseline')
    expect((await repo.listRecent1rm(TEST_USER_ID)).get(EX)).toEqual({ latest: 80 })

    await logSession(3, 88)
    expect((await repo.listRecent1rm(TEST_USER_ID)).get(EX)).toEqual({ latest: 88 })

    await logSession(1, 90)
    expect((await repo.listRecent1rm(TEST_USER_ID)).get(EX)).toEqual({ latest: 90, previous: 88 })
  })

  // Only the baseline marker is skipped. A session whose phase is something else, or unknown —
  // every production row before TN-75 — is compared exactly as before.
  it('leaves non-baseline pairs as they were', async () => {
    await logSession(10, 100, 'normal')
    await logSession(5, 102, 'testing')
    await logSession(1, 105)
    expect((await repo.listRecent1rm(TEST_USER_ID)).get(EX)).toEqual({ latest: 105, previous: 102 })
  })

  // A same-instant pair must still come back as two different rows, not one row twice.
  it('never pairs a row with itself when two logs share a timestamp', async () => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Issue2297', now() - interval '1 day', now()) RETURNING id`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at)
       VALUES ($1, $2, 100, false, '2026-09-15T08:00:00Z'), ($1, $2, 110, false, '2026-09-15T08:00:00Z')`,
      [rows[0].id, EX])

    const recent = (await repo.listRecent1rm(TEST_USER_ID)).get(EX)
    expect(recent?.previous).toBeDefined()
    expect([recent?.latest, recent?.previous].sort((a, b) => a! - b!)).toEqual([100, 110])
  })
})
