import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-133 — what the app has measured, under what it was told, on More → Profile details.
 *
 * The assertions are about the two properties that decide whether a dense read-only card is useful
 * or misleading: **every reading carries the date it was taken**, and **a metric with no reading is
 * absent rather than blank**. The six tape-measure columns in `body_metrics` have never been
 * written by anything, so they are the standing proof of the second.
 */
test('the measured card dates every reading and omits what was never measured', async ({ page }) => {
  await page.goto('/more/details')
  await settleRouteBoundary(page)

  const heading = page.getByRole('heading', { name: 'What the app has measured' })
  await expect(heading).toBeVisible({ timeout: 60_000 })

  const section = page.locator('section').filter({ has: heading })

  // Nothing writes the tape measurements, so they must not appear at all — a blank row would be
  // worse than their absence, and there are six of them.
  for (const label of ['Waist', 'Chest', 'Arm', 'Thigh', 'Hip', 'Neck']) {
    await expect(section.getByText(label, { exact: true })).toHaveCount(0)
  }

  // Every rendered reading is dated. A one-off scale figure sits beside today's step count.
  const dates = section.locator('p.tabular-nums.text-right')
  const rows = await dates.count()
  expect(rows).toBeGreaterThan(0)
  for (let i = 0; i < rows; i++) {
    await expect(dates.nth(i)).toHaveText(/^\d{4}-\d{2}-\d{2}$/)
  }

  // The scale's resting rate says what it is, because the app also holds a lab-measured one.
  const restingRate = section.getByText('Resting rate', { exact: true })
  if (await restingRate.count()) {
    await expect(section.getByText(/estimated by the scale/)).toBeVisible()
  }
})
