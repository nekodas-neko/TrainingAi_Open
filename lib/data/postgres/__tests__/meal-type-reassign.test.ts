// Q-412: deleting a meal type with logs answered 409 "reassign them first" — naming an action the
// app had never implemented, so the only escape a user could perform was deleting every food log
// against that meal type. This pins the reassign that message always promised.
//
// The two things worth a test rather than a read: the move and the delete are ONE transaction (a
// half-done reassign leaves no way back), and each moved row is re-stamped against the NEW window
// per Q-413 — otherwise a 3 pm snack moved to Lunch keeps a 15:00 time sitting outside Lunch.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000412'
const TZ = 'Australia/Brisbane'

const SNACK_ID = '00000000-0000-4000-8000-000000041201'   // 15–17
const LUNCH_ID = '00000000-0000-4000-8000-000000041202'   // 12–15
const ITEM_ID  = '00000000-0000-4000-8000-000000041203'

describe.skipIf(!canRun)('meal type reassign + delete (Q-412)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const localOf = (at: Date) => formatInTimeZone(at, TZ, 'yyyy-MM-dd HH:mm')

  const addLog = (date: string, mealTypeId: string, loggedAt: Date) =>
    repo.createFoodLog(TEST_USER_ID, { date, mealTypeId, foodItemId: ITEM_ID, quantityMultiplier: 1, loggedAt })

  const liveMealTypeIds = async () =>
    (await repo.listMealTypes(TEST_USER_ID)).map(m => m.id)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [TEST_USER_ID, `reassign-${TEST_USER_ID}@example.com`, TZ])
    await pool.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1,$2,'Q412 item',100,200,10,10,10,'manual') ON CONFLICT (id) DO NOTHING`,
      [ITEM_ID, TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_types WHERE user_id=$1', [TEST_USER_ID])
    for (const [id, name, start, end] of [
      [SNACK_ID, 'Q412 Afternoon Snack', 15, 17],
      [LUNCH_ID, 'Q412 Lunch', 12, 15],
    ] as const) {
      await pool.query(
        `INSERT INTO meal_types (id, user_id, name, time_start_hour, time_end_hour) VALUES ($1,$2,$3,$4,$5)`,
        [id, TEST_USER_ID, name, start, end])
    }
  })

  afterAll(async () => {
    await pool.query('DELETE FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM meal_types WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM food_items WHERE user_id=$1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id=$1', [TEST_USER_ID])
  })

  it('refuses a plain delete and says how many entries are in the way', async () => {
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    await addLog('2026-08-17', SNACK_ID, new Date('2026-08-17T06:00:00Z'))
    expect(await repo.countLiveFoodLogsForMealType(TEST_USER_ID, SNACK_ID)).toBe(2)
    await expect(repo.deleteMealType(SNACK_ID, TEST_USER_ID)).rejects.toMatchObject({ logCount: 2 })
  })

  it('moves the logs, deletes the type, and leaves the day totals untouched', async () => {
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))   // 16:00 Bne, in Snack
    await addLog('2026-08-17', SNACK_ID, new Date('2026-08-17T06:00:00Z'))
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM food_logs WHERE user_id=$1 AND deleted_at IS NULL', [TEST_USER_ID])

    const { moved } = await repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, LUNCH_ID)
    expect(moved).toBe(2)

    const after = await pool.query(
      'SELECT count(*)::int AS n FROM food_logs WHERE user_id=$1 AND deleted_at IS NULL', [TEST_USER_ID])
    // Nothing is destroyed — the entries move, they do not go away. That distinction is the whole
    // point: the only escape before this was deleting them.
    expect(after.rows[0].n).toBe(before.rows[0].n)

    const rows = await pool.query('SELECT meal_type_id FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    expect(rows.rows.every((r: { meal_type_id: string }) => r.meal_type_id === LUNCH_ID)).toBe(true)
    expect(await liveMealTypeIds()).not.toContain(SNACK_ID)
    expect(await liveMealTypeIds()).toContain(LUNCH_ID)
  })

  it('re-stamps each moved log against the NEW window (Q-413)', async () => {
    // 16:00 Brisbane sits inside Afternoon Snack (15–17) and outside Lunch (12–15). Left alone it
    // would keep a 16:00 stamp under a meal that ends at 15:00 — the inconsistency the move exists
    // to tidy.
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    await repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, LUNCH_ID)
    const { rows } = await pool.query('SELECT logged_at FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    expect(localOf(new Date(rows[0].logged_at))).toBe('2026-08-18 13:30')
  })

  it('keeps a moved log\'s time when it already falls inside the new window', async () => {
    // 13:20 Brisbane is inside Lunch, so the real instant must survive the move — a derived time
    // would be a downgrade here.
    //
    // The stored time is set directly rather than through `createFoodLog`, because since Q-413 a
    // create resolves against its OWN window: a log written under Snack (15–17) can never come out
    // holding 13:20. Two real cases produce a row like this — a pre-Q-413 row, and overlapping
    // windows — and this is the shape both take.
    const at = new Date('2026-08-18T03:20:00Z')
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    await pool.query('UPDATE food_logs SET logged_at=$2 WHERE user_id=$1', [TEST_USER_ID, at])

    await repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, LUNCH_ID)
    const { rows } = await pool.query('SELECT logged_at FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    expect(new Date(rows[0].logged_at).getTime()).toBe(at.getTime())
  })

  it('deletes an empty meal type without needing a target at all', async () => {
    await repo.deleteMealType(SNACK_ID, TEST_USER_ID)
    expect(await liveMealTypeIds()).not.toContain(SNACK_ID)
  })

  it('refuses to move a meal type onto itself', async () => {
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    await expect(repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, SNACK_ID)).rejects.toThrow()
    expect(await liveMealTypeIds()).toContain(SNACK_ID)
  })

  it('refuses a target that is not the user\'s, and changes nothing', async () => {
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    const stranger = '00000000-0000-4000-8000-0000004120ff'
    await expect(repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, stranger)).rejects.toThrow()
    const { rows } = await pool.query('SELECT meal_type_id FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    expect(rows[0].meal_type_id).toBe(SNACK_ID)
    expect(await liveMealTypeIds()).toContain(SNACK_ID)
  })

  it('bumps updated_at on every moved row, which is what carries the move to other devices', async () => {
    await addLog('2026-08-18', SNACK_ID, new Date('2026-08-18T06:00:00Z'))
    await pool.query(`UPDATE food_logs SET updated_at = now() - interval '1 day' WHERE user_id=$1`, [TEST_USER_ID])
    const { rows: before } = await pool.query('SELECT updated_at FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    await repo.reassignAndDeleteMealType(TEST_USER_ID, SNACK_ID, LUNCH_ID)
    const { rows: after } = await pool.query('SELECT updated_at FROM food_logs WHERE user_id=$1', [TEST_USER_ID])
    // getSyncDelta cursors on updated_at; without this bump the move never reaches another device.
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(new Date(before[0].updated_at).getTime())
  })
})
