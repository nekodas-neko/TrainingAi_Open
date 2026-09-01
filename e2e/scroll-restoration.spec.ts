import { test, expect } from '@playwright/test'

/**
 * BF-100. The app scrolls an inner container, not the document, so Next's own scroll restoration —
 * which operates on the window scroller — cannot see, save or restore it. Owner: *"when I press back
 * I want to go back to that page at the same scroll level I was at. It usually starts me at the top
 * of the page. This is on many pages if not all pages."*
 *
 * **This spec is the only thing that can catch a regression here.** Every one of the four defects
 * found while building it produced code that reads correctly and does nothing: a detached node
 * reporting `scrollTop` 0 in the cleanup, StrictMode consuming a `popstate` flag, a delta-based
 * takeover check mistaking layout settling for a finger. A source-level guard would have passed on
 * all four.
 */

/** The one container that actually scrolls on these screens. */
const scrollTop = () => `Math.max(0, ...[...document.querySelectorAll('*')]
  .filter(e => e.scrollTop > 0).map(e => e.scrollTop))`

async function scrollDown(page: import('@playwright/test').Page, steps = 7) {
  await page.mouse.move(200, 400)
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(80) }
  await page.waitForTimeout(700)
}

test.describe('scroll position survives a push and back', () => {
  for (const [route, linkText] of [['/health', /Sleep/], ['/more', /Profile details/]] as const) {
    test(`${route} returns to the same offset`, async ({ page }) => {
      await page.goto(route)
      // These screens seed from cache and revalidate, so give the content its height before
      // scrolling — the restore is gated on the container being tall enough for the saved offset.
      await page.waitForTimeout(4000)
      await scrollDown(page)
      const before = await page.evaluate(scrollTop())
      expect(before, 'nothing scrolled — the fixture is too short to test restoration').toBeGreaterThan(200)

      await page.locator('a, button').filter({ hasText: linkText }).first().evaluate(el => (el as HTMLElement).click())
      await page.waitForTimeout(2500)
      // Assert the setup actually happened. A spec that does not check its own precondition fails
      // for the wrong reason and sends you debugging the feature instead of the fixture.
      expect(new URL(page.url()).pathname, 'the tap did not navigate').not.toBe(route)
      const saved = await page.evaluate(() => JSON.stringify(Object.fromEntries(
        Object.keys(sessionStorage).filter(k => k.startsWith('ta_scroll:')).map(k => [k, sessionStorage.getItem(k)]))))
      expect(saved, 'nothing was saved on unmount').toContain('ta_scroll:')
      await page.goBack()

      // `toPass` rather than a fixed wait: the restore fires when the content reaches the saved
      // height, which is whenever the revalidation lands.
      await expect(async () => {
        expect(await page.evaluate(scrollTop())).toBe(before)
      }).toPass({ timeout: 20_000 })
    })
  }

  test('a fresh forward arrival still starts at the top', async ({ page }) => {
    // The saved offset is consumed by the restore, so arriving with nothing stored starts at 0 by
    // construction. Asserted because the obvious alternative design — gating on a `popstate` flag —
    // is the one that broke under StrictMode, and someone may reach for it again.
    await page.goto('/health')
    await page.waitForTimeout(4000)
    await scrollDown(page)
    await page.goto('/nutrition')
    await page.waitForTimeout(2500)
    await page.goto('/health')
    await page.waitForTimeout(4000)
    // A full document navigation drops sessionStorage's in-memory state? No — it survives, so this
    // is a real check that the entry was consumed rather than an artefact of losing it.
    expect(await page.evaluate(scrollTop())).toBeLessThan(200)
  })
})
