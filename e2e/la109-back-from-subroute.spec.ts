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

  // **Tapped, not `goto`-ed, and this is the whole spec.** `page.goto('/more/details')` is a full
  // document load: it rebuilds history from scratch, so the stale entry never survives to be popped
  // and the test passes while the bug is untouched. Measured — a first draft did exactly that and
  // went green. It is also precisely why BF-49 was filed as "does not reproduce in the web harness".
  // `profile-tab.tsx` reaches this screen with `router.push`, which is what the owner's tap runs.
  await page.getByRole('button', { name: 'Profile details' }).tap()
  await page.waitForFunction(() => window.location.pathname === '/more/details')
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

/**
 * BF-49, which LA-109's entry says must be tried against this repro before either is fixed:
 * *"Tapping a workout, then back, leads to health training not home."*
 *
 * **Same defect, opposite direction, and that is the reason it reads as a different bug.** A REAL
 * load of `/health` leaves Next's tree on Health. Flipping to Home then rewrites the URL to `/` with
 * `replaceState` and leaves that Health tree in place, so the `/` entry is the poisoned one. An
 * in-app push off Home and a press of back restores it — and Health renders under a `/` URL, which
 * is exactly "back took me to health training instead of home".
 *
 * BF-49 was filed *"does not reproduce in the web harness"* and concluded *"the fix is not in the
 * router"*. Both follow from a sequence that began with a `goto`: no entry ever carried a stale tree,
 * so there was nothing for back to restore wrongly.
 */
test('back from a push off Home returns to Home, not the tab whose tree is stale', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)

  // A REAL navigation, so Next's tree is genuinely Health's — that is the precondition.
  await page.goto('/health')
  await settleRouteBoundary(page)

  // The flip rewrites the URL to "/" and leaves Health's tree on that entry.
  await page.locator('nav').getByRole('link', { name: 'Home', exact: true }).click()
  await page.waitForFunction(() => window.location.pathname === '/')
  await settleRouteBoundary(page)

  // An in-app push off Home. The streak card pushes /health?tab=training — the very screen the
  // owner reported landing on, which is what first tied these two entries together.
  await page.getByRole('button', { name: /Day Streak|Sessions/i }).first().tap()
  await page.waitForFunction(() => window.location.pathname.startsWith('/health'))
  await settleRouteBoundary(page)

  await page.goBack()
  await settleRouteBoundary(page)

  expect(new URL(page.url()).pathname, 'the URL half was never the bug').toBe('/')
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).first(),
    'back from a push off Home rendered the stale tab instead of Home',
  ).toBeVisible({ timeout: 30_000 })
})
