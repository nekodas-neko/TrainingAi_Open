/**
 * Issue 2649. `getLastRealOneRmBatch` labels the row it returns with whether its session was a
 * baseline, so the exercise summary can leave out a "+/− kg" that compares an AMRAP-scaled estimate
 * with a prescribed one. The label must not change WHICH row is the working basis: the owner decided
 * the bar keeps loading from the baseline, so a baseline row that is the newest real log is still
 * the one returned.
 *
 * Runs only against a real local dev Postgres — skips without DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002649'
const EXERCISE = 'Issue2649 Bench Press'

describe.skipIf(!canRun)('getLastRealOneRmBatch says whether the basis was a baseline', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/postgres/adapter').PostgresWorkoutRepository
  let programSessionId = ''

  const log = async (opts: { est1rm: number; daysAgo: number; phaseType: string | null }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, phase_type)
       VALUES ($1, $2, 'I2649', now() - ($3 || ' days')::interval, $4) RETURNING id`,
      [USER, programSessionId, opts.daysAgo, opts.phaseType])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, avg_reps, logged_at)
       VALUES ($1, $2, 100, $3, 8, now() - ($4 || ' days')::interval)`,
      [ws.id, EXERCISE, opts.est1rm, opts.daysAgo])
  }
  const basis = async () => (await repo.getLastRealOneRmBatch(USER, [EXERCISE])).get(EXERCISE)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'i2649@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    const { rows: [p] } = await pool.query(`INSERT INTO programs (user_id, name) VALUES ($1, 'I2649') RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'I2649', 0) RETURNING id`, [p.id])
    programSessionId = ps.id
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
  })

  it('is true when the newest real log is from a baseline session, and that log is still the basis', async () => {
    await log({ est1rm: 103.75, daysAgo: 20, phaseType: null })
    await log({ est1rm: 82.75, daysAgo: 7, phaseType: 'baseline' })
    expect(await basis()).toMatchObject({ estimated1rm: 82.75, fromBaseline: true })
  })

  it('is false once a prescribed run has followed the baseline', async () => {
    await log({ est1rm: 82.75, daysAgo: 14, phaseType: 'baseline' })
    await log({ est1rm: 91.25, daysAgo: 7, phaseType: 'strength' })
    expect(await basis()).toMatchObject({ estimated1rm: 91.25, fromBaseline: false })
  })

  it('treats an untagged session (logged before TN-75) as not baseline', async () => {
    await log({ est1rm: 103.75, daysAgo: 7, phaseType: null })
    expect(await basis()).toMatchObject({ estimated1rm: 103.75, fromBaseline: false })
  })
})
