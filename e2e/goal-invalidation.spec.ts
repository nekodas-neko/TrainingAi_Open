import { test, expect } from '@playwright/test'
import { settleRouteBoundary, ensureStepsToday } from './fixtures'

/**
 * A steps-goal edit reaches Health's Progress panel without a reload.
 *
 * **This was written as the Q-259 guard for Q-240 and is not one — because no such guard can
 * exist for this path.** That was established by measurement, not by giving up, and the measurement
 * is the durable result:
 *
 *  - Deleting Q-240's fix (`.then(res => invalidateGoalRecommendations())` in `goals-section.tsx`)
 *    leaves this spec **passing**. `cachedFetchCore` paints the cached value and then *always*
 *    revalidates over the network unless `freshWithinTtl` is set, and `user-goals` does not set it —
 *    so the settled value is correct whether or not the cache was invalidated.
 *  - Nor does the invalidation remove the stale *flash*. Sampling the DOM every 100 ms across the
 *    return trip showed the identical sequence both ways: `8,000 / 7,000 ✓` then `8,000 / 9,000`.
 *    The first paint on tab re-entry comes from Health's retained React state, not from the cache,
 *    so clearing the cache cannot change it.
 *
 * The water-goal version of this idea failed for a different reason (Health's `localStorage` device
 * copy masks it). This one fails for a structural one. Both are recorded so the next attempt does
 * not start from the same premise.
 *
 * What it DOES cover, proven by mutation: suppressing the steps PATCH fails it, and dropping the
 * `user-goals` payload on Health fails it. That is the Q-260 shape on the Progress panel — a goal
 * with no device copy, reached entirely client-side — which no other spec exercises.
 *
 * Two things it depends on, verified rather than assumed:
 *  - **Today carries a steps value** — `goals-progress-card.tsx` filters `visibleRows` on
 *    `value != null`, so without one the row does not render and the assertion is vacuous. This used
 *    to lean on `seed.sql`, which writes fourteen days ending at *its* today — the day the seed
 *    **ran**. Nothing back-fills, and `setup.sh` skips a non-empty `users` table, so an aged
 *    container has no row for the current day and this spec fails with the goal locator NOT FOUND.
 *    That was misfiled as a sandbox time budget (LB-19) until it was measured on 2026-08-30:
 *    `max(date) WHERE steps IS NOT NULL` was `2026-08-25` against a `current_date` of `2026-08-30`,
 *    and the failure was a 60 s locator timeout inside a test with 180 s left to run. `beforeAll`
 *    guarantees the row now, so the spec no longer depends on when the database was seeded.
 *  - The return trip is **client-side**. `page.goto('/health?tab=progress')` is a full document load
 *    that remounts and refetches unconditionally, which would pass regardless.
 */

// Deliberately not near 8000, the seeded steps value for today: a goal equal to the value renders
// with a "✓" suffix, and picking distinct round numbers keeps the assertion unambiguous.
const FIRST_GOAL = 7000
const SECOND_GOAL = 9000

test.setTimeout(180_000)

// Non-destructive: an existing steps value is left alone and `restore()` puts back exactly what was
// there. `8000` is what `seed.sql` itself writes for today, so the goals below stay distinct from it.
let restoreSteps: () => Promise<void> = async () => {}
test.beforeAll(async () => { ({ restore: restoreSteps } = await ensureStepsToday()) })
test.afterAll(async () => { await restoreSteps() })

async function setStepsGoal(page: import('@playwright/test').Page, goal: number) {
  await page.getByText('Activity level, targets & AI recommendations').click()
  const input = page.getByLabel('Steps Goal')
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(String(goal))
  await input.blur()
  // The PATCH is debounced by 1 s; asserting `r.ok()` here means a rejected write fails at the
  // write rather than later as a confusing "Health did not update".
  await page.waitForResponse(
    r => r.url().includes('/api/user/goals') && r.request().method() === 'PATCH' && r.ok(),
    { timeout: 30_000 },
  )
}

test('a steps-goal edit reaches Health without a reload', async ({ page }) => {
  // 1. Establish a known starting goal.
  await page.goto('/more')
  await settleRouteBoundary(page)
  await setStepsGoal(page, FIRST_GOAL)

  // 2. Load Health's Progress panel. This is the full load that primes `user-goals` with the first
  //    goal — the stale entry the rest of the test is about.
  await page.goto('/health?tab=progress')
  await settleRouteBoundary(page)
  await expect(page.getByRole('tab', { name: 'Progress', selected: true })).toBeVisible()
  await expect(page.getByText(`/ ${FIRST_GOAL.toLocaleString()}`).first())
    .toBeVisible({ timeout: 60_000 })

  // 3. Change it again, from the other tab.
  await page.getByRole('link', { name: 'More' }).click()
  await settleRouteBoundary(page)
  await setStepsGoal(page, SECOND_GOAL)

  // 4. Back to Health entirely client-side — tab bar, then the panel control. No `goto`, no reload:
  //    a document load would refetch regardless and prove nothing.
  await page.getByRole('link', { name: 'Health' }).click()
  await settleRouteBoundary(page)
  await page.getByRole('tab', { name: 'Progress' }).click()

  // 5. The new goal must be on screen. This converges via the tabEpoch refetch Q-260 added; it is
  //    not a statement about cache invalidation (see the header).
  await expect(page.getByText(`/ ${SECOND_GOAL.toLocaleString()}`).first())
    .toBeVisible({ timeout: 60_000 })
})
