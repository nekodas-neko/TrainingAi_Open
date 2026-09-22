import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// TN-58. The absolute 1–5 above this control produced TWO distinct values across 96 check-ins,
// none of them touched — and `day_checkins.vs_yesterday` has no column default precisely so a
// skipped answer stays NULL. A source test can show the state initialises to null; only the
// rendered control can show that nothing is *selected* when the sheet opens, which is the property
// the whole design rests on.
//
// **Deliberately does NOT call `suppressMorningCheckin`** — every other spec suppresses this sheet,
// and this one needs it. It opens when `ta_morning_checkin` is absent and the user has no `morning`
// row for today, which is what a fresh run provides.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test('the comparative control opens with nothing selected, and can be cleared again', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  const group = page.getByRole('radiogroup', { name: 'Compared to yesterday' })
  await expect(group, 'the morning check-in sheet did not open — this spec must not suppress it')
    .toBeVisible({ timeout: 20_000 })

  const options = group.getByRole('radio')
  await expect(options).toHaveCount(3)

  // The property the column's missing default exists to protect.
  for (const name of ['Better', 'About the same', 'Worse']) {
    await expect(group.getByRole('radio', { name }), `${name} is pre-selected — a neutral stored `
      + 'as though it were an answer is exactly the defect this question was written to escape')
      .toHaveAttribute('aria-checked', 'false')
  }

  const better = group.getByRole('radio', { name: 'Better' })
  await better.evaluate(el => (el as HTMLElement).click())
  await expect(better).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('radio', { name: 'Worse' })).toHaveAttribute('aria-checked', 'false')

  // Tapping the selection again returns to unanswered, so a mis-tap is recoverable rather than
  // stuck on a value the owner did not mean.
  await better.evaluate(el => (el as HTMLElement).click())
  await expect(better).toHaveAttribute('aria-checked', 'false')
})
