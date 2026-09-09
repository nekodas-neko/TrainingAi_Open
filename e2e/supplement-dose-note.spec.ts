import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * OR-104's surface half — the sheet stops offering two answers to one question.
 *
 * In production `Retatrutide` carries `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'`
 * — the vial strength, typed into a field labelled `Dose`. The two disagree by 20×, and the list
 * showed the free text under the name, so the number the app actually doses with was the one you
 * could not see.
 *
 * Driven through the DOM rather than synthetic taps: this section's controls do not receive
 * Playwright's synthetic input (LB-68).
 */
test.use({ serviceWorkers: 'block' })

const NAME = 'Dose Label E2E'

const domClick = async (l: import('@playwright/test').Locator) => {
  await expect(l).toBeVisible({ timeout: 30_000 })
  await l.evaluate((el: HTMLElement) => el.click())
}

test('an amount makes the free-text line a note, and the row shows the amount', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await domClick(page.getByRole('button', { name: 'Manage' }))
  await domClick(page.getByRole('button', { name: 'Add Supplement' }))

  await page.getByPlaceholder('e.g. Creatine').fill(NAME)

  // With no amount, the free-text field is still the dose — the pre-BF-112 shape, still valid.
  await expect(page.getByText('Dose (optional)')).toBeVisible()

  await page.getByPlaceholder('e.g. 5', { exact: true }).fill('0.5')
  await page.getByPlaceholder('mg', { exact: true }).fill('mg')

  // Once there is an amount, the same field is a note and says so.
  await expect(page.getByText('Note (optional)')).toBeVisible()
  await expect(page.getByText('The amount above is the dose. This line is just a note — it is not counted.')).toBeVisible()

  // The vial strength, typed where the owner typed it.
  await page.getByPlaceholder('e.g. with food, morning only').fill('10mg')
  await domClick(page.getByRole('button', { name: 'Save', exact: true }))

  // The row leads with the dose the app computes with, and demotes the free text to a note.
  const row = page.locator('div').filter({ hasText: NAME }).last()
  await expect(row.getByText('0.5 mg', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(row.getByText('Note: 10mg')).toBeVisible()
})
