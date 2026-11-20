// #3907(4) — what happens today when the lifter switches between Deload and Full mid-session. Each
// exercise log carries the toggle's state as it then stands, but the workout session row is stamped
// by the FIRST log: `ensureWorkoutSession` inserts with `onConflictDoNothing`, so a later log's
// `intensityMode` and `wasOverride` are not written, and every later exercise is scored against the
// phase context the session was created with. Whether a switch should re-type the session is open on
// #3907; this pins the current behaviour so a change to it is a deliberate one.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003907'

describe.skipIf(!canRun)('a mid-session switch between Deload and Full (#3907, current behaviour)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1,$2,'x') ON CONFLICT (id) DO NOTHING`,
      [USER, `s3907-${USER}@example.com`])
  })
  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM users WHERE id=$1', [USER])
  })

  const row = async (id: string) => (await pool.query(
    'SELECT intensity_mode, was_override, phase_type FROM workout_sessions WHERE id=$1', [id])).rows[0]

  it('Deload first, then Full: the session stays a deload, not overridden', async () => {
    const id = randomUUID()
    const started = new Date()
    const first = await repo.ensureWorkoutSession(USER, id, undefined, 'Lower', started, undefined, 'deload', false, 'deload', false)
    expect(first.wasInserted).toBe(true)
    const second = await repo.ensureWorkoutSession(USER, id, undefined, 'Lower', started, undefined, 'normal', false, 'full', true)
    expect(second).toMatchObject({ wasInserted: false, phaseType: 'deload' })
    expect(await row(id)).toEqual({ intensity_mode: 'deload', was_override: false, phase_type: 'deload' })
  })

  it('Full first, then Deload: the session stays full and overridden', async () => {
    const id = randomUUID()
    const started = new Date()
    await repo.ensureWorkoutSession(USER, id, undefined, 'Lower', started, undefined, 'normal', false, 'full', true)
    const second = await repo.ensureWorkoutSession(USER, id, undefined, 'Lower', started, undefined, 'deload', false, 'deload', false)
    expect(second).toMatchObject({ wasInserted: false, phaseType: 'normal' })
    expect(await row(id)).toEqual({ intensity_mode: 'full', was_override: true, phase_type: 'normal' })
  })
})
