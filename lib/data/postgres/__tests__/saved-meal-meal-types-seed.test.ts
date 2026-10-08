// Issue 2153 (LB-199) — the one-time history seed of saved_meal_meal_types.
//
// The migration file IS the seed, so the test runs the file itself against shaped data rather than
// re-stating the rule in TypeScript (two copies of a threshold is how they drift). The file is
// replay-safe by design, which is also what lets this re-run it after the schema is already built.
//
// Shapes come from the owner's measured saved meals: a shake with 45 logs all at breakfast, meals
// with a single log, and meals never logged. Runs only against a real Postgres.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002153'
const SQL = canRun
  ? readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/202610080512_seed_saved_meal_meal_types.sql'), 'utf8')
  : ''

describe.skipIf(!canRun)('saved meal meal-type seed (issue 2153)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let types: Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string>
  let foodId: string

  const mkMeal = async (name: string, seeded: boolean) => (await pool.query(
    `INSERT INTO saved_meals (user_id, name, meal_types_seeded) VALUES ($1,$2,$3) RETURNING id`,
    [USER, name, seeded])).rows[0].id as string

  // `groups` logging events at the given meal type, each `rowsPerGroup` ingredient rows.
  const log = async (mealId: string, typeId: string, groups: number, opts: { rowsPerGroup?: number; deleted?: boolean } = {}) => {
    for (let g = 0; g < groups; g++) {
      const groupId = (await pool.query(`SELECT gen_random_uuid() AS id`)).rows[0].id
      for (let r = 0; r < (opts.rowsPerGroup ?? 1); r++) {
        await pool.query(
          `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, saved_meal_id, meal_group_id, deleted_at)
           VALUES ($1,'2026-09-01',$2,$3,$4,$5,$6)`,
          [USER, typeId, foodId, mealId, groupId, opts.deleted ? new Date() : null])
      }
    }
  }

  const tagsOf = async (mealId: string) => (await pool.query(
    `SELECT meal_type_id FROM saved_meal_meal_types WHERE saved_meal_id = $1`, [mealId])).rows
    .map(r => r.meal_type_id as string).sort()
  const seed = () => pool.query(SQL)
  const one = [{ foodItemId: '', quantityMultiplier: 1 }]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    pool = getPool()
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'seed2153@example.com','x','Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    types = {} as typeof types
    for (const n of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      types[n] = (await pool.query(
        `INSERT INTO meal_types (user_id, name) VALUES ($1,$2) RETURNING id`, [USER, `Seed2153 ${n}`])).rows[0].id
    }
    foodId = (await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1,'Seed2153 Whey',30,120,24,3,1,'manual') RETURNING id`, [USER])).rows[0].id
    one[0].foodItemId = foodId
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [USER])
    await pool.query(`UPDATE meal_types SET deleted_at = NULL WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM food_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('ticks breakfast for a meal with 45 logs, every one at breakfast', async () => {
    const shake = await mkMeal('Shake', false)
    await log(shake, types.breakfast, 45)
    await seed()
    expect(await tagsOf(shake)).toEqual([types.breakfast])
  })

  it('ticks a type only at >= 3 logs AND >= 60% of the meal logs', async () => {
    const mixed = await mkMeal('Mixed', false)        // 6 breakfast + 4 lunch: 60% / 40%
    await log(mixed, types.breakfast, 6); await log(mixed, types.lunch, 4)
    const under = await mkMeal('Under', false)        // 5 + 5: 50% each, nothing qualifies
    await log(under, types.breakfast, 5); await log(under, types.dinner, 5)
    const short = await mkMeal('Short', false)        // 2 of 2 is 100% but only 2 logs
    await log(short, types.dinner, 2)
    const edge = await mkMeal('Edge', false)          // 3 of 5 is exactly 60%
    await log(edge, types.snack, 3); await log(edge, types.lunch, 2)
    await seed()
    expect(await tagsOf(mixed)).toEqual([types.breakfast])
    expect(await tagsOf(under)).toEqual([])
    expect(await tagsOf(short)).toEqual([])
    expect(await tagsOf(edge)).toEqual([types.snack])
  })

  it('ticks nothing for one log and for a meal never logged', async () => {
    const single = await mkMeal('One', false); await log(single, types.lunch, 1)
    const never = await mkMeal('Never', false)
    await seed()
    expect(await tagsOf(single)).toEqual([])
    expect(await tagsOf(never)).toEqual([])
  })

  it('counts logging events, not ingredient rows', async () => {
    const m = await mkMeal('Stew', false)
    await log(m, types.dinner, 2, { rowsPerGroup: 4 })   // 8 rows, 2 events: under the floor of 3
    await seed()
    expect(await tagsOf(m)).toEqual([])
  })

  it('ignores deleted logs and deleted meal types', async () => {
    const gone = await mkMeal('Gone', false); await log(gone, types.lunch, 5, { deleted: true })
    const retired = await mkMeal('Retired', false); await log(retired, types.snack, 5)
    await pool.query(`UPDATE meal_types SET deleted_at = now() WHERE id = $1`, [types.snack])
    await seed()
    expect(await tagsOf(gone)).toEqual([])
    expect(await tagsOf(retired)).toEqual([])
  })

  it('never overwrites a declared set, including a deliberately empty one', async () => {
    const chosen = await mkMeal('Chosen', true)            // declared: the seed must not look
    const hasRows = await mkMeal('HasRows', false)         // not yet looked at, but already has a row
    await pool.query(`INSERT INTO saved_meal_meal_types VALUES ($1,$2)`, [hasRows, types.snack])
    await log(chosen, types.breakfast, 9); await log(hasRows, types.breakfast, 9)
    await seed()
    expect(await tagsOf(chosen)).toEqual([])
    expect(await tagsOf(hasRows)).toEqual([types.snack])
  })

  it('marks every existing meal as looked at, and a replay changes nothing', async () => {
    const m = await mkMeal('Once', false); await log(m, types.breakfast, 4)
    await seed()
    expect((await pool.query(`SELECT meal_types_seeded FROM saved_meals WHERE id=$1`, [m])).rows[0].meal_types_seeded).toBe(true)
    await pool.query(`DELETE FROM saved_meal_meal_types WHERE saved_meal_id = $1`, [m])   // the user clears it
    await seed()                                                                             // replay
    expect(await tagsOf(m)).toEqual([])
  })

  it('does not seed a meal created after the migration', async () => {
    const created = await repo.createSavedMeal(USER, 'Fresh', one)
    await log(created.id, types.breakfast, 9)
    await seed()
    expect(await tagsOf(created.id)).toEqual([])
  })

  it('lets a meal carry every meal type, and a hard delete of a type drops it from the set', async () => {
    const all = Object.values(types)
    const meal = await repo.createSavedMeal(USER, 'All four', one, undefined, 1, undefined, all)
    expect([...meal.mealTypeIds!].sort()).toEqual([...all].sort())
    const spare = (await pool.query(
      `INSERT INTO meal_types (user_id, name) VALUES ($1,'Seed2153 spare') RETURNING id`, [USER])).rows[0].id as string
    await repo.updateSavedMeal(meal.id, USER, 'All four', one, 1, undefined, [...all, spare])
    await pool.query(`DELETE FROM meal_types WHERE id = $1`, [spare])
    const after = (await repo.listSavedMeals(USER)).find(m => m.id === meal.id)!
    expect([...after.mealTypeIds!].sort()).toEqual([...all].sort())
  })
})
