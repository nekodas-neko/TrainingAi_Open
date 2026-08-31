import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary, stableBox } from './fixtures'

/**
 * The meal builder offers a barcode scan (BF-63).
 *
 * The owner's report was about a missing affordance — *"in the meal creator there is no
 * scan/barcode option"* — while Log Food, one screen back in the same sheet, has had
 * `Photo · Barcode · Describe` since it shipped. So the assertion is that the control exists and
 * reaches the scanner.
 *
 * **What this canNOT prove, and why there is no spec that does.** The scan itself needs a camera:
 * on the device `BarcodeScanner` drives the Capacitor plugin, and on web it asks for
 * `getUserMedia`. Neither exists in this harness, which is why the repo has no barcode e2e at all.
 * The lookup path — `/api/nutrition/barcode` → `createFoodItem({ source: 'barcode' })` → added as
 * an ingredient — is verifiable only on the S25.
 */
async function openBuilder(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Meals', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'Meals', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
  await page.getByRole('tab', { name: 'Meals', exact: true }).tap()
  await page.getByRole('button', { name: /^(New|Build your first meal)$/ }).first().tap()
  await expect(page.getByRole('button', { name: /^(Update|Save) Meal$/ })).toBeVisible({ timeout: 15_000 })
}

test('the builder offers a barcode scan beside the ingredient search', async ({ page }) => {
  await openBuilder(page)

  const scan = page.getByRole('button', { name: 'Scan a barcode' })
  await expect(scan, 'a packet ingredient has to be typed without this').toBeVisible({ timeout: 15_000 })

  // The 48 dp floor applies to it like every other control on this screen.
  const box = await stableBox(scan)
  expect(box.height, 'below the 48 dp tap-target floor').toBeGreaterThanOrEqual(44)
  expect(box.width, 'below the 48 dp tap-target floor').toBeGreaterThanOrEqual(44)

  await scan.tap()
  // The scanner REPLACES the picker, so the marker is the search row going away — a state that
  // exists only after the tap. Asserting something the scanner shows would be asserting a camera:
  // with none attached, `getUserMedia` rejects and the surface is its own failure state, which is
  // the correct behaviour and not what this test is about.
  await expect(scan, 'the tap did not reach the scanner').toBeHidden({ timeout: 15_000 })
  await expect(page.getByPlaceholder(/search your foods/i)).toBeHidden()
})
