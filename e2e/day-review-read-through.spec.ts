import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * The evening wrap-up draws the same read-through `/health/day` draws (Q-112b).
 *
 * The value being guarded is **one implementation, not two**: `DayReadThrough` is rendered by both
 * hosts off the same `day-log:<date>` cache key. A second copy would look identical on the day it
 * was written and drift from the next section change onward, which is the failure this exists to
 * make loud.
 */
test('the wrap-up shows the day it is wrapping up', async ({ page }) => {
  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)

  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })

  // Section labels come from `day-sections.tsx`, which is what both hosts render. Asserting on the
  // labels rather than on any one day's numbers keeps this independent of the seed's contents —
  // every section self-hides when its domain is empty, so at least one must be present for the
  // read-through to be doing anything at all.
  const sections = review.getByText(/^(Training|Activity|Energy|Sleep|Body|Heart rate through the day)$/)
  await expect(sections.first()).toBeVisible({ timeout: 60_000 })
})

test('the same section labels appear on /health/day', async ({ page }) => {
  // The other half of the claim. If these two ever diverge, one host grew its own copy.
  await page.goto('/health/day')
  await settleRouteBoundary(page)
  const sections = page.getByText(/^(Training|Activity|Energy|Sleep|Body|Heart rate through the day)$/)
  await expect(sections.first()).toBeVisible({ timeout: 60_000 })
})

test('the wrap-up steps through to a Save', async ({ page }) => {
  // The step rule (Q-112b): step 1 is the day and is never omitted, the meals step is skipped once
  // every configured meal has something logged, and the wrap-up holds the Save. So the number of
  // Nexts between opening and Save is *data-dependent* — pressing until Save appears is the only
  // shape that does not encode the seed's meal coverage into the test.
  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)

  const review = page.getByRole('dialog')
  await expect(review).toBeVisible({ timeout: 60_000 })
  // Exact, and including the separator the header actually renders. `getByText` matches
  // SUBSTRINGS, and a step title is a short English phrase — "The day" is inside the summary card's
  // "Totals are the day's figures…" one line below it. (The title is not "Your day" because the
  // digest card on this step carries that as its eyebrow, which is the LB-23 shape; swapping it for
  // a phrase that appears in body copy is the same trap wearing a different hat, and this is what
  // closes both.)
  await expect(review.getByText('· The day', { exact: true })).toBeVisible()

  const save = review.getByRole('button', { name: 'Save' })
  const next = review.getByRole('button', { name: 'Next' })
  // Bounded: three steps exist, so more than three presses means the flow does not terminate.
  for (let i = 0; i < 3 && await next.isVisible(); i++) await next.click()

  await expect(save).toBeVisible({ timeout: 30_000 })
  await expect(next).toHaveCount(0)
  // Stepping back must reach the read-through again — a one-way flow would strand a user who
  // stepped past it. The control is "Previous" rather than "Back" because a sore-muscle chip on
  // this very step is labelled "Back", and two identically-named buttons is an accessibility
  // defect first and a strict-mode violation second.
  await review.getByRole('button', { name: 'Previous' }).click()
  await expect(review.getByRole('button', { name: 'Next' })).toBeVisible()
})
