import { test, expect } from '@playwright/test'

/**
 * BF-100. The app scrolls an inner container, not the document, so Next's App Router scroll
 * restoration — which operates on the window scroller — cannot see, save or restore it. Owner:
 * *"when I press back I want to go back to that page at the same scroll level I was at. It usually
 * starts me at the top of the page. This is on many pages if not all pages."*
 *
 * **The case under test is a push to a SUB-ROUTE and back**, which is the one that loses the
 * position. A tab-to-tab move does not: the tab shell keeps every tab screen mounted, so its
 * container holds its own `scrollTop` with no help — measured, on `/nutrition`, with Health's
 * container still reading 840.
 *
 * **Three earlier versions of this spec failed for their own reasons**, each reporting
 * `expected 840, received 0` — indistinguishable, from the summary line, from a broken feature.
 * Text-matching *Sleep* hit a card that opens a **sheet**; `a[href^="/health/"]` matched nothing,
 * because these screens navigate from `router.push` buttons; and driving the push through the bottom
 * nav made `page.goBack()` land on `about:blank`. The precondition assertions below are what tell
 * those apart from a real regression — keep them.
 */

/** The one container that actually scrolls on these screens. */
const SCROLL_TOP = `Math.max(0, ...[...document.querySelectorAll('*')]
  .filter(e => e.scrollTop > 0).map(e => e.scrollTop))`

/**
 * Assert the screen came back to roughly where it was, NOT to an exact offset.
 *
 * **An equality assertion cannot tell a cancelled restore from an imprecise one, and that is the
 * distinction BF-100 turns on** — its whole open question is whether the restore is being
 * *cancelled* on the S25. Measured locally against clean `main`: saved **718**, restored **1019**,
 * and the test went red while restoration was working perfectly. These screens seed from cache and
 * revalidate, so the content keeps growing between the save and the restore; the offset that was
 * correct when saved is not the offset that shows the same content a second later.
 *
 * The lower bound is what carries the meaning. A cancelled restore leaves the container at **0** (a
 * fresh arrival starts at the top by construction — the third test below pins that), so 0 against a
 * saved 718 still fails loudly. What it no longer does is fail because the page grew.
 *
 * No upper bound, deliberately: capping it would re-introduce the same flake from the other side,
 * and overshooting because content grew above the anchor is not a defect this file is about.
 */
async function expectRestoredNear(
  page: import('@playwright/test').Page,
  // `page.evaluate` with a string expression is typed `unknown`, which is why the callers read it
  // straight into an assertion rather than a number.
  beforeRaw: unknown,
  what: string,
) {
  const before = Number(beforeRaw)
  const floor = Math.round(before * 0.9)
  await expect(async () => {
    const after = Number(await page.evaluate(SCROLL_TOP))
    expect(
      after,
      `${what}: restored to ${after} against a saved ${before} — at or near 0 means the restore was CANCELLED, which is the BF-100 failure; a value above the floor means it landed, even if the content grew`,
    ).toBeGreaterThanOrEqual(floor)
  }).toPass({ timeout: 30_000 })
}

async function scrollDown(page: import('@playwright/test').Page, steps = 7) {
  await page.mouse.move(200, 400)
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80) }
  await page.waitForTimeout(700)
}

test.describe('scroll position survives a push to a sub-route and back', () => {
  test('/more returns to the same offset', async ({ page }) => {
    await page.goto('/more')
    // This screen seeds from cache and revalidates, so let the content reach its height before
    // scrolling — the restore is gated on the container being tall enough for the saved offset.
    await page.waitForTimeout(5000)
    await scrollDown(page)
    const before = await page.evaluate(SCROLL_TOP)
    expect(before, 'nothing scrolled — the fixture is too short to test restoration').toBeGreaterThan(200)

    await page.getByRole('button', { name: /^Profile details/ }).first().evaluate(el => (el as HTMLElement).click())
    await page.waitForURL('**/more/details', { timeout: 30_000 })

    const saved = await page.evaluate(() => JSON.stringify(Object.fromEntries(
      Object.keys(sessionStorage).filter(k => k.startsWith('ta_scroll:')).map(k => [k, sessionStorage.getItem(k)]))))
    expect(saved, 'nothing was saved when the screen unmounted').toContain('ta_scroll:/more')

    await page.goBack()
    await expect(page).toHaveURL(/\/more$/, { timeout: 30_000 })
    // `toPass` rather than a fixed wait: the restore fires when the content reaches the saved
    // height, which is whenever the revalidation lands — seconds, on a cold server.
    await expectRestoredNear(page, before, '/more')
  })

  /**
   * RV-36. The Nutrition tab owns its own scroller and inherits nothing from `PullToSync`, so it was
   * the one live gap: measured before the fix, this push saved **no** `ta_scroll:` key and returned
   * **0** where `/more` restored 840.
   *
   * `/coach?scope=nutrition` is the tab's only deeper push. Every other routable screen that scrolls
   * at this viewport is a leaf with no `router.push` or `<Link>` out of it, so re-entering one is a
   * fresh arrival that correctly starts at the top — that was counted, not assumed.
   */
  test('/nutrition returns to the same offset after a push to the coach', async ({ page }) => {
    await page.goto('/nutrition')
    await page.waitForTimeout(5000)
    await scrollDown(page)
    const before = await page.evaluate(SCROLL_TOP)
    expect(before, 'nothing scrolled — the fixture is too short to test restoration').toBeGreaterThan(200)

    // A `router.push` button, not a link — `a[href^=…]` matched nothing on these screens, which is
    // one of the three traps this file's header records.
    await page.getByRole('button', { name: /Build a meal plan/ }).first()
      .evaluate(el => (el as HTMLElement).click())
    await page.waitForURL('**/coach**', { timeout: 30_000 })

    const saved = await page.evaluate(() => JSON.stringify(Object.fromEntries(
      Object.keys(sessionStorage).filter(k => k.startsWith('ta_scroll:')).map(k => [k, sessionStorage.getItem(k)]))))
    expect(saved, 'nothing was saved when the screen unmounted').toContain('ta_scroll:/nutrition')

    await page.goBack()
    await expect(page).toHaveURL(/\/nutrition$/, { timeout: 30_000 })
    await expectRestoredNear(page, before, '/nutrition')
  })

  test('a fresh forward arrival still starts at the top', async ({ page }) => {
    // The saved offset is consumed by the restore, so arriving with nothing stored starts at 0 by
    // construction. Asserted because the obvious alternative — gating on a `popstate` flag — is what
    // broke under StrictMode's double-invoked effects, and someone may reach for it again.
    await page.goto('/more')
    await page.waitForTimeout(5000)
    await scrollDown(page)
    await page.goto('/nutrition')
    await page.waitForTimeout(2500)
    await page.goto('/more')
    await page.waitForTimeout(5000)
    expect(await page.evaluate(SCROLL_TOP)).toBeLessThan(200)
  })
})
