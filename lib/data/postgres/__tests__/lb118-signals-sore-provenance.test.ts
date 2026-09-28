// LB-118 — the explain page's `signals` carry the check-in's sore-tick provenance, from the same mood
// log the recommendation was computed from. Null when provenance was not recorded, so the page can
// say "not recorded" rather than "none were suggestions".
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b1180'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('next-session signals carry sore-tick provenance (LB-118)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let today: string

  async function clear() {
    await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER])
    await pool.query(
      `DELETE FROM session_exercises WHERE session_id IN (
         SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = $1)`,
      [USER],
    )
    await pool.query(`DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = $1)`, [USER])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    repo = await getRepository()
    today = todayInTz(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'lb118-provenance@example.com', TZ],
    )
    await clear()
    // `signals` is only emitted by the ai_dynamic branch.
    const { rows: [prog] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode, started_at, sessions_per_cycle)
       VALUES ($1, 'AI Program', true, 'ai_dynamic', NOW(), 1) RETURNING id`, [USER])
    const { rows: [sess] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position, icon) VALUES ($1, 'Lower', 0, 'Dumbbell') RETURNING id`, [prog.id])
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES ($1, 'Barbell Squat', ARRAY['quads'], 0)`,
      [sess.id])
  })

  beforeEach(async () => { await pool.query(`DELETE FROM mood_logs WHERE user_id = $1`, [USER]) })

  afterAll(async () => {
    if (!canRun) return
    await clear()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const signals = async () => (await repo.getNextSession(USER, TZ))?.signals

  it("carries which of today's ticks were suggestions", async () => {
    await pool.query(
      `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, sore_muscles, suggested_sore_muscles)
       VALUES ($1, $2, 'ok', 'ok', ARRAY['quads','glutes'], ARRAY['glutes'])`, [USER, today])
    const s = await signals()
    expect(s?.soreMuscles).toEqual(['quads', 'glutes'])
    expect(s?.suggestedSoreMuscles).toEqual(['glutes'])
  })

  it('is null, not empty, for a check-in that recorded no provenance', async () => {
    await pool.query(
      `INSERT INTO mood_logs (user_id, log_date, energy_level, sleep_quality, sore_muscles) VALUES ($1, $2, 'ok', 'ok', ARRAY['quads'])`,
      [USER, today])
    expect((await signals())?.suggestedSoreMuscles).toBeNull()
  })
})
