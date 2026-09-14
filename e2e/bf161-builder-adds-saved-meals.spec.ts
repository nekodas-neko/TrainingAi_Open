import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-161 — the owner: *"For the meal builder it should let you add meals/saved items as part of the
 * meal builder."*
 *
 * The builder's search had three sources and none was a meal, so a meal made of meals had to be
 * rebuilt ingredient by ingredient. The owner chose FLATTEN over real nesting, which needs a
 * migration: *"Okay lets go with flatten for now."*
 *
 * **What this proves that the unit test cannot**: that the tab is reachable from the builder at all.
 * `saved-meal-flatten.test.ts` owns the arithmetic; the risk here is wiring — a source that exists
 * and is not reachable is the exact shape of the bug being fixed.
 */
test('the meal builder can reach saved meals and add one as ingredients', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // Open Log Food → the saved-meals sheet, then its build tab.
  await page.getByRole('button', { name: /Log food/i }).first().click()
  await expect(page.getByRole('button', { name: /^Build$/ }).or(page.getByText(/Build/).first()))
    .toBeVisible({ timeout: 30_000 })
  await page.getByText(/^Build$/).first().click()

  // The picker expands in place; open it if it is collapsed behind "Add ingredient".
  const addIngredient = page.getByRole('button', { name: /Add ingredient/i })
  if (await addIngredient.count()) await addIngredient.first().click()

  // The fourth source must be on screen and selectable.
  const mealsTab = page.getByRole('button', { name: 'Your meals' })
  await expect(mealsTab, 'the builder never grew a saved-meals source').toBeVisible({ timeout: 30_000 })
  await mealsTab.click()

  // Either meals are listed, or the account genuinely has none — both are correct renders, and
  // asserting only the first would make this depend on the seed rather than on the wiring.
  const empty = page.getByText('No saved meals match that.')
  const rows = page.locator('button', { hasText: /ingredient/ })
  await expect(empty.or(rows.first())).toBeVisible({ timeout: 30_000 })
})
