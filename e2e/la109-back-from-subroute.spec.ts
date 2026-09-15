import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * LA-109 — the owner: *"Going to more; then going to profile details and pressing back gets me to
 * the home page again."*
 *
 * **The cause is measured, not guessed.** `show()` flips tabs with `history.replaceState`, and
 * Next's patched `replaceState` re-injects **its own current tree** — still Home's, because no Next
 * navigation happened. So the `/more` entry carries the route tree for `/`. Dumping `history.state`
 * across a tab flip shows the URL changing to `/more` while the tree stays
 * `["",{"children":["(home)",…"/"…]}]`, with `history.length` unchanged at 2.
 *
 * Popping back to that entry restores the stale tree, Next renders `(home)/page`, and the shell
 * mounts with `initialTab="home"` — the URL is right and the screen is wrong.
 *
 * **This asserts the user-visible half**, which is what no previous spec covered: BF-49 reported the
 * same shape and was marked *"does not reproduce in the web harness"* because its sequence began
 * with a direct `goto`, so no entry ever carried a stale tree. **The tab flip is the precondition**,
 * and it is why this spec clicks the tab rather than navigating to it.
 */
test('back from a tab sub-route returns to that tab, not Home', async ({ page }) => {
  test.setTimeout(180_000)
  // The Morning Check-in is a MODAL: while it is open Radix marks <main> aria-hidden, so every
  // role query on the page under it returns nothing. A first draft of this spec failed claiming the
  // More heading did not exist — the convincing wrong answer the fixture's own docstring warns about.
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)

  // The precondition. A `goto('/more')` here would make the spec vacuous — it is the FLIP that
  // leaves the stale tree behind.
  await page.locator('nav').getByRole('link', { name: 'More', exact: true }).click()
  await page.waitForFunction(() => window.location.pathname === '/more')
  await settleRouteBoundary(page)
  await expect(page.getByRole('heading', { name: 'More' }).first()).toBeVisible({ timeout: 30_000 })

  // A real Next push onto a sub-route of that tab.
  await page.goto('/more/details')
  await settleRouteBoundary(page)

  await page.goBack()
  await settleRouteBoundary(page)

  // The URL was always right — it is the rendered screen that regressed, so assert both and let the
  // failure say which half broke.
  expect(page.url(), 'the URL half was never the bug').toContain('/more')
  await expect(
    page.getByRole('heading', { name: 'More' }).first(),
    'back from /more/details rendered something other than the More tab',
  ).toBeVisible({ timeout: 30_000 })
})
