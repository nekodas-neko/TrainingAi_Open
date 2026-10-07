// Issue 2661. Deleting a food log, weigh-in, step entry or run must take its achievement progress
// with it. One test per query in `computeAchievements`, each proving the entry COUNTS while live
// before showing it stops counting once tombstoned — a test that only checked the deleted state
// would pass against a query that never counted anything.
//
// Not covered here: the current-weight subquery behind the calorie goal's cut/bulk direction. It is
// policed by `lib/__tests__/achievements-tombstone-scan.test.ts`, but its result is not reachable
// from `computeAchievements` today, because `goalDirRes` and `scheduleRes` are destructured in the
// opposite order to their queries (filed separately); a behaviour test would pass or fail for the
// wrong reason until that is fixed.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const USERS = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000266${i}`)

describe.skipIf(!canRun)('achievements ignore deleted entries', () => {
  let pool: import('pg').Pool
  let compute: typeof import('@/lib/achievements').computeAchievements
  const today = todayInTz(TZ)

  const seedUser = async (id: string) => {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
      [id, `ach-2661-${id.slice(-1)}@example.com`, TZ])
  }
  const tombstone = (table: string, id: string) =>
    pool.query(`UPDATE ${table} SET deleted_at = now() WHERE user_id = $1`, [id])
  const progress = async (id: string, achievement: string) =>
    (await compute(id, TZ)).achievements.find(a => a.id === achievement)?.current

  /** A food log of `kcal` on today's date, for the user. */
  const logFood = async (id: string, kcal: number) => {
    const mt = await pool.query(`INSERT INTO meal_types (user_id, name) VALUES ($1,'Lunch') RETURNING id`, [id])
    const fi = await pool.query(
      `INSERT INTO food_items (user_id, name, calories, source) VALUES ($1,'Test food',$2,'manual') RETURNING id`,
      [id, kcal])
    await pool.query(
      `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id) VALUES ($1,$2,$3,$4)`,
      [id, today, mt.rows[0].id, fi.rows[0].id])
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    compute = (await import('@/lib/achievements')).computeAchievements
    for (const id of USERS) await seedUser(id)
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS])
  })

  it('the food-logging streak: a deleted food log does not count as a logged day', async () => {
    const id = USERS[0]
    await logFood(id, 500)
    expect(await progress(id, 'food_first')).toBe(1)
    await tombstone('food_logs', id)
    expect(await progress(id, 'food_first')).toBe(0)
  })

  it('the calorie-goal days: a deleted food log does not make a goal-hitting day', async () => {
    const id = USERS[1]
    await pool.query(`INSERT INTO nutrition_targets (user_id, calories) VALUES ($1, 2000)
                      ON CONFLICT (user_id) DO UPDATE SET calories = 2000`, [id])
    await logFood(id, 2000)   // no target weight: "maintaining", so exactly the target is a hit
    expect(await progress(id, 'calorie_goal_7')).toBe(1)
    await tombstone('food_logs', id)
    expect(await progress(id, 'calorie_goal_7')).toBe(0)
  })

  it('the weigh-in count: a deleted weigh-in does not count', async () => {
    const id = USERS[2]
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1,$2,80)`, [id, today])
    expect(await progress(id, 'weight_first')).toBe(1)
    await tombstone('body_metrics', id)
    expect(await progress(id, 'weight_first')).toBe(0)
  })

  it('the best step day: a deleted step entry does not set the record', async () => {
    const id = USERS[3]
    await pool.query(`INSERT INTO body_metrics (user_id, date, steps) VALUES ($1,$2,6000)`, [id, today])
    expect(await progress(id, 'steps_5k')).toBe(6000)
    await tombstone('body_metrics', id)
    expect(await progress(id, 'steps_5k')).toBe(0)
  })

  it('total distance: a deleted run does not add its kilometres', async () => {
    const id = USERS[4]
    await pool.query(`INSERT INTO activity_logs (user_id, date, title, distance_km) VALUES ($1,$2,'Run',5)`, [id, today])
    expect((await compute(id, TZ)).lifetimeStats.totalDistanceKm).toBe(5)
    await tombstone('activity_logs', id)
    expect((await compute(id, TZ)).lifetimeStats.totalDistanceKm).toBe(0)
  })
})
