import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A planned meal becomes an ordinary saved meal, once (Q-398).
 *
 * The owner's framing is that a meal plan is a batch generator rather than somewhere to live: it
 * gets built and then mostly not opened again. What should outlive it are saved meals, which
 * already log in one tap and print a label with a QR.
 *
 * **The assertions are on the copied ROWS, not on a toast.** Every button here reports success
 * before its write resolves (the feedback-first rule), so a control wired to nothing produces
 * exactly the same screen. What only passes when the copy really happened is a `saved_meals` row
 * whose items carry the plan's per-100g numbers at the plan's weight.
 *
 * **And idempotence is asserted by pressing save twice**, which is the whole reason the copy stamps
 * `meal_plan_meals.saved_meal_id`. Counting rows after ONE save would pass against a version that
 * duplicates on the second.
 *
 * Not exercised here: the device path. The browser has no native SQLite, so `getLocalStore` returns
 * null and this runs the web fallback — the local-store mirror and the outbox mutation are owed an
 * on-device check.
 */

const PLAN_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e'
const VARIANT_ID = '8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f'
const MEAL_A = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a'
const MEAL_B = '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b'
const NAME_A = 'Spec Plan Breakfast'
const NAME_B = 'Spec Plan Dinner'
// 250 g at 120 kcal/100 g — deliberately not a round multiple, so a copy that confused the
// per-100g density with the portion's own totals cannot coincide with this.
//
// The macros have to ADD UP to those calories: `createFoodItem` runs `sanitiseNutrition`, which
// recomputes calories from the macros once they disagree by more than 40%. That is correct — the
// copy should not carry an implausible number through — but it means a fixture with decorative
// macros asserts against the sanitiser rather than against the copy. 4.5P + 20C + 2F is 116 kcal.
const ING = { name: 'Spec Rolled Oats', weightG: 250, caloriesPer100g: 120, proteinPer100g: 4.5, carbsPer100g: 20, fatPer100g: 2 }

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query(
    `DELETE FROM saved_meals WHERE id IN (
       SELECT sm.id FROM saved_meals sm WHERE sm.name = ANY($1)
     )`,
    [[NAME_A, NAME_B]],
  )
  await db.query('DELETE FROM food_items WHERE name = $1', [ING.name])
  await db.query('DELETE FROM meal_plans WHERE id = $1', [PLAN_ID])
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)
    // Only one active plan per user is allowed, so anything the seed or another spec left active
    // has to stand down or the insert below violates the partial unique index.
    await db.query('UPDATE meal_plans SET is_active = false WHERE user_id = $1', [userId])

    await db.query(
      `INSERT INTO meal_plans (id, user_id, name, is_active, meals_per_day,
                               target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'Spec Plan', true, 2, 2000, 150, 200, 60)`,
      [PLAN_ID, userId],
    )
    await db.query(
      `INSERT INTO meal_plan_variants (id, meal_plan_id, day_type,
                                       target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'all', 2000, 150, 200, 60)`,
      [VARIANT_ID, PLAN_ID],
    )
    for (const [id, name, position] of [[MEAL_A, NAME_A, 0], [MEAL_B, NAME_B, 1]] as const) {
      await db.query(
        `INSERT INTO meal_plan_meals (id, variant_id, position, name,
                                      target_calories, target_protein_g, target_carbs_g, target_fat_g, ingredients)
         VALUES ($1, $2, $3, $4, 300, 20, 40, 10, $5::jsonb)`,
        [id, VARIANT_ID, position, name, JSON.stringify([ING])],
      )
    }
  })
})

test.afterAll(async () => { await withDb(cleanup) })

