// A deloaded exercise stores `estimated_1rm = 0` deliberately — `estimateOneRm` returns 0 when
// `deloaded`, so the submaximal work never enters an estimate. Readers must therefore guard on
// `> 0`, not `IS NOT NULL`, because 0 passes a null check. `getExercise1rmHistory` and
// `reconcilePersonalRecord` already did; `getYearReviewTopExercises` did not, so a deload landing
// on the last logged session rendered the year's headline lift as "92.75 → 0 kg".
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-00000000dead'

describe.skipIf(!canRun)('getYearReviewTopExercises — deloaded logs (estimated_1rm = 0)', () => {
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
      [TEST_USER_ID, `year-review-deload-${TEST_USER_ID}@example.com`],
    )

    // Three sessions for one exercise: a first real log, a second real log, then a DELOAD whose
    // estimated_1rm is 0 — the shape that produced "→ 0 kg" in production on 2026-08-06.
    const logs: [string, number, boolean][] = [
      ['2026-07-01', 80, false],
      ['2026-07-08', 92.75, false],
      ['2026-07-15', 0, true],
    ]
    for (const [day, rm, deloaded] of logs) {
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'Year Review Test', $2::timestamptz, $2::timestamptz + interval '1 hour') RETURNING id`,
        [TEST_USER_ID, `${day}T08:00:00Z`],
      )
      const el = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, volume, logged_at, exercise_deloaded)
         VALUES ($1, 'Year Review Bench', $2, 500, $3::timestamptz, $4) RETURNING id`,
        [ws.rows[0].id, rm, `${day}T08:30:00Z`, deloaded],
      )
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, reps, weight_kg) VALUES ($1, 1, 8, 60)`,
        [el.rows[0].id],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('ignores the deloaded zero and reports the last real estimate', async () => {
    const rows = await repo.getYearReviewTopExercises(TEST_USER_ID, new Date('2026-06-01T00:00:00Z'), 10)
    const bench = rows.find(r => r.exerciseName === 'Year Review Bench')

    expect(bench).toBeDefined()
    expect(bench!.first1rm).toBe(80)
    // Without the `> 0` guard this is 0 — the deload row is the most recent non-NULL value.
    expect(bench!.last1rm).toBe(92.75)
  })
})
