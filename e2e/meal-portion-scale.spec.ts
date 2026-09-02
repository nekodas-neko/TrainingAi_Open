import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, tapCentre } from './fixtures'

/**
 * BF-104 — logging a saved meal at ½× / 1× / 1½×.
 *
 * The owner: *"when logging food/meals we should be able to choose how much of the meal."* LB-49 put
 * the argument through `logMealItems`; this drives the surface that sets it.
 *
 * **Two claims here need a browser and cannot be source-scanned.** The picker has to change the
 * figures the sheet is showing — the sheet's own note says those are "per portion — that is what
 * `Log this meal` writes", so a figure that stayed at one portion would make the button lie. And the
 * write has to land at the chosen multiple, which is only visible in what the day then holds.
 */

const MEAL = '66666666-6666-4666-8666-6666666666b1'
const ITEM = '77777777-7777-4777-8777-7777777777b1'
const MEAL_ITEM = '88888888-8888-4888-8888-8888888888b1'
/** 400 kcal in one portion, so ½× is 200 and 1½× is 600 — three figures nothing else rounds to. */
const KCAL = 400

test.setTimeout(180_000)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client, uid: string): Promise<void> {
  await db.query('DELETE FROM food_logs WHERE user_id = $1 AND food_item_id = $2', [uid, ITEM])
  await db.query('DELETE FROM saved_meal_items WHERE id = $1', [MEAL_ITEM])
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL])
  await db.query('DELETE FROM food_items WHERE id = $1', [ITEM])
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    const uid = rows[0].id
    await cleanup(db, uid)
    await db.query(
      `INSERT INTO food_items (id, user_id, name, source, calories, protein_g, carbs_g, fat_g)
       VALUES ($1, $2, 'BF-104 fixture food', 'manual', $3, 40, 40, 8)`, [ITEM, uid, KCAL])
    await db.query(
      `INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, 'BF-104 portion fixture', 1)`,
      [MEAL, uid])
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, $3, 1)`, [MEAL_ITEM, MEAL, ITEM])
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    if (rows[0]?.id) await cleanup(db, rows[0].id)
  })
})

/** Opens Nutrition → My Foods → the fixture meal's detail sheet. */
async function openMealDetail(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // A real touch throughout: the Nutrition screen's date-swipe `useDrag` binds mouse and pointer and
  // swallows a click, so `.click()` silently does nothing here (Q-354).
  await tapCentre(page, page.getByRole('button', { name: /My Foods/i }).first())
  await tapCentre(page, page.getByText('BF-104 portion fixture').first())
  await expect(page.getByRole('button', { name: 'Log this meal' })).toBeVisible({ timeout: 30_000 })
}

/** The headline calorie figure — the largest number on the detail sheet. */
async function headlineKcal(page: Page): Promise<number> {
  const text = await page.locator('p.text-4xl').first().innerText()
  return Number(text.replace(/[^\d]/g, ''))
}

test('the picker changes the figures the sheet is showing', async ({ page }) => {
  await openMealDetail(page)

  expect(await headlineKcal(page), 'opens on a whole portion').toBe(KCAL)
  // `exact`, because the library sheet's own footnote also contains the phrase ("Meal calories
  // are per portion…") and a loose match resolves to two elements.
  await expect(page.getByText('per portion', { exact: true })).toBeVisible()

  // `exact`, or `½×` also matches `1½×` — the substring is the whole label of the other tab.
  await tapCentre(page, page.getByRole('tab', { name: '½×', exact: true }))
  await expect.poll(() => headlineKcal(page), { timeout: 15_000 }).toBe(KCAL / 2)
  // The label has to move with the number, or the sheet says "per portion" over half of one.
  await expect(page.getByText('½× portion', { exact: true })).toBeVisible()

  await tapCentre(page, page.getByRole('tab', { name: '1½×' }))
  await expect.poll(() => headlineKcal(page), { timeout: 15_000 }).toBe(KCAL * 1.5)
  await expect(page.getByText('1½× portion')).toBeVisible()
})

test('logging at 1½× writes 1.5 portions, not one', async ({ page }) => {
  await openMealDetail(page)
  await tapCentre(page, page.getByRole('tab', { name: '1½×' }))
  await expect.poll(() => headlineKcal(page), { timeout: 15_000 }).toBe(KCAL * 1.5)

  await tapCentre(page, page.getByRole('button', { name: 'Log this meal' }))

  // The database is the assertion, not the toast: the multiplier is what every reader of the day
  // divides by, and a UI that said "logged" while writing 1 would look identical.
  await expect.poll(async () => withDb(async db => {
    const { rows } = await db.query<{ q: string }>(
      `SELECT quantity_multiplier AS q FROM food_logs WHERE food_item_id = $1 AND deleted_at IS NULL`, [ITEM])
    return rows.map(r => Number(r.q))
  }), { timeout: 30_000 }).toEqual([1.5])
})
