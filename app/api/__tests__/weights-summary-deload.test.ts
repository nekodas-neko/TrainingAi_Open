import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// PS-26, at the layer that actually publishes the number.
//
// Q-298 taught `listPrevious1rm` that a deload's `estimated_1rm = 0` is a sentinel, not a value.
// Nothing taught the route: `/api/weights-summary` took `estimated1rm` straight off the newest log,
// so an exercise whose last session was a deload published `estimated1rm: 0` beside a real
// `previousEstimated1rm`, and the strength card rendered the difference — the lifter's entire 1RM,
// as a loss, with an empty bar. Measured on the owner's rows: 16 of 34 exercises, all 16 deloaded.
//
// This test exists because the repository test alone did not catch it. Reverting the route to
// `log?.estimated1rm` left every other test green, which means the fix was untested end to end.
const USER = '00000000-0000-4000-8000-000000026aaa'
const EX = 'PS26 Bench'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: 'Australia/Brisbane' } })),
}))

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('GET /api/weights-summary never publishes a deload as the current 1RM', () => {
  let pool: import('pg').Pool

  const logSession = async (daysAgo: number, estimated1rm: number, deloaded: boolean) => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'PS26', now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval + interval '50 min')
       RETURNING id`, [USER, String(daysAgo)])
    const { rows: el } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval) RETURNING id`,
      [rows[0].id, EX, estimated1rm, deloaded, String(daysAgo)])
    await pool.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       VALUES ($1, 1, 60, 5)`, [el[0].id])
  }

  async function summaryFor(): Promise<{ estimated1rm: number | null; previousEstimated1rm: number | null }> {
    const { GET } = await import('@/app/api/weights-summary/route')
    const res = await GET(new Request('http://localhost/api/weights-summary') as never)
    const body = await res.json()
    return body.exercises.find((e: { exercise: string }) => e.exercise === EX)
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `ps26-${USER}@example.com`])
    // The route only emits exercises that are in the active program, so there has to be one.
    const { rows: p } = await pool.query(
      `INSERT INTO programs (name, is_active, user_id) VALUES ('PS26', true, $1) RETURNING id`, [USER])
    const { rows: sess } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Push', 0) RETURNING id`, [p[0].id])
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position)
       VALUES ($1, $2, ARRAY['chest'], 0)`, [sess[0].id, EX])
  })
  beforeEach(async () => { await pool.query('DELETE FROM workout_sessions WHERE user_id=$1', [USER]) })
  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM programs WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM users WHERE id=$1', [USER])
  })

  it('publishes the last REAL estimate when the newest session is a deload', async () => {
    await logSession(10, 100, false)
    await logSession(5, 105, false)
    await logSession(1, 0, true)

    const row = await summaryFor()
    expect(row.estimated1rm, 'a 0 here is the sentinel reaching the client').toBe(105)
    expect(row.previousEstimated1rm).toBe(100)
  })

  // The control: without it, "never publishes 0" would also pass on a route that published null
  // for everything.
  it('publishes the newest estimate normally when it is not a deload', async () => {
    await logSession(5, 100, false)
    await logSession(1, 105, false)

    const row = await summaryFor()
    expect(row.estimated1rm).toBe(105)
    expect(row.previousEstimated1rm).toBe(100)
  })

  it('publishes null, not 0, when every session for the exercise was a deload', async () => {
    await logSession(5, 0, true)
    await logSession(1, 0, true)

    const row = await summaryFor()
    expect(row.estimated1rm).toBeNull()
    expect(row.previousEstimated1rm).toBeNull()
  })
})
