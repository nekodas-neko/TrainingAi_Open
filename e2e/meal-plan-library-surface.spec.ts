import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * The meal-plan wizard surfaces the library, and stops dropping pins silently (BF-11h).
 *
 * **The reduction case is the one that needs driving rather than reading.** `MyMealsPicker` caps
 * pins at `mealCount - 1` *while you pick* and nothing re-checks it, so lowering the count
 * afterwards left more pins than slots and the server truncated them. Nothing on any screen showed
 * that — which is exactly why the entry says to verify the regression rather than inspect it.
 */

const MEAL_A = 'Wizard Chicken Bowl'
const MEAL_B = 'Wizard Oat Breakfast'

/**
 * Two known saved meals, mocked per-page.
 *
 * Deterministic beats seed-dependent here: the pin cap is `mealCount - 1`, so the whole reduction
 * case turns on *how many* meals exist to pin. A spec that read whatever the seed happened to hold
 * would pass or skip for reasons unrelated to the code.
 */
async function stubLibrary(page: Page) {
  const food = (n: string, p: number, c: number, f: number) => ({
    id: `f-${n}`, userId: 'u', name: n, servingSizeG: 100,
    calories: p * 4 + c * 4 + f * 9, proteinG: p, carbsG: c, fatG: f, source: 'manual',
  })
  const meal = (id: string, name: string) => ({
    id, userId: 'u', name, servings: 1, imageDataUri: null,
    createdAt: new Date().toISOString(), mealTypeIds: [],
    items: [
      { id: `${id}-1`, savedMealId: id, quantityMultiplier: 1, foodItem: food(`${id} chicken`, 45, 0, 6) },
      { id: `${id}-2`, savedMealId: id, quantityMultiplier: 1, foodItem: food(`${id} rice`, 6, 56, 2) },
    ],
    totals: { calories: 500, proteinG: 51, carbsG: 56, fatG: 8 },
  })
  await page.route('**/api/nutrition/saved-meals', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([meal('wm-a', MEAL_A), meal('wm-b', MEAL_B)]),
    })
  })
}

async function openWizard(page: Page) {
  await stubLibrary(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const trigger = page.getByRole('button', { name: /Build a meal plan/ })
  await expect(trigger).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await trigger.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByText(/Step 1 of 7/)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
}

async function goToStep(page: Page, n: number) {
  for (let i = 1; i < n; i++) {
    await page.getByRole('button', { name: /^(Next|Continue)$/ }).tap()
    await expect(page.getByText(new RegExp(`Step ${i + 1} of 7`))).toBeVisible({ timeout: 10_000 })
  }
}

test('the library toggle is offered, and says something different from the checkboxes', async ({ page }) => {
  await openWizard(page)
  await goToStep(page, 5)   // Yours

  const toggle = page.getByRole('switch', { name: 'Let the plan use my saved meals' })
  await expect(toggle).toBeVisible()
  // Off by default: on changes what every generation returns, so it is the user's call.
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  // The two controls must not read as the same question. Ticking a meal FORCES it in; the toggle
  // lets the planner choose — that distinction is the entry's stated requirement.
  await expect(page.getByText('Always include these')).toBeVisible()
  await toggle.tap()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(/Ticking a meal forces it in/)).toBeVisible()
})

test('lowering the meal count names the pins that no longer fit instead of dropping them', async ({ page }) => {
  await openWizard(page)
  await goToStep(page, 5)   // Yours — pin as many as the cap allows at the default 3 meals

  await page.getByRole('button', { name: new RegExp(MEAL_A) }).tap()
  await page.getByRole('button', { name: new RegExp(MEAL_B) }).tap()

  // Back to Meals and drop to 2, which leaves room for exactly one pin.
  await page.getByRole('button', { name: /^Back$/ }).tap()
  await expect(page.getByText(/Step 4 of 7/)).toBeVisible()
  await page.getByRole('button', { name: '2', exact: true }).tap()

  // The prompt, not a silent truncation.
  await expect(page.getByText(/leaves room for 1 of your own/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Keep 3 meals' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use these' })).toBeVisible()
})

test('cancelling the reduction restores the count it came from', async ({ page }) => {
  await openWizard(page)
  await goToStep(page, 5)
  await page.getByRole('button', { name: new RegExp(MEAL_A) }).tap()
  await page.getByRole('button', { name: new RegExp(MEAL_B) }).tap()

  await page.getByRole('button', { name: /^Back$/ }).tap()
  await page.getByRole('button', { name: '2', exact: true }).tap()
  await page.getByRole('button', { name: 'Keep 3 meals' }).tap()

  // Cancel means the count never changed — 3 is still the selection, and the prompt is gone.
  await expect(page.getByText(/leaves room for 1 of your own/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '3', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
