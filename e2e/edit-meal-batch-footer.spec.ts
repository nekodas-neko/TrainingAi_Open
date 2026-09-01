import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'

/**
 * The meal builder keeps its numbers on screen while you edit (BF-31 — artboard 5).
 *
 * **The footer is what this entry is about.** The batch total, the macro split and the per-portion
 * figure were already computed live — and sat in a card partway down the scroll, so the moment you
 * were editing the thing that changed them they were off screen. That is the whole reason to have a
 * screen here rather than a list, and it is why the assertion below **scrolls the ingredient list
 * to the bottom first**: a test that reads the numbers on a short list proves nothing, because a
 * card in the flow would pass it too.
 */

const MEAL_ID = 'bf31bf31-bf31-4bf3-8bf3-bf31bf31bf31'
const FOODS = [
  ['bf31bf31-bf31-4bf3-8bf3-aaaaaaaaaaaa', 'BF31 Whey', 230, 46, 3, 2],
  ['bf31bf31-bf31-4bf3-8bf3-bbbbbbbbbbbb', 'BF31 Milk', 186, 10, 15, 10],
  ['bf31bf31-bf31-4bf3-8bf3-cccccccccccc', 'BF31 Banana', 107, 1, 27, 0],
  ['bf31bf31-bf31-4bf3-8bf3-dddddddddddd', 'BF31 Cocoa', 20, 2, 2, 1],
  ['bf31bf31-bf31-4bf3-8bf3-eeeeeeeeeeee', 'BF31 Vanilla', 12, 0, 1, 0],
] as const
const MEAL_NAME = 'BF31 Batch Recipe'
// 555 kcal, 59 P, 48 C, 13 F for the batch; 2 portions → 278 each.
const BATCH_KCAL = FOODS.reduce((a, f) => a + f[2], 0)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
    await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [FOODS.map(f => f[0])])
    for (const [id, name, kcal, p, c, f] of FOODS) {
      await db.query(
        `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 60, 'manual')`, [id, userId, name, kcal, p, c, f])
    }
    await db.query(`INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 2)`,
      [MEAL_ID, userId, MEAL_NAME])
    for (const [id] of FOODS) {
      await db.query(
        `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
         VALUES (gen_random_uuid(), $1, $2, 1)`, [MEAL_ID, id])
    }
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
    await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [FOODS.map(f => f[0])])
  })
})

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openBuilder(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which then
    // covers the coordinate, so an unconditional re-tap lands on the sheet's own content and the
    // retry makes things worse rather than better (it cost `meal-label` two runs).
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

test('the batch figures stay on screen while the ingredients are scrolled', async ({ page }) => {
  await openBuilder(page)

  const footer = page.getByText('Batch', { exact: true })
  await expect(footer).toBeVisible()
  await expect(footer).toBeInViewport()

  // Scroll the ingredient list to its end — where a card in the flow would have gone off screen.
  await page.getByText('BF31 Vanilla').first().scrollIntoViewIfNeeded()
  await expect(footer, 'the batch line scrolled away with the list').toBeInViewport()
  await expect(page.getByRole('button', { name: /^(Update|Save) Meal$/ })).toBeInViewport()

  // The numbers themselves: the batch total, and the per-portion figure beside it.
  await expect(page.getByText(`${BATCH_KCAL} kcal`)).toBeVisible()
  await expect(page.getByText(`${Math.round(BATCH_KCAL / 2)} / portion`)).toBeVisible()

  // The macro split carries its letters, and each is coloured from MACRO_COLORS rather than
  // relying on colour alone (the split without the letters would be the colour-only violation).
  for (const letter of ['P', 'C', 'F']) {
    await expect(page.getByText(new RegExp(`^\\d+ ${letter}$`))).toBeVisible()
  }
})

test('the name is edited in place, from the header', async ({ page }) => {
  await openBuilder(page)

  // No standalone "Meal name" field any more — the pencil beside the title is the whole affordance.
  await expect(page.getByText('Meal name', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: `Rename ${MEAL_NAME}` }).tap()
  const field = page.getByRole('textbox', { name: 'Meal name' })
  await expect(field).toBeVisible()
  await field.fill(`${MEAL_NAME} v2`)
  await field.press('Enter')

  await expect(page.getByRole('button', { name: `Rename ${MEAL_NAME} v2` })).toBeVisible()
})
