// #2561 — `GET /api/weekly-muscle-sets` scales each muscle's weekly target by the phases of the
// sessions trained this week. It found those sessions through `workout_sessions.program_session_id`,
// the dead column (NULL on every row; the live link is `session_id`), so the list was always empty
// and the scale was 1 whatever phase the week's sessions were in. A deload week showed a full week's
// target.
//
// The fixture links the workout through the LIVE column only, which is how the app writes it, so a
// read of the dead one finds nothing.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else (CI's "Tests" job has
// no DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000256100'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('weekly muscle sets reads the week\'s phases from the live session link (#2561)', () => {
  let pool: import('pg').Pool
  let programSessionId: string

  async function get() {
    const { GET } = await import('@/app/api/weekly-muscle-sets/route')
    const res = await GET()
    return await res.json() as { phase?: { scale: number; dominant: string | null; counts: Record<string, number> } }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'weekly-muscle-phase@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    const prog = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode, training_goal)
       VALUES ($1, 'Phase scale program', true, 'ai_dynamic', 'strength') RETURNING id`, [USER])
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Push', 0) RETURNING id`, [prog.rows[0].id])
    programSessionId = ps.rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete)
       VALUES ($1, $2, 'deload', 1, true)`, [USER, programSessionId])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('a week with nothing trained scales by 1, the accumulation baseline', async () => {
    const r = await get()
    expect(r.phase).toEqual({ scale: 1, dominant: null, counts: {} })
  })

  it('a session trained this week in a deload phase halves the scale', async () => {
    // Linked through `session_id` ONLY. `program_session_id` is left NULL, as it is on every real row.
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Push', now(), now())`, [USER, programSessionId])
    const r = await get()
    expect(r.phase).toEqual({ scale: 0.5, dominant: 'deload', counts: { deload: 1 } })
  })

  it('a workout with no program-session link adds nothing to the week\'s phases', async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Ad hoc', now(), now())`, [USER])
    const r = await get()
    expect(r.phase).toEqual({ scale: 1, dominant: null, counts: {} })
  })

  it('a deleted workout adds nothing either', async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at, deleted_at)
       VALUES ($1, $2, 'Push', now(), now(), now())`, [USER, programSessionId])
    const r = await get()
    expect(r.phase?.scale).toBe(1)
  })
})
