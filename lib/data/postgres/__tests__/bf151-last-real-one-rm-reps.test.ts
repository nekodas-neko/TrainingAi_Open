/**
 * BF-151 — `getLastRealOneRmBatch` carries `avg_reps` alongside the 1RM it belongs to.
 *
 * The formula tests cannot see this: drop `el.avg_reps` from the SELECT and every one of them still
 * passes, because they hand `buildWorkoutExercises` a map built by hand. That mutant survived the
 * first pass, which is why this file exists.
 *
 * The reps have to travel WITH this 1RM rather than come from `lastLogs` — that map is the genuinely
 * most recent log and can be a different, deloaded session.
 *
 * Runs only against a real local dev Postgres — skips in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bf51'
const EXERCISE = 'BF151 Hanging Leg Raise'

describe.skipIf(!canRun)('getLastRealOneRmBatch carries the reps behind the 1RM', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/postgres/adapter').PostgresWorkoutRepository
  let programSessionId = ''

  /** One completed session with a single exercise log. */
  const log = async (opts: {
    est1rm: number; reps: number; deloaded?: boolean; daysAgo: number
  }) => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'BF151', now() - ($3 || ' days')::interval) RETURNING id`,
      [USER, programSessionId, opts.daysAgo])
    await pool.query(
      `INSERT INTO exercise_logs
         (workout_session_id, exercise_name, volume, estimated_1rm, avg_reps, exercise_deloaded, logged_at)
       VALUES ($1, $2, 100, $3, $4, $5, now() - ($6 || ' days')::interval)`,
      [ws.id, EXERCISE, opts.est1rm, opts.reps, opts.deloaded ?? false, opts.daysAgo])
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'bf151@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1, 'BF151 Program') RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'BF151', 0) RETURNING id`, [p.id])
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

  it('returns the reps stored on the row it took the 1RM from', async () => {
    await log({ est1rm: 114.5, reps: 11, daysAgo: 1 })
    const m = await repo.getLastRealOneRmBatch(USER, [EXERCISE])
    expect(m.get(EXERCISE)).toMatchObject({ estimated1rm: 114.5, avgReps: 11 })
  })

  // The reps must come from the row that won, not from whatever is newest: a deload is excluded
  // from the basis, so its reps must not travel either.
  it('skips a newer deload row and reports the older real row\'s reps', async () => {
    await log({ est1rm: 114.5, reps: 11, daysAgo: 3 })
    await log({ est1rm: 0, reps: 4, deloaded: true, daysAgo: 1 })
    const m = await repo.getLastRealOneRmBatch(USER, [EXERCISE])
    expect(m.get(EXERCISE)).toMatchObject({ estimated1rm: 114.5, avgReps: 11 })
  })

  // A non-deload row that stored no usable 1RM (pre-Q-298 bodyweight logs are the real shape) must
  // not enter the map at all — otherwise its reps would travel as though they belonged to a basis.
  // Two filters exclude it, `estimated_1rm > 0` and the `exercise_deloaded` backstop; this pins the
  // first, which the second would otherwise mask.
  it('excludes a non-deload row whose 1RM is zero, so its reps never travel', async () => {
    await log({ est1rm: 0, reps: 9, deloaded: false, daysAgo: 1 })
    const m = await repo.getLastRealOneRmBatch(USER, [EXERCISE])
    expect(m.has(EXERCISE)).toBe(false)
  })

  it('reports null reps rather than dropping the row when avg_reps was never stored', async () => {
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at)
       VALUES ($1, $2, 'BF151', now()) RETURNING id`, [USER, programSessionId])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, estimated_1rm, logged_at)
       VALUES ($1, $2, 100, 90, now())`, [ws.id, EXERCISE])
    const m = await repo.getLastRealOneRmBatch(USER, [EXERCISE])
    expect(m.get(EXERCISE)).toMatchObject({ estimated1rm: 90, avgReps: null })
  })
})
