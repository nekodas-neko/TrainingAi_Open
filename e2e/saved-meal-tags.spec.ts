import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'

/**
 * Tagging a saved meal with the slots a meal plan may use it in (BF-11f).
 *
 * BF-11e shipped the column, the join table, the route field and the outbox replay, and shipped
 * **no way to set any of it** — this is the last link. The round-trip below is the whole point:
 * a chip tapped in the builder has to reach `saved_meal_meal_types`, and reopening the meal has to
 * show it ticked. Either half alone passes while the feature is broken.
 *
 * Runs the WEB write path — `getLocalStore` returns null outside the APK — so it covers the route
 * and the read-back. The device half (local upsert + outbox payload) is covered by
 * `components/nutrition/__tests__/save-meal-tags.test.ts`, which is where those two calls live.
 */

const MEAL_ID = 'bf11f000-bf11-4f00-8f00-bf11fbf11f00'
const FOOD_ID = 'bf11f000-bf11-4f00-8f00-aaaaaaaaaaaa'
const MEAL_NAME = 'BF11F Tagged Dish'
const TAG = 'Dinner'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM saved_meal_meal_types WHERE saved_meal_id = $1', [MEAL_ID])
  await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [FOOD_ID])
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, 'BF11F Rice', 200, 4, 44, 1, 100, 'manual')`, [FOOD_ID, userId])
    await db.query('INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 1)',
      [MEAL_ID, userId, MEAL_NAME])
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES (gen_random_uuid(), $1, $2, 1)`, [MEAL_ID, FOOD_ID])
  })
})

test.afterAll(async () => { await withDb(cleanup) })

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openBuilder(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still CLOSED — this button opens Log Food, which then covers the
    // coordinate, so an unconditional re-tap lands on the sheet's own content (Q-395c).
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await openSavedMeal(page, MEAL_NAME)
  await page.getByRole('button', { name: `Edit ${MEAL_NAME}` }).tap()
  await expect(page.getByRole('button', { name: /^(Update|Save) Meal$/ })).toBeVisible({ timeout: 15_000 })
}

test('a tag tapped in the builder reaches the database and comes back ticked', async ({ page }) => {
  await openBuilder(page)

  const chip = page.getByRole('button', { name: TAG, exact: true })
  await expect(chip).toBeVisible()
  // Untagged is eligible for EVERY slot, so nothing starts pressed and the hint has to say so —
  // chips with none ticked otherwise read as "excluded from everything", which is the inverse.
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/can use this at any meal/i)).toBeVisible()

  await chip.tap()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/only put this in the meals you picked/i)).toBeVisible()

  await page.getByRole('button', { name: /^(Update|Save) Meal$/ }).tap()

  await expect(async () => {
    const stored = await withDb(db => db.query<{ name: string }>(
      `SELECT mt.name FROM saved_meal_meal_types t
         JOIN meal_types mt ON mt.id = t.meal_type_id
        WHERE t.saved_meal_id = $1`, [MEAL_ID]))
    expect(stored.rows.map(r => r.name)).toEqual([TAG])
  }).toPass({ timeout: 20_000 })

  // Reopening is the half a write-only test cannot see: the builder has to SEED from the stored
  // tags, or the next save silently sends an empty list and clears what was just written.
  await openBuilder(page)
  await expect(page.getByRole('button', { name: TAG, exact: true })).toHaveAttribute('aria-pressed', 'true')
})
