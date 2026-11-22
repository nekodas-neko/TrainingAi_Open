// #3718: `getNextSession` hands the daily check real trends built from database rows. The pure
// decision is unit-tested; this pins the wiring between the two: rows in `body_metrics` → the
// adapter's read → `restTrendsFromRows` → `decideDailyRest` → `restSignals` on the response.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const TEST_USER_ID = '00000000-0000-4000-8000-0000000371a8'

describe.skipIf(!canRun)('getNextSession — rest trends from body_metrics rows (#3718)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const today = todayInTz(TZ)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `rest-trends-${TEST_USER_ID}@example.com`, TZ],
    )
    await cleanup()
    const { rows: [prog] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active, phase_mode, started_at, sessions_per_cycle)
       VALUES ($1, 'AI Program', true, 'ai_dynamic', NOW(), 1) RETURNING id`,
      [TEST_USER_ID],
    )
    const { rows: [sess] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position, icon) VALUES ($1, 'Lower', 0, 'Dumbbell') RETURNING id`,
      [prog.id],
    )
    await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, muscle_groups, position) VALUES ($1, 'Barbell Squat', ARRAY['quads'], 0)`,
      [sess.id],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await cleanup()
  })

  async function cleanup() {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `DELETE FROM session_exercises WHERE session_id IN (
         SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = $1)`,
      [TEST_USER_ID],
    )
    await pool.query(`DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = $1)`, [TEST_USER_ID])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [TEST_USER_ID])
  }

  /** Blood oxygen on each `recentOffsets` day (low) and on the seven days from `olderFrom` back (normal). */
  async function seedSpo2(recentOffsets: number[], olderFrom: number) {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    const rows = [
      ...recentOffsets.map(o => [o, 90] as const),
      ...Array.from({ length: 7 }, (_, i) => [olderFrom + i, 98] as const),
    ]
    for (const [offset, pct] of rows) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, spo2_pct, source_map) VALUES ($1, $2, $3, '{"spo2_pct":"oura_cloud"}'::jsonb)`,
        [TEST_USER_ID, shiftDateStr(today, -offset), pct],
      )
    }
  }

  it('three low blood-oxygen nights ending today reach the decision and suggest rest', async () => {
    await seedSpo2([0, 1, 2], 3)
    const rec = await repo.getNextSession(TEST_USER_ID, TZ)
    expect(rec.restSignals).toEqual(['spo2Low'])
    expect(rec).toMatchObject({ deloadOrRestRecommended: true, deloadStrength: 'recommended' })
  })

  it('the same dip with one missed night still suggests rest', async () => {
    await seedSpo2([0, 1, 3], 4)
    expect((await repo.getNextSession(TEST_USER_ID, TZ)).restSignals).toEqual(['spo2Low'])
  })

  it('a "last 3 nights" spread over a four-night gap (today, today-5, today-6) does not', async () => {
    await seedSpo2([0, 5, 6], 7)
    const rec = await repo.getNextSession(TEST_USER_ID, TZ)
    expect(rec.restSignals).toBeUndefined()
    expect(rec.deloadOrRestRecommended ?? false).toBe(false)
  })

  it('the same dip ending yesterday does not (not last night)', async () => {
    await seedSpo2([1, 2, 3], 4)
    expect((await repo.getNextSession(TEST_USER_ID, TZ)).restSignals).toBeUndefined()
  })
})
