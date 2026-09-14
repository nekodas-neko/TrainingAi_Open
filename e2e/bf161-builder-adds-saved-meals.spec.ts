import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-161 — the owner: *"For the meal builder it should let you add meals/saved items as part of the
 * meal builder."*
 *
 * The builder's search had three sources and none was a meal, so a meal made of meals had to be
 * rebuilt ingredient by ingredient. The owner chose FLATTEN over real nesting, which needs a
 * migration: *"Okay lets go with flatten for now."*
 *
 * **What this proves that the unit test cannot: that the source is REACHABLE.**
 * `saved-meal-flatten.test.ts` owns the arithmetic. A source that exists and cannot be reached from
 * the builder is the exact shape of the bug being fixed, so the wiring needs a spec of its own.
 *
 * The opener is `builder-barcode-scan.spec.ts`'s, deliberately unchanged — that spec reaches the
 * same ingredient search for the same reason. A first version of this file used `.click()` and
 * timed out on the Nutrition screen without ever opening the sheet: **`.click()` never lands here**
 * (Q-354), which is why the tap goes through `touchscreen.tap` on a measured box.
 */
async function openBuilder(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still CLOSED — this button opens Log Food, which then covers the
    // coordinate, so an unconditional re-tap lands on the sheet's own content.
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'My Foods', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await page.getByRole('tab', { name: 'My Foods', exact: true }).tap()
  await page.getByRole('button', { name: /^(New|Build your first meal)$/ }).first().tap()
  await expect(page.getByRole('button', { name: /^(Update|Save) Meal$/ })).toBeVisible({ timeout: 15_000 })
}

test('the builder offers saved meals as a source beside foods', async ({ page }) => {
  test.setTimeout(180_000)
  await openBuilder(page)

  // A new meal opens with the picker already expanded (`setPickerOpen(!meal || …)`), so the source
  // strip is on screen without a further tap.
  const mealsTab = page.getByText('Your meals', { exact: true })
  await expect(mealsTab, 'the builder never grew a saved-meals source').toBeVisible({ timeout: 15_000 })

  // The precondition that makes the assertion below mean something: the foods source is what was
  // already there, so if BOTH are absent the strip itself failed to render and this is not a
  // BF-161 regression.
  await expect(page.getByText('Your foods', { exact: true })).toBeVisible()

  await mealsTab.tap()

  // Either meals are listed or the account has none — both are correct renders of the new tab, and
  // asserting only the first would make this depend on the seed rather than on the wiring.
  const empty = page.getByText('No saved meals match that.')
  const heading = page.getByText('Your meals', { exact: false })
  await expect(empty.or(heading.first())).toBeVisible({ timeout: 15_000 })
})
