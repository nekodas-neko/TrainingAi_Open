/**
 * Issue 3665: `getNextSession`'s rotation branch matched history to program sessions by name, so a
 * session renamed after it was trained looked never done. Runs against a real local dev Postgres
 * and skips in CI; the scorer's half is covered by
 * packages/shared/src/ai-periodization/__tests__/next-session-by-id-3665.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USER = '00000000-0000-4000-8000-000000003665'

describe.skipIf(!canRun)('getNextSession matches history by session id (issue 3665)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'next-by-id-3665@example.com', 'x', $2)`,
      [USER, TZ],
    )
    const { rows: [prog] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, started_at, sessions_per_cycle)
       VALUES ($1, 'Next By Id', true, NOW(), 3) RETURNING id`,
      [USER],
    )
    for (const [name, pos] of [['Upper', 0], ['Lower', 1], ['Pull', 2]] as const) {
      const { rows: [sess] } = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position, icon) VALUES ($1, $2, $3, 'Dumbbell') RETURNING id`,
        [prog.id, name, pos],
      )
      ids[name] = sess.id
      await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position)
         VALUES ($1, 'Barbell Squat', ARRAY['quads'], 0)`,
        [sess.id],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`UPDATE program_sessions SET name = 'Lower' WHERE id = $1`, [ids.Lower])
  })

  /** A logged workout `daysAgo` local days back, at local midday, under the name it had then. */
  async function trained(name: 'Upper' | 'Lower' | 'Pull', daysAgo: number) {
    const day = shiftDateStr(todayInTz(TZ), -daysAgo)
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, $3, ($4::date + time '12:00') AT TIME ZONE $5) RETURNING id`,
      [USER, ids[name], name, day, TZ],
    )
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at) VALUES ($1, 'Barbell Squat', now())`,
      [ws.id],
    )
  }
  const rename = (name: string) => pool.query(`UPDATE program_sessions SET name = $2 WHERE id = $1`, [ids.Lower, name])

  it('a session renamed after it was trained is not recommended next', async () => {
    await trained('Upper', 4)
    await trained('Pull', 2)
    await trained('Lower', 1)
    expect((await repo.getNextSession(USER, TZ)).session?.id).toBe(ids.Upper)
    await rename('Legs')
    const after = await repo.getNextSession(USER, TZ)
    expect(after.session?.id).toBe(ids.Upper)
  })

  it('a renamed session still completes the cycle', async () => {
    await trained('Upper', 3)
    await trained('Pull', 2)
    await trained('Lower', 1)
    await rename('Legs')
    const r = await repo.getNextSession(USER, TZ)
    expect(r.isRestDay).toBe(true)
    expect(r.reason).toMatch(/cycle complete/)
  })

  it('a session renamed on the day it was trained keeps "Already trained"', async () => {
    await trained('Lower', 0)
    await rename('Legs')
    const r = await repo.getNextSession(USER, TZ)
    expect(r.session?.id).toBe(ids.Lower)
    expect(r.reason).toBe('Already trained: Legs')
  })
})
