import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * The day review has one door (Q-112a).
 *
 * It had two: Home opened a thinner `DayReviewSheet` that only Home had, and Nutrition's End of Day
 * button opened the real review. Both reminders landed on `/` and left the user to find a banner.
 * Now everything reaches `/nutrition?review=day`.
 *
 * **The review lives where its data does.** `EndOfDayReview` needs meal types, the day's logs and
 * the user's targets — all Nutrition's state. Hosting it on Home, as the plan first sketched, would
 * have meant duplicating three fetches onto a screen that has none of them.
 */

test('the day-review deep link opens the review', async ({ page }) => {
  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)

  // Matched on the dialog rather than the heading: the review carries TWO nodes reading "End of
  // Day" — Radix's sr-only `SheetTitle` and the visible `<h2>` — so a heading query is ambiguous.
  // That duplication is a real accessibility defect and is filed as LB-23, not fixed here.
  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })
  await expect(review.getByRole('button', { name: 'Save' })).toBeVisible()
})

test('the meal reminder’s older link still opens it', async ({ page }) => {
  // Notifications already scheduled on the phone carry `?chat=backfill`; changing the scheduler only
  // affects ones written from here on, so dropping this param would strand every pending reminder.
  await page.goto('/nutrition?chat=backfill')
  await settleRouteBoundary(page)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 60_000 })
})

test('nutrition without the param does not open it', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Guards the inverse: a param check that matched anything would open the review on every visit.
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
