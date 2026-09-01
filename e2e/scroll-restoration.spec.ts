import { test, expect } from '@playwright/test'

/**
 * BF-100. The app scrolls an inner container, not the document, so Next's App Router scroll
 * restoration — which operates on the window scroller — cannot see, save or restore it. Owner:
 * *"when I press back I want to go back to that page at the same scroll level I was at. It usually
 * starts me at the top of the page. This is on many pages if not all pages."*
 *
 * **This spec is the only thing that can catch a regression here**, and it took three tries to make
 * it drive the app at all. Both earlier versions failed for their own reasons while reporting
 * "expected 840, received 0" — indistinguishable, from the summary line, from the feature being
 * broken. What separates them is the precondition assertions below: they say *the tap did not
 * navigate* rather than leaving you to debug a fix that was working the whole time.
 *
 * The push goes through the **bottom nav**, which renders real `<Link>`s and is on every tab screen.
 * Card text was the first handle and it is not one: on Health the Sleep card opens a *sheet*, so
 * nothing unmounted and nothing was saved.
 */

/** The one container that actually scrolls on these screens. */
const SCROLL_TOP = `Math.max(0, ...[...document.querySelectorAll('*')]
  .filter(e => e.scrollTop > 0).map(e => e.scrollTop))`

async function scrollDown(page: import('@playwright/test').Page, steps = 7) {
  await page.mouse.move(200, 400)
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80) }
  await page.waitForTimeout(700)
}

test.describe('scroll position survives a push and back', () => {
  for (const [route, away] of [['/health', '/nutrition'], ['/more', '/nutrition']] as const) {
    test(`${route} returns to the same offset`, async ({ page }) => {
      await page.goto(route)
      // These screens seed from cache and revalidate, so let the content reach its height before
      // scrolling — the restore is gated on the container being tall enough for the saved offset.
      await page.waitForTimeout(5000)
      await scrollDown(page)
      const before = await page.evaluate(SCROLL_TOP)
      expect(before, 'nothing scrolled — the fixture is too short to test restoration').toBeGreaterThan(200)

      const nav = page.locator(`a[href="${away}"]`).first()
      await expect(nav, 'no bottom-nav link to push through').toBeAttached({ timeout: 20_000 })
      await nav.evaluate(el => (el as HTMLElement).click())
      await page.waitForURL(`**${away}`, { timeout: 30_000 })
      await page.waitForTimeout(1500)

      const saved = await page.evaluate(() => JSON.stringify(Object.fromEntries(
        Object.keys(sessionStorage).filter(k => k.startsWith('ta_scroll:')).map(k => [k, sessionStorage.getItem(k)]))))
      expect(saved, 'nothing was saved when the screen unmounted').toContain('ta_scroll:')

      await page.goBack()
      // `toPass` rather than a fixed wait: the restore fires when the content reaches the saved
      // height, which is whenever the revalidation lands — seconds, on a cold server.
      await expect(async () => {
        expect(await page.evaluate(SCROLL_TOP)).toBe(before)
      }).toPass({ timeout: 30_000 })
    })
  }

  test('a fresh forward arrival still starts at the top', async ({ page }) => {
    // The saved offset is consumed by the restore, so arriving with nothing stored starts at 0 by
    // construction. Asserted because the obvious alternative — gating on a `popstate` flag — is what
    // broke under StrictMode's double-invoked effects, and someone may reach for it again.
    await page.goto('/health')
    await page.waitForTimeout(5000)
    await scrollDown(page)
    await page.goto('/nutrition')
    await page.waitForTimeout(2500)
    await page.goto('/health')
    await page.waitForTimeout(5000)
    expect(await page.evaluate(SCROLL_TOP)).toBeLessThan(200)
  })
})
