import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, stableBox, tapCentre } from './fixtures'

/**
 * The quantity editor's Option A layout, and the ingredient row that stopped saying "serving"
 * (BF-46 ② and ③).
 *
 * ③'s layout was chosen by the owner from three drawings at 412 dp, so the assertions here are the
 * parts of that choice a rendering can be wrong about: the macro names are **spelled out** rather
 * than `P`/`C`/`F`, the calorie total stands alone as its own block, and the srv/g toggle sits
 * beside the stepper rather than in a full-width row of its own — which is the change that frees
 * the width the presets now span.
 *
 * **The toggle's geometry is asserted, not just its presence.** "Beside the stepper" is the whole
 * of the owner's request and it is invisible to a text-only check: the same two buttons in a row
 * above would satisfy every other assertion here.
 *
 * ② is one line: an ingredient row reads `1000 g`, never `8 servings · 1000 g`. The unit logic
 * itself is pinned in `lib/__tests__/saved-meal-qty.test.ts`; what this adds is that the row on
 * screen is actually built from it.
 */

const MEAL_ID = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1'
const FOOD_ID = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'
const MEAL_NAME = 'Spec Quantity Meal'
const FOOD_NAME = 'Spec Quantity Rice'
/** 125 g a serving × 8 servings = 1000 g, which is the figure BF-46 ② quotes. */
const SERVING_G = 125
const QTY = 8

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [FOOD_ID])
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)
    await db.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, $3, $4, 130, 2.7, 28, 0.3, 'manual')`,
      [FOOD_ID, userId, FOOD_NAME, SERVING_G],
    )
    await db.query('INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 2)', [MEAL_ID, userId, MEAL_NAME])
    await db.query(
      'INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, $3)',
      [MEAL_ID, FOOD_ID, QTY],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

/** The dev overlay's `<nextjs-portal>` covers the bottom-left corner and eats coordinate taps. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const paint = () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.head.appendChild(style)
    }
    if (document.head) paint()
    else document.addEventListener('DOMContentLoaded', paint)
  })
})

/** A real touch tap at the element's centre — `.click()` never produces a click on these screens. */
async function tap(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(250)
  await tapCentre(page, target)
}

/**
 * Open the meal builder on the fixture meal, where the ingredient list and its editor live.
 *
 * **Every step retries against its own effect, not blindly.** Three sheets open in sequence here,
 * each covering the control that opened it, so a tap that misses cannot simply be repeated — the
 * button it wanted is gone. Measured: a single-pass version of this passed alone and failed once in
 * three when the file's two tests ran together, which is the shape `meal-photo-picker.spec.ts`
 * already documents on the same list.
 */
async function openBuilder(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const library = page.getByText(MEAL_NAME)
  const editButton = page.getByRole('button', { name: `Edit ${MEAL_NAME}` })
  // The builder's save button, NOT its `Ingredients` heading: the meal's detail sheet stays mounted
  // underneath and has a heading by that name too, so the heading is already visible before Edit is
  // tapped — a marker satisfied by the state it is meant to replace, which is the class of bug this
  // repo keeps re-finding. `Update Meal` exists only in the builder.
  const builder = page.getByRole('button', { name: /^Update Meal$/ })

  const step = async (done: ReturnType<Page['getByText']>, act: () => Promise<void>) => {
    await expect(async () => {
      if (await done.count() === 0) await act()
      await expect(done).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 90_000 })
  }

  await step(library, () => tap(page, page.getByRole('button', { name: /^My Meals$/ })))
  await step(editButton, () => tap(page, page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) }).first()))
  await step(builder, () => tap(page, editButton))
}

test('an ingredient row states its weight and nothing about servings', async ({ page }) => {
  await openBuilder(page)

  const row = page.getByRole('button', { name: new RegExp(`^${FOOD_NAME}`) }).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  const label = (await row.textContent()) ?? ''
  expect(label, 'the row should carry the weight').toContain(`${SERVING_G * QTY} g`)
  expect(label, 'a meal is measured in portions — an ingredient must not also say "serving"').not.toMatch(/serving/i)
})

test('the editor is Option A: named macros, the calories alone, the toggle beside the stepper', async ({ page }) => {
  await openBuilder(page)
  await tap(page, page.getByRole('button', { name: new RegExp(`^${FOOD_NAME}`) }).first())

  const stepper = page.getByRole('spinbutton', { name: new RegExp(`(Grams|Servings) of ${FOOD_NAME}`) })
  await expect(stepper).toBeVisible({ timeout: 20_000 })
  // Scoped to the quantity sheet, not the page: the library, the meal's own screen and the builder
  // are all still mounted underneath it and every one of them says "Protein" somewhere.
  const sheet = stepper.locator('xpath=ancestor::*[@role="dialog"][1]')

  // Spelled out, not P/C/F — a macro identified by colour alone is what the colour-only-state rule
  // forbids, and it is what the drawing replaced.
  for (const name of ['Protein', 'Carbs', 'Fat']) {
    await expect(sheet.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(sheet.getByText('P', { exact: true })).toHaveCount(0)

  // 130 kcal a serving × 8, standing alone under its own label.
  await expect(sheet.getByText(String(130 * QTY), { exact: true })).toBeVisible()
  await expect(sheet.getByText('kcal', { exact: true })).toBeVisible()

  // The geometry the owner actually asked for: the toggle is to the RIGHT of the stepper and
  // vertically overlapping it, not in a row of its own underneath.
  const srv = sheet.getByRole('tab', { name: 'srv' })
  await expect(srv).toBeVisible()
  const stepperBox = await stableBox(stepper)
  const srvBox = await stableBox(srv)
  expect(srvBox.x, 'the toggle sits to the right of the stepper').toBeGreaterThan(stepperBox.x + stepperBox.width)
  expect(srvBox.y, 'and beside it, not below').toBeLessThan(stepperBox.y + stepperBox.height)

  // Every segment still clears the app's 48 dp floor — the reason the stepper block is 96 px tall.
  expect(srvBox.height).toBeGreaterThanOrEqual(48)
  expect((await sheet.getByRole('tab', { name: 'g' }).boundingBox())!.height).toBeGreaterThanOrEqual(48)
})