/** The saved meal of that name, with its one item resolved through `food_items`. */
async function savedCopies(name: string) {
  return withDb(async db => {
    const { rows } = await db.query<{
      meal_id: string; servings: number; quantity_multiplier: number
      serving_size_g: number; calories: number; protein_g: number
    }>(
      `SELECT sm.id AS meal_id, sm.servings, smi.quantity_multiplier,
              fi.serving_size_g, fi.calories, fi.protein_g
         FROM saved_meals sm
         JOIN saved_meal_items smi ON smi.saved_meal_id = sm.id
         JOIN food_items fi ON fi.id = smi.food_item_id
        WHERE sm.name = $1`,
      [name],
    )
    return rows
  })
}

const stampOf = (mealId: string) => withDb(async db => {
  const { rows } = await db.query<{ saved_meal_id: string | null }>(
    'SELECT saved_meal_id FROM meal_plan_meals WHERE id = $1', [mealId],
  )
  return rows[0]?.saved_meal_id ?? null
})

/**
 * A real CDP touch sequence, aimed at the middle of the viewport.
 *
 * `.click()` dispatches a mouse-only sequence that never produces a `click` event on these screens
 * (Q-354). And `scrollIntoViewIfNeeded()` is not enough on its own here: it stops as soon as the box
 * is technically on screen, which for a control near the end of a long page leaves it **under the
 * fixed bottom nav** — the first run of this spec tapped "Show 2 meals" and landed on the Workout
 * tab. `block: 'center'` puts it where a thumb would actually reach it.
 */
async function tap(page: Page, name: RegExp | string) {
  const target = page.getByRole('button', { name })
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function openPlanMeals(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Retried: a tap fired before React has attached the handler does nothing, silently. Re-tapping
  // toggles the list shut again, but the check runs after every tap, so it converges on open.
  await expect(async () => {
    await tap(page, /^Show 2 meals$/)
    await expect(page.getByText(NAME_A)).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
}

test('saving one planned meal copies it into My Meals at the planned weight', async ({ page }) => {
  await openPlanMeals(page)
  await tap(page, `Save ${NAME_A} to My Meals`)

  await expect.poll(() => savedCopies(NAME_A), { timeout: 20_000 }).toHaveLength(1)
  const [item] = await savedCopies(NAME_A)
  // 250 g of a food stored per 100 g. The multiplier carries the weight so the library gains
  // "Spec Rolled Oats", a thing that can be logged again at any weight — not a 250 g one-off.
  expect(item.serving_size_g).toBe(100)
  expect(item.calories).toBe(ING.caloriesPer100g)
  expect(item.protein_g).toBeCloseTo(ING.proteinPer100g, 1)
  expect(item.quantity_multiplier).toBeCloseTo(ING.weightG / 100, 2)
  expect(Number(item.servings)).toBe(1)

  // The stamp is what makes a second save a no-op, so it is asserted directly rather than inferred
  // from the button's state.
  await expect.poll(() => stampOf(MEAL_A), { timeout: 20_000 }).toBe(item.meal_id)
})

test('a saved meal reads as kept, and saving the rest never duplicates it', async ({ page }) => {
  await openPlanMeals(page)
  // Kept meals show a state, not a disabled button — and the offer is gone.
  await expect(page.getByText('In My Meals')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: `Save ${NAME_A} to My Meals` })).toHaveCount(0)

  // "Save all" counts only what is left, which is the property that stops a second press
  // re-copying the first meal.
  await tap(page, /^Save all 1 to My Meals$/)

  await expect.poll(() => savedCopies(NAME_B), { timeout: 20_000 }).toHaveLength(1)
  expect(await savedCopies(NAME_A), 'the already-saved meal must not be copied again').toHaveLength(1)
  await expect.poll(() => stampOf(MEAL_B), { timeout: 20_000 }).not.toBeNull()
})

test('the copy is tagged in My Meals as coming from the plan', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, /^Saved Meals$/)
    await expect(page.getByText(NAME_A)).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })

  // Provenance is derived from `meal_plan_meals.saved_meal_id` rather than stored on the meal — a
  // `from_plan` column would be a second copy of a fact the schema already holds. A word, not a
  // coloured dot, so it survives the colour-only-state rule.
  await expect(page.getByText('From plan').first()).toBeVisible()
})
