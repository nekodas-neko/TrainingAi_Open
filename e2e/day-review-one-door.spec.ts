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

  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })

  // LB-23: the review used to carry TWO nodes reading "End of Day" — Radix's sr-only `SheetTitle`
  // and the visible `<h2>` — so a screen reader announced the name twice and a heading query was
  // ambiguous. `SheetTitle asChild` makes the visible heading *be* the dialog's name, and the count
  // is the assertion, because one node reading "End of Day" is exactly what was wrong before.
  await expect(page.getByRole('heading', { name: 'End of Day' })).toHaveCount(1)
  await expect(review).toHaveAccessibleName(/End of Day/)
  // `Next`, not `Save`: Q-112b made this a stepped sheet and step 1 is the read-through. `Save`
  // lives on the last step, which is what `day-review-read-through.spec.ts` walks to.
  await expect(review.getByRole('button', { name: 'Next' })).toBeVisible()
})

test('the meal reminder’s older link still opens it', async ({ page }) => {
  // Notifications already scheduled on the phone carry `?chat=backfill`; changing the scheduler only
  // affects ones written from here on, so dropping this param would strand every pending reminder.
  await page.goto('/nutrition?chat=backfill')
  await settleRouteBoundary(page)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Next' })).toBeVisible({ timeout: 60_000 })
})

test('the param reaches an already-mounted Nutrition tab', async ({ page }) => {
  // **The case the other three cannot reach, and the one the two live entry points actually take.**
  // Home's banner calls `navigateToTab`, which the tab shell intercepts: it flips the tab and writes
  // the URL with `window.history.replaceState` (`components/shell/tab-shell.tsx:78`) — the raw
  // History API, chosen so an Android back press exits the app instead of unwinding every tab visit.
  // A raw `replaceState` does not normally reach the Next router at all; it works only because
  // Next 15 patches it ("Patch replaceState to ensure external changes to the history are reflected
  // in the Next.js Router" — `next/dist/client/components/app-router.js`). Every `page.goto` above is
  // a full document load and cannot tell a working patch from a broken one.
  //
  // The shell keeps a tab mounted once activated, so the param has to reach an effect — Nutrition's
  // review has no `useState` initializer reading it. That distinction is not theoretical: the first
  // draft of this drove Health's `?tab=body` instead, and renaming the `searchParams.get` in
  // Health's effect left it PASSING, because Health *does* have an initializer and it was quietly
  // doing the work.
  //
  // `replaceState` is called here rather than through the Home banner because that banner only
  // renders after 17:00 local (`session-select-content.tsx:354`) — a spec on it would pass each
  // evening and fail every morning.
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.evaluate(() => window.history.replaceState(null, '', '/nutrition?review=day'))
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Next' }))
    .toBeVisible({ timeout: 60_000 })
})

test('nutrition without the param does not open it', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Guards the inverse: a param check that matched anything would open the review on every visit.
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
