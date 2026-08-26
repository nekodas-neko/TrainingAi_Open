import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'

/**
 * A saved meal's own screen (BF-30 — artboard 4).
 *
 * **The assertion that matters is the one about scope.** The headline figure and the macro columns
 * are one **portion** — what `Log this meal` writes — while the ingredient list is the **whole
 * batch**, because that is the recipe you cook and a recipe showing half an egg is useless. Artboard
 * 4 draws exactly that split and labels both halves. The fixture is built so the two cannot be
 * confused: a two-portion meal of 200 kcal oats + 120 kcal whey, so the headline must read **160**
 * while the rows beneath it read **200** and **120**. Any implementation that picks one scope for
 * the whole screen fails on one number or the other.
 */

const MEAL_ID = 'bf30bf30-bf30-4bf3-8bf3-bf30bf30bf30'
const FOOD_A = 'bf30bf30-bf30-4bf3-8bf3-aaaaaaaaaaaa'
const FOOD_B = 'bf30bf30-bf30-4bf3-8bf3-bbbbbbbbbbbb'
const MEAL_NAME = 'BF30 Detail Batch'

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
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [[FOOD_A, FOOD_B]])
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $3, 'BF30 Oats', 200, 8, 34, 4, 60, 'manual'),
              ($2, $3, 'BF30 Whey', 120, 24, 3, 2, 30, 'manual')`,
      [FOOD_A, FOOD_B, userId],
    )
    await db.query(`INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 2)`,
      [MEAL_ID, userId, MEAL_NAME])
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES (gen_random_uuid(), $1, $2, 1), (gen_random_uuid(), $1, $3, 1)`,
      [MEAL_ID, FOOD_A, FOOD_B],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
    await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [[FOOD_A, FOOD_B]])
  })
})

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openLibrary(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    const box = (await button.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
}

test('a meal opens onto its own screen: per-portion headline, whole-batch ingredients', async ({ page }) => {
  await openLibrary(page)
  await openSavedMeal(page, MEAL_NAME)

  const sheet = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Log this meal' }) })

  await expect(sheet.getByText('Makes 2 portions · 2 ingredients')).toBeVisible()

  // The headline is one portion, and says so.
  await expect(sheet.getByText('160', { exact: true })).toBeVisible()
  await expect(sheet.getByText('per portion')).toBeVisible()

  // The ingredient rows are the batch — the numbers a cook needs — and are labelled as such.
  // Asserted per row rather than as loose text: the calorie cell is the figure plus a small `kcal`,
  // so an exact-text match on "200" finds nothing while the number is plainly on screen.
  await expect(sheet.getByText('whole batch')).toBeVisible()
  for (const [name, weight, kcal] of [['BF30 Oats', '60 g', '200'], ['BF30 Whey', '30 g', '120']]) {
    const row = sheet.locator('div').filter({ hasText: new RegExp(`^${name}${weight}${kcal}kcal$`) }).first()
    await expect(row, `${name} should list its BATCH amount, not a portion of it`).toBeVisible()
  }

  // Macro columns carry percentage, grams and label — all three, per artboard 4. One portion is
  // 16 g P / 18.5 g C / 3 g F, which by the Atwater split is 39% / 45% / 16%.
  for (const [pct, grams, label] of [['39%', '16 g', 'Protein'], ['45%', '18.5 g', 'Carbs'], ['16%', '3 g', 'Fat']]) {
    await expect(sheet.getByText(pct, { exact: true })).toBeVisible()
    await expect(sheet.getByText(grams, { exact: true })).toBeVisible()
    await expect(sheet.getByText(label, { exact: true })).toBeVisible()
  }
})

test('the swipe tray never deletes outright — it lands on the confirmation inside the meal', async ({ page }) => {
  await openLibrary(page)
  const row = page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) }).first()
  await expect(row).toBeVisible()

  const box = (await row.boundingBox())!
  const y = box.y + box.height / 2
  const startX = box.x + box.width - 16
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] })
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX - 20 * step, y }] })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }

  const trayDelete = page.getByRole('button', { name: `Delete ${MEAL_NAME}` })
  await expect(trayDelete).toBeVisible({ timeout: 10_000 })
  await trayDelete.tap()

  // It opens the meal, with the confirmation already up — you see what you are about to delete.
  await expect(page.getByText(`Delete “${MEAL_NAME}”?`)).toBeVisible()
  const stillThere = await withDb(async db =>
    (await db.query('SELECT 1 FROM saved_meals WHERE id = $1', [MEAL_ID])).rowCount)
  expect(stillThere, 'a drag deleted the meal with no confirmation').toBe(1)
})
