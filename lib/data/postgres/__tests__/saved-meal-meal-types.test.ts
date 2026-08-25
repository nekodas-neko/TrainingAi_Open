// BF-11e — which meal types a saved meal is eligible for. The owner's report is the whole
// specification: *"we don't want pancakes recommended for dinner."*
//
// Three behaviours here are decisions rather than mechanics, and each has a test because getting
// any of them wrong is silent:
//   * soft-deleted meal types are filtered on READ, not deleted from the join table;
//   * `undefined` leaves stored tags alone, `[]` clears them;
//   * a client-supplied meal-type id is ownership-verified even though the join table has no
//     `user_id` of its own.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bf11'
const OTHER = '00000000-0000-4000-8000-00000000bf12'

describe.skipIf(!canRun)('saved meal meal-type tags (BF-11e)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let breakfast: string, dinner: string, otherUsersType: string, foodId: string

  const tagsOn = async (mealId: string, userId = USER) =>
    (await repo.listSavedMeals(userId)).find(m => m.id === mealId)?.mealTypeIds

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    pool = getPool()
    repo = new PostgresWorkoutRepository()
    for (const [id, email] of [[USER, 'bf11e'], [OTHER, 'bf11e-other']] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `${email}@example.com`])
    }
    const mk = async (userId: string, name: string) => (await pool.query(
      `INSERT INTO meal_types (user_id, name) VALUES ($1,$2) RETURNING id`, [userId, name])).rows[0].id as string
    breakfast = await mk(USER, 'BF-11e Breakfast')
    dinner = await mk(USER, 'BF-11e Dinner')
    otherUsersType = await mk(OTHER, 'BF-11e Someone Else')
    foodId = (await pool.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1,'BF-11e Oats',100,380,13,60,7,'manual') RETURNING id`, [USER])).rows[0].id
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM saved_meals WHERE user_id = $1`, [USER])
    // Two tests below soft-delete a meal type. Undoing it HERE rather than at the end of those test
    // bodies is what keeps the file order-independent: a body that fails part-way never reaches its
    // own cleanup, and the next test then sees a deleted type and fails for a reason that has
    // nothing to do with it. Found by mutation-testing this file — one seeded defect produced two
    // failures, and the second was this leak rather than the defect.
    await pool.query(`UPDATE meal_types SET deleted_at = NULL WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER, OTHER]])
  })

  const items = () => [{ foodItemId: foodId, quantityMultiplier: 1 }]

  it('round-trips the tags it was given', async () => {
    const meal = await repo.createSavedMeal(USER, 'Pancakes', items(), undefined, 1, undefined, [breakfast])
    expect(meal.mealTypeIds).toEqual([breakfast])
    expect(await tagsOn(meal.id)).toEqual([breakfast])
  })

  it('is an empty array, not undefined, when a meal has no tags', async () => {
    const meal = await repo.createSavedMeal(USER, 'Untagged', items())
    expect(meal.mealTypeIds).toEqual([])
  })

  // The distinction the whole feature rests on. Until BF-11f ships a tag picker, EVERY save from the
  // saved-meals sheet omits `mealTypeIds` — if that read as "clear", tags could never be kept.
  it('leaves stored tags alone when the write does not mention them', async () => {
    const meal = await repo.createSavedMeal(USER, 'Pancakes', items(), undefined, 1, undefined, [breakfast, dinner])
    await repo.updateSavedMeal(meal.id, USER, 'Pancakes, renamed', items(), 1, undefined, undefined)
    expect((await tagsOn(meal.id))?.sort()).toEqual([breakfast, dinner].sort())
  })

  it('clears them on an explicit empty array', async () => {
    const meal = await repo.createSavedMeal(USER, 'Pancakes', items(), undefined, 1, undefined, [breakfast])
    await repo.updateSavedMeal(meal.id, USER, 'Pancakes', items(), 1, undefined, [])
    expect(await tagsOn(meal.id)).toEqual([])
  })

  it('replaces wholesale rather than merging', async () => {
    const meal = await repo.createSavedMeal(USER, 'Shake', items(), undefined, 1, undefined, [breakfast])
    await repo.updateSavedMeal(meal.id, USER, 'Shake', items(), 1, undefined, [dinner])
    expect(await tagsOn(meal.id)).toEqual([dinner])
  })

  // `saved_meal_meal_types` has no `user_id`, and its FK only proves the meal type EXISTS.
  it('refuses a meal type belonging to another user', async () => {
    await expect(
      repo.createSavedMeal(USER, 'Sneaky', items(), undefined, 1, undefined, [otherUsersType]),
    ).rejects.toThrow(/Unknown meal type/)
    expect((await repo.listSavedMeals(USER)).find(m => m.name === 'Sneaky')).toBeUndefined()
  })

  it('refuses a meal type that does not exist at all', async () => {
    await expect(
      repo.createSavedMeal(USER, 'Ghost', items(), undefined, 1, undefined,
        ['00000000-0000-4000-8000-0000000000ff']),
    ).rejects.toThrow(/Unknown meal type/)
  })

  // Meal types SOFT-delete, so a join row can point at a deleted one. Filtering on read rather than
  // deleting join rows is what makes restoring a type restore its tags — the alternative loses them
  // permanently on a delete the user can undo.
  it('hides a soft-deleted type and brings it back when the type is restored', async () => {
    const meal = await repo.createSavedMeal(USER, 'Pancakes', items(), undefined, 1, undefined, [breakfast, dinner])

    await pool.query(`UPDATE meal_types SET deleted_at = now() WHERE id = $1`, [breakfast])
    expect(await tagsOn(meal.id)).toEqual([dinner])

    await pool.query(`UPDATE meal_types SET deleted_at = NULL WHERE id = $1`, [breakfast])
    expect((await tagsOn(meal.id))?.sort()).toEqual([breakfast, dinner].sort())
  })

  it('refuses to tag with a soft-deleted type on a new write', async () => {
    await pool.query(`UPDATE meal_types SET deleted_at = now() WHERE id = $1`, [dinner])
    await expect(
      repo.createSavedMeal(USER, 'Late', items(), undefined, 1, undefined, [dinner]),
    ).rejects.toThrow(/Unknown meal type/)
  })

  it('drops the tags with the meal', async () => {
    const meal = await repo.createSavedMeal(USER, 'Doomed', items(), undefined, 1, undefined, [breakfast])
    await repo.deleteSavedMeal(meal.id, USER)
    const { rows } = await pool.query(
      `SELECT 1 FROM saved_meal_meal_types WHERE saved_meal_id = $1`, [meal.id])
    expect(rows).toEqual([])
  })
})
