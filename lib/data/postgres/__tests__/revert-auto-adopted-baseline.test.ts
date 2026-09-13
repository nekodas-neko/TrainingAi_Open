// BF-143 — reverting a baseline the auto-adopt path completed on borrowed personal records.
//
// The owner rebuilt his Lower session and it never asked for an AMRAP: a crash-recovery block
// completed its baseline from prior PRs because the exercise NAMES matched earlier logs. The stored
// row read `phase = accumulation`, `baseline_complete = true` against zero workouts of its own, and
// one adopted anchor was a bodyweight 1RM index stored under a key named `kg`.
//
// The safety property under test is the NARROWING, not the revert. On the owner's live account four
// other sessions sit beside Lower — two calibrated by a real AMRAP (`source: 'amrap'`) and two from
// the prior-data choice (`source: 'existing'`) — and a revert that reached any of them would throw
// away a real cycle. `personal_record` is written in exactly one place, which is what makes the
// discriminator sound; these cases are what stop that drifting.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000bf143'

describe.skipIf(!canRun)('revertAutoAdoptedBaseline (BF-143)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, 'bf143@example.com'])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
  })

  /** A session whose periodization row is already COMPLETE, with anchors of the given source. */
  async function seedCompleted(source: string, names = ['Hip Thrust', 'Split Squat']) {
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'BF-143', true) RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Lower', 0) RETURNING id`, [p.id])
    const anchors: Record<string, { kg: number; source: string }> = {}
    for (const [i, name] of names.entries()) {
      const { rows: [se] } = await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, $2, $3) RETURNING id`,
        [ps.id, name, i])
      anchors[se.id] = { kg: 100 + i, source }
    }
    await repo.ensureSessionPeriodization(USER, ps.id)
    await pool.query(
      `UPDATE session_periodization SET phase = 'accumulation', baseline_complete = true,
         baseline_1rm = $2::jsonb, sessions_in_phase = 3 WHERE user_id = $1 AND program_session_id = $3`,
      [USER, JSON.stringify(anchors), ps.id])
    return ps.id as string
  }

  it('reverts a baseline whose every anchor was adopted from a personal record', async () => {
    const sessionId = await seedCompleted('personal_record')
    const reverted = await repo.revertAutoAdoptedBaseline(USER, sessionId)
    expect(reverted).not.toBeNull()
    expect(reverted!.phase).toBe('baseline')
    expect(reverted!.baselineComplete).toBe(false)
    // The adopted numbers go with it: one of them was a bodyweight index labelled `kg`, and a
    // baseline is what prescription percentages multiply.
    expect(reverted!.baseline1rm).toEqual({})
    expect(reverted!.sessionsInPhase).toBe(0)
  })

  it('leaves a baseline measured by a real AMRAP alone', async () => {
    const sessionId = await seedCompleted('amrap')
    expect(await repo.revertAutoAdoptedBaseline(USER, sessionId)).toBeNull()
    const after = await repo.getSessionPeriodization(USER, sessionId)
    expect(after!.baselineComplete).toBe(true)
    expect(after!.phase).toBe('accumulation')
  })

  it('leaves a baseline taken from the prior-data choice alone', async () => {
    const sessionId = await seedCompleted('existing')
    expect(await repo.revertAutoAdoptedBaseline(USER, sessionId)).toBeNull()
    expect((await repo.getSessionPeriodization(USER, sessionId))!.baselineComplete).toBe(true)
  })

  // A single measured anchor is enough to make the row something the lifter earned.
  it('leaves a mixed baseline alone rather than reverting it for the adopted half', async () => {
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'BF-143 mixed', true) RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Mixed', 0) RETURNING id`, [p.id])
    const { rows: [a] } = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, 'A', 0) RETURNING id`, [ps.id])
    const { rows: [b] } = await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, 'B', 1) RETURNING id`, [ps.id])
    await repo.ensureSessionPeriodization(USER, ps.id)
    await pool.query(
      `UPDATE session_periodization SET phase = 'accumulation', baseline_complete = true,
         baseline_1rm = $2::jsonb WHERE user_id = $1 AND program_session_id = $3`,
      [USER, JSON.stringify({ [a.id]: { kg: 100, source: 'amrap' }, [b.id]: { kg: 90, source: 'personal_record' } }), ps.id])
    expect(await repo.revertAutoAdoptedBaseline(USER, ps.id)).toBeNull()
  })

  // An empty map is not evidence of the adopt path — a session still IN baseline has one.
  it('does not touch a session that never completed its baseline', async () => {
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'BF-143 fresh', true) RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Fresh', 0) RETURNING id`, [p.id])
    await repo.ensureSessionPeriodization(USER, ps.id)
    expect(await repo.revertAutoAdoptedBaseline(USER, ps.id)).toBeNull()
  })
})
