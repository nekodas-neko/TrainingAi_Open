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
    await expect(async () => {
      expect(await page.evaluate(SCROLL_TOP)).toBe(before)
    }).toPass({ timeout: 30_000 })
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
