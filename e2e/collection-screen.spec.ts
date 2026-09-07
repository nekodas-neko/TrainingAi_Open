import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * BF-122b — the collection screen and its explanation.
 *
 * Reads only: no rows are written, so nothing here can leak into a later spec's arithmetic the way
 * `plan-day-fill` did into `plan-rescale` (LA-67).
 *
 * What this can prove that the unit tests cannot: that `/api/collection` answers for a real signed-in
 * user and that the page renders its three ladders from that answer. The fold, the ranking and the
 * copy are pinned in `components/home/__tests__/collection-summary.test.ts`, which does not need a
 * browser.
 */
test('the collection screen lists every ladder and explains the rules', async ({ page }) => {
  test.setTimeout(120_000)
  await suppressMorningCheckin(page)
  await page.goto('/collection')
  await settleRouteBoundary(page)

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible({ timeout: 60_000 })

  // All three faucets, by their headings — a route that 500'd or a ladder that silently rendered
  // nothing would leave one of these missing.
  for (const heading of ['Workouts', 'Days with steps', 'Nights of sleep']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  // The explanation is a deliverable, not decoration: a decay nobody explained reads as a bug.
  await expect(page.getByRole('heading', { name: 'How this works' })).toBeVisible()
  await expect(page.getByText(/does not count against it at all/)).toBeVisible()

  // The rules quote the engine's own numbers rather than hardcoding them, so this also catches a
  // ladder constant changing without the copy following it.
  await expect(page.getByText(/5 cat slimes become a cat scout/)).toBeVisible()
})
