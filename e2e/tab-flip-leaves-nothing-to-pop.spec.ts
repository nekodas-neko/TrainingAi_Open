import { test, expect } from '@playwright/test'

/**
 * LB-107's premise, measured in a real browser rather than reasoned from the source.
 *
 * The owner asked: *"when you press back on a tab and there is no where to go it should go to
 * the home screen."* The entry could not say WHY a tab had nothing to pop — that was the part
 * marked "not known yet, and must be measured before anything is changed".
 *
 * This is the measurement. `tab-shell.tsx` flips tabs with `history.replaceState` (tabs are
 * peers, not a trail), so a tab flip changes the URL and adds NO history entry — which is what
 * makes `history.back()` a silent no-op there. The fix keys off exactly that.
 *
 * **The back gesture itself is deliberately not tested here.** Capacitor's `backButton` listener
 * is native and the harness cannot send the S25's system gesture; `page.goBack()` is a different
 * code path. What is pinnable is the premise, and the premise is what would decay: if a tab flip
 * ever became a push, routing a tab back to Home would start skipping a real history entry.
 */

const LEN = () => window.history.length

test.describe('a tab flip replaces, a sub-route pushes', () => {
  test('flipping tabs changes the URL without growing the history stack', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('nav').first()).toBeVisible()

    for (const label of ['Health', 'Nutrition', 'More']) {
      const before = await page.evaluate(LEN)
      const urlBefore = page.url()

      await page.locator('nav').getByRole('link', { name: label, exact: true }).click()
      await page.waitForFunction((u) => window.location.href !== u, urlBefore)

      const after = await page.evaluate(LEN)
      // Precondition: a click that did nothing must fail here rather than pass the length check
      // trivially. A silent no-op click has cost this repo a CI run before.
      expect(page.url(), `the ${label} tab did not navigate`).not.toBe(urlBefore)
      expect(after, `flipping to ${label} pushed a history entry — back would no longer be a no-op`)
        .toBe(before)
    }
  })

  test('a push to a sub-route does grow the stack, which is why those still pop', async ({ page }) => {
    await page.goto('/health')
    await expect(page.locator('nav').first()).toBeVisible()

    const before = await page.evaluate(LEN)
    await page.goto('/health/day')
    const after = await page.evaluate(LEN)

    expect(after, 'a real navigation left the stack unchanged — the contrast this spec rests on is gone')
      .toBeGreaterThan(before)
  })
})
