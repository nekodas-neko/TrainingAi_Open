import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * The status-bar scrim reaches a pushed route, not just the five tab panels (DV-22).
 *
 * DV-6 mounted it in `tab-shell.tsx`, which a pushed route is not inside, so `/health/sleep`
 * scrolled under the clock with no backing. Three separate things had to change and each fails
 * silently on its own — a missing scrim and a mis-scoped one look identical on the phone, which is
 * why this is asserted here rather than left to the device check.
 *
 * Opacity is written straight to the node, so that is what is read. What this canNOT show is
 * whether the gradient composites correctly on Samsung's WebView, or what it looks like against the
 * real status bar; that check is owed on the S25 and is stated as owed.
 */

const scrim = (page: Page): Locator => page.locator('div[aria-hidden="true"].fixed.top-0.z-40')

const opacity = (el: Locator) => el.evaluate(n => getComputedStyle(n).opacity)

async function settle(page: Page) {
  await page.waitForTimeout(400) // the fade is a 200ms transition
}

/** The screens fetch after paint, so height arrives late — wait for the content, not a guess. */
async function waitUntilScrollable(page: Page, selector: string | null) {
  await expect.poll(async () => page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : document.scrollingElement
    if (!el) return 0
    return el.scrollHeight - el.clientHeight
  }, selector), { timeout: 30_000 }).toBeGreaterThan(400)
}

test('a pushed route gets a scrim, and only once it has scrolled', async ({ page }) => {
  await page.goto('/health/sleep')
  await expect(scrim(page)).toBeAttached({ timeout: 30_000 })
  await settle(page)
  expect(await opacity(scrim(page)), 'nothing at rest — the owner chose a fade, not a strip').toBe('0')

  // A pushed route has no inner scroller: it scrolls the document, whose scroll event target is the
  // Document rather than an Element. That is the case the controller used to discard outright.
  await waitUntilScrollable(page, null)
  await page.evaluate(() => window.scrollTo(0, 400))
  await settle(page)
  expect(await opacity(scrim(page)), 'this is the DV-22 defect: no backing under the clock').toBe('1')

  await page.evaluate(() => window.scrollTo(0, 0))
  await settle(page)
  expect(await opacity(scrim(page))).toBe('0')
})

test('the tab panels still drive it, and a flip to a tab at the top clears it', async ({ page }) => {
  await page.goto('/health')
  await expect(scrim(page)).toBeAttached({ timeout: 30_000 })
  await settle(page)
  expect(await opacity(scrim(page))).toBe('0')

  const PANEL_SCROLLER = '[data-tab-active="true"] .overflow-y-auto'
  await waitUntilScrollable(page, PANEL_SCROLLER)
  const scrolled = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!(el instanceof HTMLElement)) return false
    el.scrollTop = 400
    return true
  }, PANEL_SCROLLER)
  expect(scrolled, 'the active panel must have a scroller — the shell scrolls inner containers').toBe(true)
  await settle(page)
  expect(await opacity(scrim(page)), 'DV-6 must not regress').toBe('1')

  // A tab flip fires no scroll event and does not move the router: the panel attribute is the only
  // signal, and losing it leaves the scrim painted over a tab sitting at the top.
  const nutrition = page.locator('nav a').filter({ hasText: /^Nutrition$/ }).first()
  const box = (await nutrition.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await settle(page)
  expect(await opacity(scrim(page)), 'the tab flipped to is at the top').toBe('0')
})
