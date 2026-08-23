import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A recipe URL becomes a meal, and a recipe with no stated yield is asked about (Q-409).
 *
 * The route half shipped in PR #180 — the `https:`-only guard, the SSRF checks, the JSON-LD parse
 * and the divide when a page states `recipeYield`. This is the other half: the picker sends a `url`
 * and handles what comes back.
 *
 * **`recipeYield: null` is the case that matters and it is not cosmetic.** With a stated yield the
 * route has already divided. Without one the payload is the WHOLE recipe — a banana-bread page
 * measured 1,956 kcal for the loaf — so keeping it as a meal is a multi-hundred-calorie error that
 * reads as perfectly plausible. The entry's rule is *ask, do not assume 1*, and this asserts that
 * the ask happens, that nothing can be kept before it is answered, and that the answer divides.
 *
 * **The scan route is stubbed, deliberately.** What is being tested is the picker's handling of a
 * payload shape, and the alternative is a live fetch of somebody's recipe site from CI — which would
 * be slow, flaky and rude. That means this proves nothing about the fetch, the SSRF guards or the
 * JSON-LD parse; those are the route's own, tested where they live.
 */

const RECIPE_URL = 'https://example.com/recipes/spec-banana-bread'
const WHOLE_RECIPE_KCAL = 1956

/** The whole loaf: 12 slices' worth of ingredients, with no yield stated anywhere on the page. */
const WHOLE_RECIPE = {
  name: 'Spec Banana Bread',
  ingredients: [
    { name: 'Spec Flour', weightG: 480, caloriesPer100g: 364, proteinPer100g: 10, carbsPer100g: 76, fatPer100g: 1 },
    { name: 'Spec Banana', weightG: 360, caloriesPer100g: 89, proteinPer100g: 1.1, carbsPer100g: 23, fatPer100g: 0.3 },
    { name: 'Spec Butter', weightG: 100, caloriesPer100g: 717, proteinPer100g: 0.9, carbsPer100g: 0.1, fatPer100g: 81 },
  ],
  sourceUrl: RECIPE_URL,
  recipeYield: null,
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  // The wizard is only offered when there is no active plan, and other specs leave one behind.
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await db.query('UPDATE meal_plans SET is_active = false WHERE user_id = $1', [rows[0].id])
  })
})

/**
 * A real CDP touch sequence, aimed at the middle of the viewport — `.click()` never produces a
 * `click` event on the nutrition screen (Q-354), and a control merely scrolled into view can still
 * sit under the fixed bottom nav.
 */
async function tap(page: Page, name: RegExp | string) {
  const target = page.getByRole('button', { name }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

/** Calories the row currently reports, read off its own totals line. */
async function rowKcal(page: Page): Promise<number> {
  const text = await page.getByText(/kcal · .*estimated/).first().innerText()
  return Number(text.split('kcal')[0].replace(/[^\d]/g, ''))
}

test('a recipe link with no stated yield asks how many it serves before it can be kept', async ({ page }) => {
  await page.route('**/api/nutrition/scan', async route => {
    const body = route.request().postDataJSON() as { url?: string }
    // Proves the picker sent the URL as a `url`, not as free text — the whole point of the mode.
    expect(body.url, 'a recipe link must be sent as `url`').toBe(RECIPE_URL)
    await route.fulfill({ json: { ...WHOLE_RECIPE, calories: WHOLE_RECIPE_KCAL } })
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, /^Build a meal plan/)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })

  // Four steps of preferences before "Meals you already eat"; none of them blocks Next.
  const dialog = page.getByRole('dialog')
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  const input = dialog.getByLabel('Meals you usually eat')
  await expect(input).toBeVisible({ timeout: 15_000 })

  await input.fill(RECIPE_URL)
  await input.press('Enter')

  // Attribution, and the ask. Neither is optional: the numbers on screen are the whole loaf.
  await expect(dialog.getByText('example.com')).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByText(/How many does it serve\?/)).toBeVisible()
  const whole = await rowKcal(page)
  expect(whole, 'the row shows the whole recipe until the question is answered').toBeGreaterThan(1500)

  // And it cannot be kept in that state — keeping it would put a loaf in one meal slot.
  //
  // By the button's REAL accessible name, which comes from the `<label>` wrapping it rather than
  // from the word on its face. Asserting `/^Keep$/` was absent passed here and would have passed
  // just as happily with the control on screen, which is no guard at all.
  const keep = dialog.getByRole('button', { name: 'Keep this meal exactly' })
  await expect(keep).toHaveCount(0)

  await dialog.getByRole('button', { name: '12', exact: true }).click()

  await expect.poll(() => rowKcal(page), { timeout: 10_000 }).toBeLessThan(whole / 8)
  await expect(dialog.getByText(/from a 12-serve recipe/)).toBeVisible()
  // Offered, and already on: answering the question is the act of accepting the meal, so making the
  // user press Keep separately would be asking twice for one decision.
  await expect(keep).toBeVisible()
  await expect(keep).toHaveAttribute('aria-pressed', 'true')
})

test('a recipe that states its yield is not divided a second time', async ({ page }) => {
  // What the route sends when the page DID state a yield: already per-serving, with the yield
  // reported so the UI can say where the number came from. Dividing again is the plausible bug — it
  // would look like a light meal rather than an error.
  const PER_SERVING = WHOLE_RECIPE.ingredients.map(i => ({ ...i, weightG: i.weightG / 4 }))
  await page.route('**/api/nutrition/scan', route => route.fulfill({
    json: { ...WHOLE_RECIPE, ingredients: PER_SERVING, recipeYield: 4 },
  }))

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, /^Build a meal plan/)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })

  const dialog = page.getByRole('dialog')
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  const input = dialog.getByLabel('Meals you usually eat')
  await expect(input).toBeVisible({ timeout: 15_000 })
  await input.fill(RECIPE_URL)
  await input.press('Enter')

  await expect(dialog.getByText(/from a 4-serve recipe/)).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByText(/How many does it serve\?/), 'the yield was stated — nothing to ask')
    .toHaveCount(0)

  // A quarter of the loaf, not a sixteenth.
  const kcal = await rowKcal(page)
  expect(kcal).toBeGreaterThan(600)
  expect(kcal).toBeLessThan(750)
  await expect(dialog.getByRole('button', { name: 'Keep this meal exactly' })).toBeVisible()
})
