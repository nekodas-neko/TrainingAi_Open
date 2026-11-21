import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// #3891. The strength trend compares a lift's latest real estimate with the one before it, so the
// pair `listRecent1rm` returns must come from finished, not-deleted, non-deload sessions, and a
// session with a NULL phase_type (every row before the phase tag) must stay in. `phase_type <>
// 'deload'` alone would drop those rows, because NULL <> 'deload' is NULL.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000389101'
const EX = 'Issue3891 Bench'

interface Opts { phaseType?: string | null; finished?: boolean; sessionDeleted?: boolean; logDeleted?: boolean; earlyDeload?: boolean; intensityMode?: string | null }

describe.skipIf(!canRun)('listRecent1rm pairs the two latest estimates from finished, non-deload sessions', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const logSession = async (daysAgo: number, estimated1rm: number, o: Opts = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, phase_type, is_early_deload, intensity_mode, deleted_at)
       VALUES ($1, 'Issue3891', now() - ($2 || ' days')::interval,
         CASE WHEN $3 THEN now() - ($2 || ' days')::interval + interval '50 min' END, $4, $5, $6,
         CASE WHEN $7 THEN now() END)
       RETURNING id`,
      [TEST_USER_ID, String(daysAgo), o.finished ?? true, o.phaseType ?? null, o.earlyDeload ?? false, o.intensityMode ?? null, o.sessionDeleted ?? false])
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, exercise_deloaded, logged_at, deleted_at)
       VALUES ($1, $2, $3, false, now() - ($4 || ' days')::interval, CASE WHEN $5 THEN now() END)`,
      [rows[0].id, EX, estimated1rm, String(daysAgo), o.logDeleted ?? false])
  }
  const recent = async () => (await repo.listRecent1rm(TEST_USER_ID)).get(EX)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `issue3891-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  it('returns the latest and the one before it, not the all-time best', async () => {
    await logSession(30, 140)  // an old best, far above both recent estimates
    await logSession(10, 104)
    await logSession(2, 100)
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  it('skips a deload session between them (phase tag, early-deload flag, intensity mode)', async () => {
    await logSession(20, 104)
    await logSession(15, 60, { phaseType: 'deload' })
    await logSession(12, 61, { earlyDeload: true })
    await logSession(9, 62, { intensityMode: 'deload' })
    await logSession(2, 100)
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  // The trap: `phase_type <> 'deload'` drops NULL rows. A null phase type is not a deload.
  it('counts a session with a NULL phase type', async () => {
    await logSession(10, 104, { phaseType: null })
    await logSession(2, 100, { phaseType: null })
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  it('counts a normal-phase session alongside a NULL one', async () => {
    await logSession(10, 104, { phaseType: 'normal' })
    await logSession(2, 100, { phaseType: null })
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  it('skips an unfinished session', async () => {
    await logSession(10, 104)
    await logSession(5, 100)
    await logSession(1, 70, { finished: false })
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  it('skips a deleted workout and a deleted exercise log', async () => {
    await logSession(10, 104)
    await logSession(5, 100)
    await logSession(3, 70, { sessionDeleted: true })
    await logSession(1, 71, { logDeleted: true })
    expect(await recent()).toEqual({ latest: 100, previous: 104 })
  })

  it('has no previous with a single qualifying estimate', async () => {
    await logSession(10, 80, { finished: false })
    await logSession(2, 100)
    expect(await recent()).toEqual({ latest: 100 })
  })
})
