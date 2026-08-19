// Q-413: `food_logs.logged_at` recorded when the row was created, not when the food was eaten.
// `createFoodLog` now resolves it against the meal type's window, and this pins that the SERVER
// does it — the shared formula has its own unit tests, but the thing that historically drifts in
// this project is a write path, not a formula. Both server paths (the web route and the offline
// `pushMutations` branch) land in `createFoodLog`, so one test covers both.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000413'
const TZ = 'Australia/Brisbane'

const LUNCH_ID     = '00000000-0000-4000-8000-000000041301'
const OVERNIGHT_ID = '00000000-0000-4000-8000-000000041302'
const ALL_DAY_ID   = '00000000-0000-4000-8000-000000041303'
const FOOD_ITEM_ID = '00000000-0000-4000-8000-000000041304'

describe.skipIf(!canRun)('food log eaten-at resolution (Q-413)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  /** The wall clock the stored instant reads at, in the user's zone — the rule is stated in those terms. */
  const localOf = (at: Date) => formatInTimeZone(at, TZ, 'yyyy-MM-dd HH:mm')

  const create = (date: string, mealTypeId: string, loggedAt?: Date) =>
    repo.createFoodLog(TEST_USER_ID, { date, mealTypeId, foodItemId: FOOD_ITEM_ID, quantityMultiplier: 1, loggedAt })

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [TEST_USER_ID, `eatenat-${TEST_USER_ID}@example.com`, TZ])
    for (const [id, name, start, end] of [
      [LUNCH_ID, 'Q413 Lunch', 12, 15],
      [OVERNIGHT_ID, 'Q413 Overnight', 22, 2],
      [ALL_DAY_ID, 'Q413 All day', 0, 24],
    ] as const) {
      await pool.query(
        `INSERT INTO meal_types (id, user_id, name, time_start_hour, time_end_hour)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [id, TEST_USER_ID, name, start, end])
    }
    await pool.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1,$2,'Q413 item',100,100,10,10,10,'manual') ON CONFLICT (id) DO NOTHING`,
      [FOOD_ITEM_ID, TEST_USER_ID])
  })

  beforeEach(async () => { await pool.query('DELETE FROM food_logs WHERE user_id=$1', [TEST_USER_ID]) })

  afterAll(async () => {
    await pool.query('DELETE FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_types WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM food_items WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  it('keeps the real instant when it is on the log\'s date and inside the window', async () => {
    const at = new Date('2026-08-19T03:20:00Z')   // 13:20 Brisbane
    const log = await create('2026-08-19', LUNCH_ID, at)
    expect(log.loggedAt.getTime()).toBe(at.getTime())
  })

  it('back-dating stamps the window midpoint on the LOG\'s date, not the day it was entered', async () => {
    // 13:20 Brisbane on the 19th, filed against the 17th. Before Q-413 the row said 13:20 on the
    // 19th while its date said the 17th — the two disagreed and the timestamp was the wrong one.
    const log = await create('2026-08-17', LUNCH_ID, new Date('2026-08-19T03:20:00Z'))
    expect(localOf(log.loggedAt)).toBe('2026-08-17 13:30')
  })

  it('moves a same-day log that falls outside the window to the midpoint', async () => {
    const log = await create('2026-08-19', LUNCH_ID, new Date('2026-08-19T12:00:00Z'))  // 22:00 Bne
    expect(localOf(log.loggedAt)).toBe('2026-08-19 13:30')
  })

  it('a wrapping window resolves onto the log\'s own date', async () => {
    const log = await create('2026-08-19', OVERNIGHT_ID, new Date('2026-08-19T04:00:00Z')) // 14:00 Bne
    expect(localOf(log.loggedAt)).toBe('2026-08-19 00:00')
    // The stored date and the stored instant must agree — that disagreement IS the defect.
    expect(formatInTimeZone(log.loggedAt, TZ, 'yyyy-MM-dd')).toBe('2026-08-19')
  })

  it('the default 0–24 window keeps any same-day instant', async () => {
    const at = new Date('2026-08-19T12:00:00Z')
    const log = await create('2026-08-19', ALL_DAY_ID, at)
    expect(log.loggedAt.getTime()).toBe(at.getTime())
  })

  it('resolves in the USER\'s stored timezone, not the server\'s', async () => {
    await pool.query('UPDATE users SET timezone=$2 WHERE id=$1', [TEST_USER_ID, 'America/New_York'])
    try {
      const log = await create('2026-08-17', LUNCH_ID, new Date('2026-08-19T03:20:00Z'))
      expect(formatInTimeZone(log.loggedAt, 'America/New_York', 'yyyy-MM-dd HH:mm')).toBe('2026-08-17 13:30')
      // 13:30 in New York is not 13:30 in Brisbane; a tz-blind implementation passes the line above
      // only by accident of the server's own zone.
      expect(localOf(log.loggedAt)).not.toBe('2026-08-17 13:30')
    } finally {
      await pool.query('UPDATE users SET timezone=$2 WHERE id=$1', [TEST_USER_ID, TZ])
    }
  })

  it('a client-supplied loggedAt is a candidate, not an answer', async () => {
    // The offline replay carries the instant the BUTTON was pressed. Passing it through unexamined
    // is exactly what Q-413 exists to stop.
    const log = await create('2026-08-17', LUNCH_ID, new Date('2026-08-19T22:00:00Z'))
    expect(localOf(log.loggedAt)).toBe('2026-08-17 13:30')
  })

  it('with no loggedAt at all it still resolves rather than taking the column default', async () => {
    const log = await create('2026-08-17', LUNCH_ID)
    expect(localOf(log.loggedAt)).toBe('2026-08-17 13:30')
  })
})
