import { test, expect } from '@playwright/test'
import { tapHitTested, settleRouteBoundary } from './fixtures'

/**
 * BF-165 / DV-2 — a navigation issued while a sheet or dialog closes must not be undone by that
 * surface popping its own history entry.
 *
 * The owner: *"when I try click the treadmill; or any 'Other activity' nothing actually happens"* —
 * and, asked to narrow it, *"it just scrolls to the top of cardio hub"*. The push always happened.
 * The sheet's close popped the entry it had just created, 7 ms later on the S25, and `/cardio`
 * re-rendered at the top of its nested scroller.
 *
 * **Two conditions have to hold for this file to measure anything, and each one produced a round of
 * wrong answers when it did not:**
 *
 * 1. **Warm the destination first.** `next dev` compiles a route on first request, and a client-side
 *    push issues an RSC fetch that then HANGS until compilation finishes — measured unresolved after
 *    8 s with no error, no 4xx, no console output. It is indistinguishable from a dead tap, and no
 *    wait is long enough because the compile time depends on the tree behind the route. That is what
 *    the 2026-09-15 retraction struck three findings for.
 * 2. **Make the tap land.** `tapHitTested` exists for this; see its docblock for the false
 *    differential a coordinate dispatch below the fold manufactures here specifically.
 *
 * *Guided walk* is kept as the discriminator: it navigates correctly today because no sheet is
 * involved, so a "fix" that broke navigation generally would otherwise pass this file.
 */

const SETTLE_MS = 2_000

/** The defect was an UNDO, so arriving is not the assertion — staying is. */
async function expectSettledAt(page: import('@playwright/test').Page, pathname: string) {
  await page.waitForURL((u) => u.pathname === pathname, { timeout: 15_000 })
  await page.waitForTimeout(SETTLE_MS)
  expect(new URL(page.url()).pathname, 'the navigation was undone after it landed').toBe(pathname)
}

test.beforeEach(async ({ page }) => {
  // Condition 1. A direct goto compiles the route; the push under test then measures the push.
  for (const route of ['/activity', '/activity/guided-walk']) {
    await page.goto(route)
    await settleRouteBoundary(page)
  }
  await page.goto('/cardio')
  await settleRouteBoundary(page)
})

test('Other activity → a type navigates to /activity and stays there', async ({ page }) => {
  await tapHitTested(page, page.getByRole('button', { name: /Other activity/ }))
  // The sheet pushes its own history entry as it opens — the entry this defect is about.
  await expect(page.getByRole('heading', { name: 'Log Activity' })).toBeVisible()

  await tapHitTested(page, page.getByRole('button', { name: /Treadmill/i }).first())
  await expectSettledAt(page, '/activity')
})

test('and backing out of it takes ONE press, not two', async ({ page }) => {
  // The other half of the fix. Suppressing the pop alone would leave the sheet's entry stranded
  // underneath `/activity` at the same URL as the page below, so the first back would appear to do
  // nothing. `router.replace` overwrites it instead.
  await tapHitTested(page, page.getByRole('button', { name: /Other activity/ }))
  await tapHitTested(page, page.getByRole('button', { name: /Treadmill/i }).first())
  await expectSettledAt(page, '/activity')

  await page.goBack()
  await page.waitForTimeout(SETTLE_MS)
  expect(new URL(page.url()).pathname, 'one back should reach the hub').toBe('/cardio')
})

test('Guided walk still navigates — the discriminator, no sheet involved', async ({ page }) => {
  await tapHitTested(page, page.getByRole('button', { name: /Guided walk/ }))
  await expectSettledAt(page, '/activity/guided-walk')
})
