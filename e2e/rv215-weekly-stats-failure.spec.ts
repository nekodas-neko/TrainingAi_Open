import { test, expect } from '@playwright/test'

/**
 * A failed weekly-stats fetch must end the skeleton (RV-215 ①).
 *
 * `cachedFetchToday` swallows `!res.ok`, so before this the card's own `loading` flag
 * (`data === null`) stayed true and the skeleton animated until the app was killed. The source
 * guard pins the wiring; this pins that the screen actually leaves the loading state, which is
 * the thing a user would notice.
 *
 * `serviceWorkers: 'block'` is required — the SW's `/api/` branch answers before Playwright's
 * router sees the request.
 */
test.use({ viewport: { width: 412, height: 915 }, colorScheme: 'dark', serviceWorkers: 'block' })
test.setTimeout(240_000)

test('a failed weekly-stats fetch shows an error with a retry, not an endless skeleton', async ({ page }) => {
  await page.route('**/api/weekly-stats**', r => r.fulfill({ status: 500, json: { error: 'nope' } }))

  await page.goto('/health')
  await expect(page.getByText(/Couldn.t load your weekly stats/i)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})
