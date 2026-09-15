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
 * **This asserts the user-visible half**, which is what no previous spec covered. **The tab flip is
 * the precondition**, and it is why this spec clicks the tab rather than navigating to it: a first
 * draft used `goto('/more/details')`, which is a full document load, rebuilt history from scratch,
 * and passed while the bug was untouched.
 *
 * Confirmed load-bearing: run against `main`'s unfixed `tab-shell.tsx` this test goes red on the
 * More heading. The second test in this file, which supplies the same precondition in the opposite
 * direction for BF-49, passes unfixed — see its docstring, which is a negative result.
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
 * BF-49 — and this test's result is a NEGATIVE one, which is the whole reason it is kept.
 *
 * LA-109's entry says BF-49 *"is very likely the same defect"* and that the two must not be fixed
 * separately until one has been tried against the other's repro. This is that trial, and it
 * **refutes the link**.
 *
 * The hypothesis was symmetry: a REAL load of `/health` leaves Next's tree on Health; flipping to
 * Home rewrites the URL to `/` with `replaceState` and leaves that Health tree in place; an in-app
 * push off Home and a press of back should then restore it and render Health under a `/` URL —
 * exactly *"back took me to health training instead of home"*. It is a clean theory and it is wrong.
 *
 * **Measured 2026-09-15 by running this spec against `main`'s unfixed `tab-shell.tsx`.** The
 * sub-route test above went red exactly as it should. **This one passed unfixed.** So the BF-49
 * sequence does not reproduce even when the stale-tree precondition LA-109 identified is supplied
 * deliberately — which is a stronger negative than BF-49's existing *"does not reproduce in the web
 * harness"* note, because that one could be explained away by its repro having started with a
 * `goto`. This one starts with the flip and still will not break.
 *
 * It is kept as a REGRESSION GUARD, not as evidence: the fix above changes which tab the shell
 * mounts, and the reverse direction — flip to Home, push off it, come back — is the thing a naive
 * version of that fix would break. It pins behaviour that is already correct. It must never be read
 * as having confirmed BF-49, and a green run here says nothing about the device.
 */
test('back from a push off Home returns to Home, not the tab whose tree is stale', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)

  // A REAL navigation, so Next's tree is genuinely Health's — that is the precondition.
  await page.goto('/health')
  await settleRouteBoundary(page)

  // The flip rewrites the URL to "/" and leaves Health's tree on that entry.
  //
  // Dispatched through `evaluate` rather than `click()`: on `/health` the nav link resolves but never
  // satisfies Playwright's stability check — measured, 63 retries of "visible, enabled and stable"
  // before a 180 s timeout — because that screen keeps something animating beneath it. The
  // `waitForFunction` below is what makes a forced dispatch safe: a click that lands on nothing fails
  // right here instead of surfacing later as a wrong-looking assertion.
  await page.locator('nav').getByRole('link', { name: 'Home', exact: true })
    .evaluate(el => (el as HTMLElement).click())
  await page.waitForFunction(() => window.location.pathname === '/')
  await settleRouteBoundary(page)

  // An in-app push off Home. The streak card pushes /health?tab=training — the very screen the
  // owner reported landing on, which is what made this sequence worth trying at all.
  await page.getByRole('button', { name: /Day Streak|Sessions/i }).first().tap()
  await page.waitForFunction(() => window.location.pathname.startsWith('/health'))
  await settleRouteBoundary(page)

  await page.goBack()
  await settleRouteBoundary(page)

  expect(new URL(page.url()).pathname, 'the URL half was never the bug').toBe('/')
  await expect(
    page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).first(),
    'back from a push off Home rendered the stale tab instead of Home (regression guard, not a BF-49 repro)',
  ).toBeVisible({ timeout: 30_000 })
})
