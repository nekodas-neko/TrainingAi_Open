import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * Q-389 — the printable saved-meal label.
 *
 * **What this guards, and what it deliberately does not.** The figures-agree-with-the-write-path
 * assertion — the one real bug this feature could ship — is a unit test
 * (`packages/shared/src/nutrition/__tests__/label-payload.test.ts`), because it is arithmetic and
 * belongs where it can be asserted precisely. This spec guards the half a unit test cannot reach:
 * that the sheet opens, that the canvas is actually *drawn on* rather than left blank, and that
 * every style renders. A canvas that silently fails to paint is the failure mode here — the label
 * is generated at print time, so a blank one is discovered on paper.
 *
 * **Mutation-checked**: replacing `renderMealLabel`'s body with a no-op leaves the canvas blank and
 * the "is it painted" assertion fails. Asserting only that the sheet opens would pass in that case,
 * which is why the pixel check exists.
 *
 * The seed has no saved meals (`saved_meals` is empty after `pnpm db:local`), so the spec creates
 * one directly and removes it afterwards — the same shape as `zero-data.setup.ts`, and for the same
 * reason: `setup.sh` will not re-seed a database that already has users.
 */
test.setTimeout(180_000)

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'
const MEAL_NAME = 'E2E Label Meal'

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: DB })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

test.beforeAll(async () => {
  await withDb(async c => {
    const { rows } = await c.query('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    if (!userId) throw new Error(`seed user ${SEED_EMAIL} missing — run pnpm db:local`)

    await c.query('DELETE FROM saved_meals WHERE user_id = $1 AND name = $2', [userId, MEAL_NAME])

    // servings = 2 on purpose: it is the case where printing `totals` directly would show double
    // what scanning the label logs, so the rendered label is drawn from the interesting branch.
    const meal = await c.query(
      'INSERT INTO saved_meals (user_id, name, servings) VALUES ($1, $2, 2) RETURNING id',
      [userId, MEAL_NAME],
    )
    const food = await c.query(
      `INSERT INTO food_items (user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, 'E2E Label Whey', 30, 120, 25, 2, 1, 'manual') RETURNING id`,
      [userId],
    )
    await c.query(
      'INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, 2)',
      [meal.rows[0].id, food.rows[0].id],
    )
  })
})

test.afterAll(async () => {
  await withDb(async c => {
    await c.query('DELETE FROM saved_meals WHERE name = $1', [MEAL_NAME])
    await c.query(`DELETE FROM food_items WHERE name = 'E2E Label Whey'`)
  })
})

test('a saved meal renders a printable label in every style', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // The nutrition screen opens the saved-meals sheet directly; going via the food logger would
  // test that route rather than this one.
  //
  // `touchscreen.tap()`, not `.click()`, and this spec found out the hard way: `.click()` on this
  // screen's action row silently does nothing. That is Q-354 — the date-swipe `useDrag` binding
  // swallows MOUSE clicks here while touch is unaffected — and `water-log-write-path.spec.ts`
  // carries the full measurement. Touch is the only input the supported runtime produces anyway, so
  // tapping is both the fix and the more faithful test.
  const savedMeals = page.getByRole('button', { name: 'Saved Meals', exact: true })
  await expect(savedMeals).toBeVisible({ timeout: 60_000 })

  // Retried: a tap fired before React has attached the handler does nothing, silently. Opening the
  // sheet is idempotent, so a retry cannot toggle it shut.
  const labelButton = page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })
  await expect(async () => {
    const box = (await savedMeals.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(labelButton).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await labelButton.tap()

  const canvas = page.getByRole('img', { name: `Printable label for ${MEAL_NAME}` })
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  // The sheet reports the code's physical size, which is the number the whole print risk is about.
  await expect(page.getByText(/mm at 25×25 modules/), `console: ${errors.join(' | ')}`).toBeVisible()

  /** Is the canvas actually painted? A blank one is white everywhere; a drawn label has ink. */
  const inkFraction = async () => canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, el.width, el.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark++
    return dark / (data.length / 4)
  })

  // Every style must paint. Black band is the default and is checked first because it is also the
  // one whose code is tightest, so a regression there matters most.
  for (const style of ['Black band', 'Editorial', 'Deli ticket', 'Plaque']) {
    await page.getByRole('radio', { name: new RegExp(style, 'i') }).click()
    await expect
      .poll(inkFraction, { message: `${style} should paint ink onto the canvas`, timeout: 20_000 })
      .toBeGreaterThan(0.01)
  }
})
