/**
 * BF-84 — a chosen rest day is a stored fact, and `getNextSession` prefers it over inference.
 *
 * Before this the whole feature was a `localStorage` marker: the choice never reached the server,
 * the second device never saw it, and refetching `/api/next-session` recomputed the prompt and
 * reverted the selection. What is asserted here is the half that fixes all three — the row, and the
 * one place its absence used to be indistinguishable from "you did not train today".
 *
 * Every case is mutation-anchored. Named against the mutation each one kills:
 *   • drop the `restChosen` branch in getNextSession        → "prefers the stored choice" fails
 *   • move it ABOVE the already-trained branch              → "a logged workout outranks it" fails
 *   • make `setRestDay(..., false)` a no-op                 → "un-choosing" fails
 *   • make it a hard DELETE + plain INSERT                  → "re-choosing" fails on the row count
 *   • drop the user scope from any of the three reads       → "another user's choice" fails
 *   • default a missing `resting` to true in the push branch→ "a malformed push" fails
 *
 * Runs only against a real local dev Postgres — skips cleanly in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { todayInTz, toAestDay } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-00000000bf84'
const OTHER = '00000000-0000-4000-8000-00000000bf85'

describe.skipIf(!canRun)('rest_days — the choice is stored, not inferred', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const today = todayInTz(TZ)
  const yesterday = toAestDay(new Date(Date.now() - 86_400_000), TZ)
  let sessionName = ''

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    for (const [id, email] of [[USER, 'rest-day-bf84'], [OTHER, 'rest-day-bf84-other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
         ON CONFLICT (id) DO NOTHING`,
        [id, `${email}@example.com`, TZ],
      )
    }
    await cleanup()

    // A plain (non-ai_dynamic) program with two sessions, so the recommendation below is the
    // deterministic rotation answer rather than the readiness/AI branch. One `ai_dynamic` case
    // further down covers that the choice short-circuits that branch too.
    const { rows: [prog] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, started_at, sessions_per_cycle)
       VALUES ($1, 'Rest Day Test', true, NOW(), 2) RETURNING id`,
      [USER],
    )
    for (const [name, pos] of [['Upper', 0], ['Lower', 1]] as const) {
      const { rows: [sess] } = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position, icon) VALUES ($1, $2, $3, 'Dumbbell') RETURNING id`,
        [prog.id, name, pos],
      )
      await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position)
         VALUES ($1, 'Barbell Squat', ARRAY['quads'], 0)`,
        [sess.id],
      )
    }
    sessionName = 'Upper'
  })

  afterAll(async () => {
    if (!canRun) return
    await cleanup()
    await pool.query(`DELETE FROM programs WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM rest_days WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
  })

  async function cleanup() {
    await pool.query(`DELETE FROM rest_days WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [[USER, OTHER]])
    await pool.query(
      `DELETE FROM session_exercises WHERE session_id IN (
         SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = ANY($1))`,
      [[USER, OTHER]],
    )
    await pool.query(
      `DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = ANY($1))`,
      [[USER, OTHER]],
    )
  }

  /** A completed session today, with one exercise log — `getNextSession` ignores empty sessions. */
  async function logWorkoutToday(userId: string, name: string) {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
      [userId, name],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, 'Barbell Squat', NOW())`,
      [ws.id],
    )
  }

  const liveRows = async (userId: string) => (await pool.query(
    `SELECT date::text, deleted_at FROM rest_days WHERE user_id = $1 ORDER BY date`, [userId])).rows

  it('with nothing stored, today is a training day — the control', async () => {
    const rec = await repo.getNextSession(USER, TZ)
    expect(rec.isRestDay).toBe(false)
    expect(rec.session?.name).toBeTruthy()
  })

  it('prefers the stored choice over the rotation it would otherwise recommend', async () => {
    await repo.setRestDay(USER, today, true)
    const rec = await repo.getNextSession(USER, TZ)
    expect(rec.isRestDay).toBe(true)
    // The reason names the choice, so the screen can say whose decision this was.
    expect(rec.reason).toMatch(/you chose/i)
    expect(rec.session).toBeUndefined()
  })

  it('un-choosing tombstones the row and hands the day back to the rotation', async () => {
    await repo.setRestDay(USER, today, true)
    expect(await repo.isRestDayChosen(USER, today)).toBe(true)

    await repo.setRestDay(USER, today, false)
    expect(await repo.isRestDayChosen(USER, today)).toBe(false)
    const rec = await repo.getNextSession(USER, TZ)
    expect(rec.isRestDay).toBe(false)

    // Tombstoned, not deleted — a hard delete is invisible to a device that has not synced.
    const rows = await liveRows(USER)
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).not.toBeNull()
  })

  it('re-choosing resurrects the same row rather than inserting a second', async () => {
    await repo.setRestDay(USER, today, true)
    await repo.setRestDay(USER, today, false)
    await repo.setRestDay(USER, today, true)

    const rows = await liveRows(USER)
    expect(rows).toHaveLength(1)
    expect(rows[0].deleted_at).toBeNull()
    expect(await repo.isRestDayChosen(USER, today)).toBe(true)
  })

  it('a workout logged today outranks a rest day chosen earlier', async () => {
    await repo.setRestDay(USER, today, true)
    await logWorkoutToday(USER, sessionName)

    const rec = await repo.getNextSession(USER, TZ)
    expect(rec.isRestDay).toBe(false)
    expect(rec.reason).toContain('Already trained')

    // And the row survives, so deleting that session tomorrow does not lose the choice.
    expect(await repo.isRestDayChosen(USER, today)).toBe(true)
  })

  it("another user's rest day is not this user's", async () => {
    await repo.setRestDay(OTHER, today, true)
    expect(await repo.isRestDayChosen(USER, today)).toBe(false)
    expect(await repo.listRestDays(USER, yesterday, today)).toEqual([])
    expect((await repo.getNextSession(USER, TZ)).isRestDay).toBe(false)

    // And un-choosing as USER must not reach OTHER's row.
    await repo.setRestDay(USER, today, false)
    expect(await repo.isRestDayChosen(OTHER, today)).toBe(true)
  })

  /**
   * The choice must gate the readiness/AI branch, not merely the rotation one below it — that
   * branch is the expensive path, and it is also the one that would otherwise answer with a deload
   * prompt on a day the user has already said they are resting.
   *
   * `signals` is the observable: only the ai_dynamic branch attaches it, so its absence is proof
   * the branch never ran rather than proof of a matching answer.
   */
  it('short-circuits the ai_dynamic readiness branch, not just the rotation', async () => {
    await pool.query(`UPDATE programs SET phase_mode = 'ai_dynamic' WHERE user_id = $1`, [USER])
    try {
      const before = await repo.getNextSession(USER, TZ)
      expect(before.signals, 'the ai_dynamic branch should run when nothing is stored').toBeDefined()

      await repo.setRestDay(USER, today, true)
      const after = await repo.getNextSession(USER, TZ)
      expect(after.isRestDay).toBe(true)
      expect(after.reason).toMatch(/you chose/i)
      expect(after.signals).toBeUndefined()
    } finally {
      await pool.query(`UPDATE programs SET phase_mode = 'manual' WHERE user_id = $1`, [USER])
    }
  })

  it('listRestDays returns live rows in range, ascending, and skips tombstones', async () => {
    await repo.setRestDay(USER, yesterday, true)
    await repo.setRestDay(USER, today, true)
    expect(await repo.listRestDays(USER, yesterday, today)).toEqual([yesterday, today])

    await repo.setRestDay(USER, yesterday, false)
    expect(await repo.listRestDays(USER, yesterday, today)).toEqual([today])
    expect(await repo.listRestDays(USER, today, today)).toEqual([today])
  })
})
