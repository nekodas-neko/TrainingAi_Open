// Meal Plan persistence (Q-186). This file exists for the two things that would be silently
// catastrophic rather than merely wrong:
//
//   1. Ownership. `meal_plan_variants` and `meal_plan_meals` carry no user_id, so a meal edit is
//      only safe if the write joins back to meal_plans — two levels up. A missing join is a
//      cross-user write that no type checker can catch.
//   2. One active plan. Enforced by a partial unique index, so the test asserts the DATABASE
//      refuses a second active plan, not that the application remembered to check.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-00000000mp01'.replace('mp01', '0001')
const USER_B = '00000000-0000-4000-8000-00000000mp02'.replace('mp02', '0002')

describe.skipIf(!canRun)('meal plans — ownership and activation', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const planInput = (name: string, activate = false) => ({
    name,
    mealsPerDay: 3,
    targetCalories: 1800,
    targetProteinG: 150,
    targetCarbsG: 180,
    targetFatG: 60,
    activate,
    variants: [{
      dayType: 'all' as const,
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      meals: [
        { position: 0, name: 'Breakfast', targetCalories: 600, targetProteinG: 50, targetCarbsG: 60, targetFatG: 20 },
        { position: 1, name: 'Lunch', targetCalories: 600, targetProteinG: 50, targetCarbsG: 60, targetFatG: 20 },
        { position: 2, name: 'Dinner', targetCalories: 600, targetProteinG: 50, targetCarbsG: 60, targetFatG: 20 },
      ],
    }],
  })

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, email] of [[USER_A, 'meal-plan-a'], [USER_B, 'meal-plan-b']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `${email}@example.com`],
      )
    }
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM meal_plans WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM meal_plans WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM user_dietary_restrictions WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  it('round-trips a plan with its variant and meals', async () => {
    const created = await repo.createMealPlan(USER_A, planInput('Cut'))
    expect(created.name).toBe('Cut')
    expect(created.variants).toHaveLength(1)
    expect(created.variants[0].meals.map(m => m.name)).toEqual(['Breakfast', 'Lunch', 'Dinner'])

    const fetched = await repo.getMealPlan(created.id, USER_A)
    expect(fetched?.variants[0].meals).toHaveLength(3)
  })

  it('supports a training/rest variant pair on one plan', async () => {
    const created = await repo.createMealPlan(USER_A, {
      ...planInput('Split'),
      variants: [
        { dayType: 'training', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 220, targetFatG: 55,
          meals: [{ position: 0, name: 'Training day meal', targetCalories: 2000, targetProteinG: 150, targetCarbsG: 220, targetFatG: 55 }] },
        { dayType: 'rest', targetCalories: 1700, targetProteinG: 150, targetCarbsG: 150, targetFatG: 62,
          meals: [{ position: 0, name: 'Rest day meal', targetCalories: 1700, targetProteinG: 150, targetCarbsG: 150, targetFatG: 62 }] },
      ],
    })
    expect(created.variants.map(v => v.dayType).sort()).toEqual(['rest', 'training'])
  })

  describe('one active plan per user', () => {
    it('deactivates the previous plan when a new one is activated', async () => {
      const first = await repo.createMealPlan(USER_A, planInput('First', true))
      const second = await repo.createMealPlan(USER_A, planInput('Second', true))
      expect((await repo.getMealPlan(first.id, USER_A))?.isActive).toBe(false)
      expect((await repo.getMealPlan(second.id, USER_A))?.isActive).toBe(true)
      expect((await repo.getActiveMealPlan(USER_A))?.id).toBe(second.id)
    })

    it('is enforced by the database, not only by application code', async () => {
      const first = await repo.createMealPlan(USER_A, planInput('First', true))
      // Bypass the repository entirely — the index must still refuse.
      await expect(pool.query(
        `INSERT INTO meal_plans (user_id, name, is_active, meals_per_day, target_calories, target_protein_g, target_carbs_g, target_fat_g)
         VALUES ($1, 'Sneaky', true, 3, 1800, 150, 180, 60)`,
        [USER_A],
      )).rejects.toThrow(/meal_plans_one_active_per_user|duplicate key/i)
      expect((await repo.getActiveMealPlan(USER_A))?.id).toBe(first.id)
    })

    it('scopes activation per user — two users may each have an active plan', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A', true))
      const b = await repo.createMealPlan(USER_B, planInput('B', true))
      expect((await repo.getActiveMealPlan(USER_A))?.id).toBe(a.id)
      expect((await repo.getActiveMealPlan(USER_B))?.id).toBe(b.id)
    })

    it('frees the slot when the active plan is deleted', async () => {
      const first = await repo.createMealPlan(USER_A, planInput('First', true))
      expect(await repo.deleteMealPlan(first.id, USER_A)).toBe(true)
      expect(await repo.getActiveMealPlan(USER_A)).toBeNull()
      const second = await repo.createMealPlan(USER_A, planInput('Second', true))
      expect((await repo.getActiveMealPlan(USER_A))?.id).toBe(second.id)
    })
  })

  describe('cross-user access is refused everywhere', () => {
    it('will not read another user\'s plan', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      expect(await repo.getMealPlan(a.id, USER_B)).toBeNull()
      expect(await repo.listMealPlans(USER_B)).toHaveLength(0)
    })

    it('will not update another user\'s plan', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      expect(await repo.updateMealPlan(a.id, USER_B, { name: 'Hijacked' })).toBeNull()
      expect((await repo.getMealPlan(a.id, USER_A))?.name).toBe('A')
    })

    it('will not activate, delete or review another user\'s plan', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      expect(await repo.setMealPlanActive(a.id, USER_B, true)).toBeNull()
      expect(await repo.deleteMealPlan(a.id, USER_B)).toBe(false)
      expect(await repo.markMealPlanReviewed(a.id, USER_B)).toBe(false)
      const still = await repo.getMealPlan(a.id, USER_A)
      expect(still).not.toBeNull()
      expect(still!.isActive).toBe(false)
    })

    it('will not edit a meal owned by another user — the join is two levels deep', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      const mealId = a.variants[0].meals[0].id
      expect(await repo.updateMealPlanMeal(mealId, USER_B, { name: 'Hijacked' })).toBeNull()
      const after = await repo.getMealPlan(a.id, USER_A)
      expect(after!.variants[0].meals[0].name).toBe('Breakfast')
    })

    it('edits a meal the user does own', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      const mealId = a.variants[0].meals[0].id
      const updated = await repo.updateMealPlanMeal(mealId, USER_A, { name: 'Oats', targetProteinG: 45 })
      expect(updated?.name).toBe('Oats')
      expect(updated?.targetProteinG).toBe(45)
    })
  })

  describe('meal ingredients (Q-192)', () => {
    const ING = [
      { name: 'Rolled oats', weightG: 60, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 7 },
      { name: 'Whey', weightG: 30, caloriesPer100g: 370, proteinPer100g: 85, carbsPer100g: 5, fatPer100g: 2 },
    ]

    it('round-trips the ingredient snapshot and the suggested time', async () => {
      const input = planInput('Cut')
      input.variants[0].meals[0] = {
        ...input.variants[0].meals[0], ingredients: ING, suggestedTime: '07:00',
      }
      const created = await repo.createMealPlan(USER_A, input)
      const meal = created.variants[0].meals.find(m => m.position === 0)!
      expect(meal.ingredients).toHaveLength(2)
      expect(meal.ingredients[0]).toMatchObject({ name: 'Rolled oats', weightG: 60 })
      expect(meal.suggestedTime).toBe('07:00')
    })

    it('defaults to an empty list for a plan saved without ingredients', async () => {
      // Plans created before this column existed must read as "no snapshot", never as null — every
      // UI site maps over this array.
      const created = await repo.createMealPlan(USER_A, planInput('Old'))
      for (const m of created.variants[0].meals) {
        expect(m.ingredients).toEqual([])
        expect(m.suggestedTime).toBeNull()
      }
    })

    it('lets a single meal be swapped without touching the rest of the plan', async () => {
      // The whole point: editing one meal must not require rebuilding the plan.
      const created = await repo.createMealPlan(USER_A, planInput('Cut'))
      const target = created.variants[0].meals[1]
      const updated = await repo.updateMealPlanMeal(target.id, USER_A, {
        name: 'Something else', ingredients: ING,
      })
      expect(updated?.name).toBe('Something else')
      expect(updated?.ingredients).toHaveLength(2)

      const after = await repo.getMealPlan(created.id, USER_A)
      expect(after!.variants[0].meals.map(m => m.name))
        .toEqual(['Breakfast', 'Something else', 'Dinner'])
      expect(after!.id).toBe(created.id)
    })

    it('will not write ingredients onto another user\'s meal', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      const mealId = a.variants[0].meals[0].id
      expect(await repo.updateMealPlanMeal(mealId, USER_B, { ingredients: ING })).toBeNull()
      const after = await repo.getMealPlan(a.id, USER_A)
      expect(after!.variants[0].meals[0].ingredients).toEqual([])
    })

    it('carries ingredients through a re-split', async () => {
      const input = planInput('Cut', true)
      input.variants[0].meals[0] = { ...input.variants[0].meals[0], ingredients: ING }
      const created = await repo.createMealPlan(USER_A, input)

      const updated = await repo.replaceMealPlanStructure(created.id, USER_A, {
        mealsPerDay: 3, trainingTime: '17:30',
        targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
        variants: [{
          dayType: 'all',
          targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
          meals: created.variants[0].meals.map(m => ({
            position: m.position, name: m.name, ingredients: m.ingredients,
            targetCalories: m.targetCalories, targetProteinG: m.targetProteinG,
            targetCarbsG: m.targetCarbsG, targetFatG: m.targetFatG,
          })),
        }],
      })
      expect(updated!.variants[0].meals[0].ingredients).toHaveLength(2)
    })
  })

  describe('replaceMealPlanStructure', () => {
    const restructure = (mealsPerDay: number, names: string[]) => ({
      mealsPerDay,
      trainingTime: '17:30',
      targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
      variants: [{
        dayType: 'all' as const,
        targetCalories: 1800, targetProteinG: 150, targetCarbsG: 180, targetFatG: 60,
        meals: names.map((name, i) => ({
          position: i, name,
          targetCalories: Math.round(1800 / names.length),
          targetProteinG: 150 / names.length,
          targetCarbsG: 180 / names.length,
          targetFatG: 60 / names.length,
        })),
      }],
    })

    it('keeps the plan id and its activation while rewriting the meals', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('Cut', true))
      const updated = await repo.replaceMealPlanStructure(a.id, USER_A,
        restructure(5, ['Breakfast', 'Lunch', 'Dinner', 'Meal 4', 'Meal 5']))

      expect(updated!.id).toBe(a.id)
      expect(updated!.isActive).toBe(true)
      expect(updated!.mealsPerDay).toBe(5)
      expect(updated!.trainingTime).toBe('17:30')
      expect(updated!.variants[0].meals.map(m => m.name))
        .toEqual(['Breakfast', 'Lunch', 'Dinner', 'Meal 4', 'Meal 5'])
    })

    it('leaves no orphaned variants or meals when the count shrinks', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('Cut', true))
      await repo.replaceMealPlanStructure(a.id, USER_A, restructure(2, ['Brunch', 'Dinner']))

      const { rows: variants } = await pool.query(
        `SELECT count(*)::int AS n FROM meal_plan_variants WHERE meal_plan_id = $1`, [a.id])
      expect(variants[0].n).toBe(1)
      const { rows: meals } = await pool.query(
        `SELECT count(*)::int AS n FROM meal_plan_meals m
           JOIN meal_plan_variants v ON v.id = m.variant_id WHERE v.meal_plan_id = $1`, [a.id])
      expect(meals[0].n).toBe(2)
    })

    it('will not restructure another user\'s plan', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      expect(await repo.replaceMealPlanStructure(a.id, USER_B, restructure(2, ['X', 'Y']))).toBeNull()
      const after = await repo.getMealPlan(a.id, USER_A)
      expect(after!.variants[0].meals).toHaveLength(3)
      expect(after!.mealsPerDay).toBe(3)
    })
  })

  describe('soft delete', () => {
    it('tombstones rather than removing the row, so the delete can sync', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      await repo.deleteMealPlan(a.id, USER_A)
      expect(await repo.getMealPlan(a.id, USER_A)).toBeNull()
      const { rows } = await pool.query(
        `SELECT deleted_at FROM meal_plans WHERE id = $1`, [a.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).not.toBeNull()
    })

    it('is idempotent — deleting twice reports the second as a no-op', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      expect(await repo.deleteMealPlan(a.id, USER_A)).toBe(true)
      expect(await repo.deleteMealPlan(a.id, USER_A)).toBe(false)
    })
  })

  describe('dietary restrictions', () => {
    it('exposes the seeded catalogue with synonyms for search', async () => {
      const all = await repo.listDietaryRestrictions()
      expect(all.length).toBeGreaterThan(10)
      const dairy = all.find(r => r.code === 'milk')
      expect(dairy?.category).toBe('allergen')
      expect(dairy?.synonyms).toContain('lactose')
    })

    it('replaces the user\'s set and keeps severity', async () => {
      const all = await repo.listDietaryRestrictions()
      const peanut = all.find(r => r.code === 'peanut')!
      const vegetarian = all.find(r => r.code === 'vegetarian')!

      let mine = await repo.replaceUserDietaryRestrictions(USER_A, [
        { restrictionId: peanut.id, severity: 'allergy' },
        { restrictionId: vegetarian.id, severity: 'avoid' },
      ])
      expect(mine.map(r => r.code).sort()).toEqual(['peanut', 'vegetarian'])
      expect(mine.find(r => r.code === 'peanut')?.severity).toBe('allergy')

      mine = await repo.replaceUserDietaryRestrictions(USER_A, [{ restrictionId: peanut.id, severity: 'avoid' }])
      expect(mine).toHaveLength(1)
      expect(mine[0].severity).toBe('avoid')

      expect(await repo.replaceUserDietaryRestrictions(USER_A, [])).toHaveLength(0)
    })

    it('drops an unknown restriction id instead of raising a foreign-key 500', async () => {
      const mine = await repo.replaceUserDietaryRestrictions(USER_A, [
        { restrictionId: '99999999-9999-4999-8999-999999999999', severity: 'avoid' },
      ])
      expect(mine).toHaveLength(0)
    })

    it('keeps one user\'s restrictions out of another\'s', async () => {
      const all = await repo.listDietaryRestrictions()
      await repo.replaceUserDietaryRestrictions(USER_A, [{ restrictionId: all[0].id, severity: 'avoid' }])
      expect(await repo.listUserDietaryRestrictions(USER_B)).toHaveLength(0)
    })

    it('survives deleting the plan — restrictions belong to the person, not the plan', async () => {
      const all = await repo.listDietaryRestrictions()
      await repo.replaceUserDietaryRestrictions(USER_A, [{ restrictionId: all[0].id, severity: 'allergy' }])
      const a = await repo.createMealPlan(USER_A, planInput('A'))
      await repo.deleteMealPlan(a.id, USER_A)
      expect(await repo.listUserDietaryRestrictions(USER_A)).toHaveLength(1)
    })
  })

  describe('review window', () => {
    it('reports no review needed for a freshly generated plan', async () => {
      await repo.createMealPlan(USER_A, planInput('Fresh', true))
      expect(await repo.mealPlanNeedsReview(USER_A, 28)).toBe(false)
    })

    it('reports a review once the active plan passes the window', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('Old', true))
      await pool.query(`UPDATE meal_plans SET generated_at = now() - interval '30 days' WHERE id = $1`, [a.id])
      expect(await repo.mealPlanNeedsReview(USER_A, 28)).toBe(true)

      await repo.markMealPlanReviewed(a.id, USER_A)
      expect(await repo.mealPlanNeedsReview(USER_A, 28)).toBe(false)
    })

    it('ignores inactive and deleted plans', async () => {
      const a = await repo.createMealPlan(USER_A, planInput('Inactive'))
      await pool.query(`UPDATE meal_plans SET generated_at = now() - interval '99 days' WHERE id = $1`, [a.id])
      expect(await repo.mealPlanNeedsReview(USER_A, 28)).toBe(false)
    })
  })
})
