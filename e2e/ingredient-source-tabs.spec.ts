import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-51 ③ — `Recently used` no longer sits in the middle of the ingredient list.
 *
 * The owner: *"this should probably be a tab like the other place"*. It read as mid-list because it
 * was — your own foods, then the estimate/import action, then the food database. Two lists with an
 * action between them.
 *
 * Driven through the DOM: this section's controls do not receive Playwright's synthetic input
 * (LB-68).
 */
test.use({ serviceWorkers: 'block' })

const domClick = async (l: import('@playwright/test').Locator) => {
  await expect(l).toBeVisible({ timeout: 30_000 })
  await l.evaluate((el: HTMLElement) => el.click())
}

test('the two ingredient sources are tabs, and only one list shows at a time', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await domClick(page.getByRole('button', { name: 'My Foods', exact: true }))
  await domClick(page.getByRole('tab', { name: 'My Foods', exact: true }))
  await domClick(page.getByRole('button', { name: /build|create|new meal/i }).first())

  const yours = page.getByRole('tab', { name: 'Your foods', exact: true })
  const database = page.getByRole('tab', { name: 'Food database', exact: true })
  await expect(yours).toBeVisible({ timeout: 30_000 })
  await expect(database).toBeVisible()

  // The database list is behind its own tab now, not stacked under the user's own foods.
  await domClick(database)
  await expect(page.getByText('Type at least two letters to search the food database.')).toBeVisible()

  // And switching back shows the user's own list rather than both at once.
  await domClick(yours)
  await expect(page.getByText('Type at least two letters to search the food database.')).toHaveCount(0)
})
