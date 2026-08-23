// Q-387: the maintenance calibration averaged every logged day, and a day abandoned after lunch is
// byte-for-byte identical to a completed light day. This pins the storage half — the flag survives
// an ordinary check-in save, and Undo clears it.
//
// The clobber is the part worth a test: `saveDayCheckin` upserts and overwrites every column it is
// given a value for, and the evening check-in sheet knows nothing about food logging. Without the
// omit-when-undefined guard, filling in the check-in would silently un-complete the day.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000387'
const DATE = '2026-08-09'

describe.skipIf(!canRun)('food-logging completeness flag (Q-387)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const blankCheckin = {
    logDate: DATE, phase: 'evening' as const,
    physicalTiredness: null, mentalDrain: null, barelyMoved: null, hydration: null,
    lateHeavyMeal: null, wakeMood: null, perceivedRecovery: null, motivation: null,
    sleepQualityFeel: null, restingSoreness: null, illnessContext: null,
    perceivedRecoveryTouched: false, sleepQualityFeelTouched: false,
    soreMuscles: [], journal: null,
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `logcomplete-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => { await pool.query('DELETE FROM day_checkins WHERE user_id=$1', [TEST_USER_ID]) })
  afterAll(async () => {
    await pool.query('DELETE FROM day_checkins WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  it('marks a day complete and reads it back', async () => {
    const saved = await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, foodLoggingCompletedAt: new Date() })
    expect(saved.foodLoggingCompletedAt).toBeInstanceOf(Date)

    const read = await repo.getDayCheckin(TEST_USER_ID, DATE, 'evening')
    expect(read?.foodLoggingCompletedAt).toBeInstanceOf(Date)
  })

  it('SURVIVES an ordinary check-in save that says nothing about food logging', async () => {
    await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, foodLoggingCompletedAt: new Date() })

    // Exactly what the evening sheet sends: no foodLoggingCompletedAt key at all.
    await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, physicalTiredness: 3, journal: 'ok' })

    const read = await repo.getDayCheckin(TEST_USER_ID, DATE, 'evening')
    expect(read?.foodLoggingCompletedAt).toBeInstanceOf(Date)
    expect(read?.physicalTiredness).toBe(3)
  })

  it('Undo clears it when null is passed explicitly', async () => {
    await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, foodLoggingCompletedAt: new Date() })
    await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, foodLoggingCompletedAt: null })

    const read = await repo.getDayCheckin(TEST_USER_ID, DATE, 'evening')
    expect(read?.foodLoggingCompletedAt).toBeNull()
  })

  it('defaults to null — no backfill, a past day cannot be given an honest flag', async () => {
    await repo.saveDayCheckin(TEST_USER_ID, blankCheckin)

    const read = await repo.getDayCheckin(TEST_USER_ID, DATE, 'evening')
    expect(read?.foodLoggingCompletedAt).toBeNull()
  })

  it('listDayCheckins carries it, since that is what the calibration window reads', async () => {
    await repo.saveDayCheckin(TEST_USER_ID, { ...blankCheckin, foodLoggingCompletedAt: new Date() })

    const rows = await repo.listDayCheckins(TEST_USER_ID, '2026-08-01', '2026-08-31', 'evening')
    expect(rows).toHaveLength(1)
    expect(rows[0].foodLoggingCompletedAt).toBeInstanceOf(Date)
  })
})
