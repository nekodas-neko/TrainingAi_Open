import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'
import { V2_LADDERS } from '@trainingai/shared/collection/ladder'

/**
 * BF-122b — the collection screen and its explanation.
 *
 * Reads only: no rows are written, so nothing here can leak into a later spec's arithmetic the way
 * `plan-day-fill` did into `plan-rescale` (LA-67).
 *
 * What this can prove that the unit tests cannot: that `/api/collection` answers for a real signed-in
 * user and that the page renders its four ladders from that answer. The fold, the ranking and the
 * copy are pinned in `components/home/__tests__/collection-summary.test.ts`, which does not need a
 * browser.
 */
test('the collection screen lists every ladder and explains the rules', async ({ page }) => {
  test.setTimeout(120_000)
  await suppressMorningCheckin(page)
  await page.goto('/collection')
  await settleRouteBoundary(page)

  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible({ timeout: 60_000 })

  for (const heading of ['Workouts', 'Steps', 'Health logging']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: /^Cardio sessions/ })).toBeVisible()

  // The explanation is a deliverable, not decoration: a decay nobody explained reads as a bug.
  await expect(page.getByRole('heading', { name: 'How this works' })).toBeVisible()
  await expect(page.getByText(/does not count against it at all/)).toBeVisible()

  // The rules quote the engine's own numbers rather than hardcoding them, so this also catches a
  // ladder constant changing without the copy following it.
  const mergeCosts = V2_LADDERS.workout.tiers.slice(1).map(tier => tier.mergeCost).join(' · ')
  await expect(page.getByText(`${mergeCosts} cats of one tier make the next on the Tank row.`, { exact: false })).toBeVisible()
})
