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

/**
 * The week-window fetch is gated on the wrap-up being OPEN (Q-112d).
 *
 * `EndOfDayReview` is rendered unconditionally by `nutrition-content`; `open` only drives Radix.
 * So a hook in that component's body would fire on every visit to the Nutrition tab, for a payload
 * nobody has asked to see — which is why `DayTrendsSection` is its own child of `SheetContent`,
 * exactly as `DayReadThroughSection` is.
 *
 * **This is the half no unit test can reach**, and it is written against the request rather than
 * the rendered rows on purpose: whether any row draws depends on what the seed recorded in the
 * eight days before today, and encoding that here would make the test a statement about fixtures.
 * Whether the request happens at all does not.
 */
test('the week window is fetched when the wrap-up opens, and not before', async ({ page }) => {
  const calls: string[] = []
  page.on('request', req => {
    if (new URL(req.url()).pathname === '/api/day-review/week-window') calls.push(req.url())
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  // Something on the tab must have settled before "no request yet" means anything — otherwise this
  // passes on a page that has not finished loading.
  await expect(page.getByRole('button', { name: 'End of Day', exact: true })).toBeVisible({ timeout: 60_000 })
  expect(calls, 'the Nutrition tab must not pay for a sheet nobody opened').toHaveLength(0)

  await page.goto('/nutrition?review=day')
  await settleRouteBoundary(page)
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => calls.length, { timeout: 30_000 }).toBeGreaterThan(0)
})
