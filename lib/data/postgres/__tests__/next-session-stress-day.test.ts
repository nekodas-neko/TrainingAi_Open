// TN-34 (2026-09-16): daytime stress no longer drives the deload override AT ALL, so this file's
// original subject is gone and its assertions are inverted rather than deleted.
//
// It was a regression test for the adapter reading `derivedRows[0]` — yesterday, under an ASC-sorted
// range — so a stale prior-day stress spike tripped today's Deload/Rest prompt. **That day-selection
// is now unreachable through the recommendation:** `todayDerived` still picks today correctly, but
// its only consumer is `stressHighMinutes`, which the engine now ignores. There is no longer a way
// to observe the yesterday/today bug through `deloadOrRestRecommended`.
//
// So both cases now pin the UNWIRING at the integration layer, which is the level that catches a
// re-wire in the adapter rather than in the shared function. **Do not "restore" the old
// today=high → true assertion**: it would not be fixing a broken day-selection, it would be
// re-introducing a deload flag that fired on 83% of the owner's days off a number correlating
// +0.072 with readiness. See TN-34.
//
// Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz, toAestDay } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const TEST_USER_ID = '00000000-0000-4000-8000-0000000222ee'

describe.skipIf(!canRun)('getNextSession — deload stress override reads today, not yesterday', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const today = todayInTz(TZ)
  const yesterday = toAestDay(new Date(Date.now() - 86_400_000), TZ)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `stress-${TEST_USER_ID}@example.com`, TZ],
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
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `DELETE FROM session_exercises WHERE session_id IN (
         SELECT ps.id FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE p.user_id = $1)`,
      [TEST_USER_ID],
    )
    await pool.query(
      `DELETE FROM program_sessions WHERE program_id IN (SELECT id FROM programs WHERE user_id = $1)`,
      [TEST_USER_ID],
    )
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [TEST_USER_ID])
  }

  async function setDerived(day: string, stressHighMinutes: number) {
    await pool.query(
      `INSERT INTO oura_daily_derived (user_id, day, source, stress_high_minutes)
       VALUES ($1, $2, 'derived', $3)
       ON CONFLICT (user_id, day) DO UPDATE SET stress_high_minutes = EXCLUDED.stress_high_minutes`,
      [TEST_USER_ID, day, stressHighMinutes],
    )
  }

  it('does NOT recommend a deload when yesterday was high-stress', async () => {
    await setDerived(yesterday, 180)
    await setDerived(today, 0)
    const rec = await repo.getNextSession(TEST_USER_ID, TZ)
    expect(rec.deloadOrRestRecommended ?? false).toBe(false)
  })

  it('does NOT recommend a deload when TODAY is high-stress either (TN-34 unwired it)', async () => {
    await setDerived(yesterday, 0)
    await setDerived(today, 180)
    const rec = await repo.getNextSession(TEST_USER_ID, TZ)
    expect(rec.deloadOrRestRecommended ?? false).toBe(false)
  })

  it('stays unrecommended at an extreme value — unwired, not re-thresholded', async () => {
    // The entry warns that raising STRESS_HIGH_DAY_THRESHOLD_MIN would be the fifth
    // "the threshold is right, the input is wrong" in this pillar. 1000 minutes clears any
    // plausible raised constant, so this fails if someone re-thresholds instead of unwiring.
    await setDerived(today, 1000)
    const rec = await repo.getNextSession(TEST_USER_ID, TZ)
    expect(rec.deloadOrRestRecommended ?? false).toBe(false)
  })
})
