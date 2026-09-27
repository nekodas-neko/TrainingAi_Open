import { test, expect } from '@playwright/test'
import { ZERO_DATA_STORAGE_STATE } from './fixtures'

/**
 * Home must not tell an account with no data things that are not true (RV-211 ①②③).
 *
 * The zero-data account is the only way to reach any of these states — every other spec runs as
 * the seeded user, who has a program, logs and metrics. This is the fixture's whole purpose.
 *
 * **It earns its runtime: it caught a fix the source guard could not.** The unit test pins the
 * header's three conditions, and the header was correct while the progress bar underneath it still
 * drew a 50% fill — the same claim, in the more legible of the two places. Nothing short of
 * rendering it would have shown that.
 */
test.use({
  storageState: ZERO_DATA_STORAGE_STATE,
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  serviceWorkers: 'block',
})
test.setTimeout(240_000)

test('an empty account is not given a band, a streak of rest days, or a week in review', async ({ page }) => {
  await page.goto('/')
  // The morning check-in opens over Home on an account that has not logged one, hiding the week
  // strip — which is most of what this asserts on.
  const close = page.getByRole('button', { name: /close/i }).first()
  await expect(page.getByText('Body Battery')).toBeVisible({ timeout: 120_000 })
  if (await close.count()) { await close.click().catch(() => {}) }

  // ① No week in review: the digest text always says SOMETHING ("0 sessions, 0 kg total"), so the
  // banner used to announce a week that did not happen.
  await expect(page.getByText(/week in review/i)).toHaveCount(0)

  // ② A band, a trend and a number are three claims about a body the app has never sensed.
  // Scoped to the card: the morning check-in's recovery scale also has a label reading exactly
  // "Good", so a page-wide assertion measures the wrong thing and fails for the wrong reason.
  const card = page.locator('button', { hasText: 'Body Battery' }).first()
  await expect(card.getByText('No data yet')).toBeVisible()
  for (const claim of ['Charged', 'Good', 'Low', 'Drained', 'Charging', 'Draining', 'Steady']) {
    await expect(card.getByText(claim, { exact: true })).toHaveCount(0)
  }

  // ③ With no program nothing was scheduled, so no past day was a REST day.
  await expect(page.getByText('rest', { exact: true })).toHaveCount(0)
})
