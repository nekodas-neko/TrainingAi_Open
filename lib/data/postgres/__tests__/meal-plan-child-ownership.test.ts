// RV-42 — a plan meal's `meal_type_id` and `saved_meal_id` are client-supplied and reach tables
// whose FK proves only that the row exists, not whose it is. `meal_plan_meals` has no `user_id`,
// so without a pre-check one account can point its plan at another's rows.
//
// **Nothing leaks** — the meal-plan read joins neither table and returns raw ids. What it costs is
// the reverse: both columns are ON DELETE SET NULL, so the owner deleting their own saved meal
// silently nulls the stranger's plan meal, and neither account can see why. These tests drive the
// cross-account write at all THREE paths (the entry said two) and assert each is refused.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000042a1'
const USER_B = '00000000-0000-4000-8000-0000000042b2'

describe.skipIf(!canRun)("RV-42 — a plan meal cannot point at another account's rows", () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let aSavedMeal: string
  let aMealType: string
  let bSavedMeal: string
  let bMealType: string

  const plan = (meals: Record<string, unknown>[]) => ({
    name: 'RV-42 Plan',
    mealsPerDay: 1,
    targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
    activate: false,
    variants: [{
      dayType: 'all' as const,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      meals: meals.map((m, i) => ({
        position: i, name: 'Meal', targetCalories: 600,
        targetProteinG: 50, targetCarbsG: 60, targetFatG: 20, ...m,
      })),
    }],
  })

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, slug] of [[USER_A, 'rv42-a'], [USER_B, 'rv42-b']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `${slug}@example.com`])
    }
    const mk = async (user: string, label: string) => {
      const sm = await pool.query(
        `INSERT INTO saved_meals (user_id, name, servings) VALUES ($1, $2, 1) RETURNING id`, [user, label])
      const mt = await pool.query(
        `INSERT INTO meal_types (user_id, name, sort_order) VALUES ($1, $2, 0) RETURNING id`, [user, label])
      return [sm.rows[0].id as string, mt.rows[0].id as string] as const
    }
    ;[aSavedMeal, aMealType] = await mk(USER_A, 'A meal')
    ;[bSavedMeal, bMealType] = await mk(USER_B, 'B meal')
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM meal_plans WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  // ── Path 1: create ──
  it("refuses a create naming another account's saved meal", async () => {
    await expect(repo.createMealPlan(USER_B, plan([{ savedMealId: aSavedMeal }]) as never))
      .rejects.toThrow(/saved meal/i)
  })

  it("refuses a create naming another account's meal type", async () => {
    await expect(repo.createMealPlan(USER_B, plan([{ mealTypeId: aMealType }]) as never))
      .rejects.toThrow(/meal type/i)
  })

  it('writes nothing at all when a create is refused', async () => {
    await expect(repo.createMealPlan(USER_B, plan([{ savedMealId: aSavedMeal }]) as never)).rejects.toThrow()
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM meal_plans WHERE user_id = $1`, [USER_B])
    // The check runs inside the transaction and before the first insert, so the plan row itself
    // must not survive the refusal.
    expect(rows[0].n).toBe(0)
  })

  it("accepts a create naming the caller's OWN rows", async () => {
    const created = await repo.createMealPlan(
      USER_B, plan([{ savedMealId: bSavedMeal, mealTypeId: bMealType }]) as never)
    expect(created.variants[0].meals[0].savedMealId).toBe(bSavedMeal)
    expect(created.variants[0].meals[0].mealTypeId).toBe(bMealType)
  })

  // ── Path 2: the PATCH route ──
  it("refuses a meal PATCH naming another account's rows", async () => {
    const created = await repo.createMealPlan(USER_B, plan([{}]) as never)
    const mealId = created.variants[0].meals[0].id
    await expect(repo.updateMealPlanMeal(mealId, USER_B, { savedMealId: aSavedMeal }))
      .rejects.toThrow(/saved meal/i)
    await expect(repo.updateMealPlanMeal(mealId, USER_B, { mealTypeId: aMealType }))
      .rejects.toThrow(/meal type/i)
  })

  it('still allows a PATCH to CLEAR the reference with an explicit null', async () => {
    const created = await repo.createMealPlan(USER_B, plan([{ savedMealId: bSavedMeal }]) as never)
    const mealId = created.variants[0].meals[0].id
    const updated = await repo.updateMealPlanMeal(mealId, USER_B, { savedMealId: null })
    expect(updated?.savedMealId).toBeNull()
  })

  // ── Path 3: replaceMealPlanStructure ──
  it("refuses a structure replace naming another account's rows", async () => {
    const created = await repo.createMealPlan(USER_B, plan([{ savedMealId: bSavedMeal }]) as never)
    const structure = {
      mealsPerDay: 1, trainingTime: null,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      variants: plan([{ savedMealId: aSavedMeal }]).variants,
    }
    await expect(repo.replaceMealPlanStructure(created.id, USER_B, structure as never))
      .rejects.toThrow(/saved meal/i)

    // The check runs before the delete that rewrites the structure, so a refused replace must not
    // have destroyed the plan's existing meals.
    const after = await repo.getMealPlan(created.id, USER_B)
    expect(after?.variants[0].meals[0].savedMealId).toBe(bSavedMeal)
  })
})
