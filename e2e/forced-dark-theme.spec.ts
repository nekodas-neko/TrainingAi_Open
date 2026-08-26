import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * The app is dark, and the operating system cannot change that (BF-25).
 *
 * **This whole class of bug is invisible unless the browser is actually set to light**, which is why
 * it survived: the provider ran `defaultTheme="system" enableSystem`, nobody ever called `setTheme`,
 * and every machine anyone developed or tested on was dark. Light mode was not a preference — it was
 * what the app became if the S25 was ever switched over. So every assertion here runs under
 * `colorScheme: 'light'`; under the default they would pass against the un-pinned build too.
 *
 * The three properties asserted are the three that can each fail alone:
 *
 * 1. **The `.dark` class is on `<html>`.** `next-themes` stamps it from an inline script before
 *    React hydrates — with `forcedTheme` it applies the value directly instead of reading
 *    `localStorage` and `matchMedia` first. Three components document depending on that timing.
 * 2. **`resolvedTheme` reports dark**, checked through the surface that consumes it rather than the
 *    hook. `forcedTheme` alone governs only the class: `theme`/`resolvedTheme` keep resolving
 *    through `matchMedia`, so `detail-hero.tsx` would have painted its light gradient over a dark
 *    page and `sonner.tsx` light toasts. That is what `defaultTheme`/`enableSystem` are for here.
 * 3. **The painted background is actually dark.** The class can be right while something else paints
 *    light, and the class assertion alone would not notice.
 */

test.use({ colorScheme: 'light' })

const ROUTES = ['/', '/nutrition']

for (const route of ROUTES) {
  test(`${route} renders dark on a light-set device`, async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto(route)

    // Before settling: the class comes from the pre-hydration script, so it must already be there.
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)light(\s|$)/)

    await settleRouteBoundary(page)
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)

    // `enableColorScheme` — what native scrollbars and form controls read.
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')

    // And the paint itself. A dark background is a low-luminance one; the exact token can change
    // without this needing to.
    const luminance = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor
        .match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    })
    expect(luminance, 'the body painted a light background under a light OS setting').toBeLessThan(0.3)
  })
}

/**
 * The assertion that catches the *plausible* version of this change.
 *
 * `forcedTheme="dark"` on its own — the one-line fix BF-25 prescribed — passes every assertion
 * above: it governs the class on `<html>`, so the page root paints dark. It does **not** touch
 * `resolvedTheme`, which keeps resolving through `matchMedia`, and `detail-hero.tsx` reads that to
 * choose between two hand-illustrated palettes. Measured on this screen under a light OS with only
 * the one prop set: the hero art came out `rgb(255, 225, 225)` — pale pink — under a
 * `rgba(255, 255, 255, 0.92)` scrim, i.e. a white readability layer beneath white text, over a dark
 * page. That is the exact bug this change exists to close, shipped by the change meant to close it.
 */
test('the hero art and its scrim are the dark pair, not just the page behind them', async ({ page }) => {
  await page.goto('/health/heart-rate')
  await settleRouteBoundary(page)

  const layers = await page.evaluate(() => {
    const out: string[] = []
    for (const el of [...document.querySelectorAll('*')] as HTMLElement[]) {
      const bg = getComputedStyle(el).backgroundImage
      if (bg.includes('linear-gradient')) out.push(bg)
    }
    return out
  })
  expect(layers.length, 'no gradient layers found — the hero did not render').toBeGreaterThan(1)

  // Every gradient stop on the screen must be dark. The light palettes are kept in source on
  // purpose (they cost nothing unreachable), so the guard is that none of them is reachable.
  for (const layer of layers) {
    for (const [, r, g, b] of layer.matchAll(/rgba?\((\d+), ?(\d+), ?(\d+)/g)) {
      const luminance = (0.2126 * +r + 0.7152 * +g + 0.0722 * +b) / 255
      expect(luminance, `a light gradient stop is painting: ${layer.slice(0, 90)}`).toBeLessThan(0.5)
    }
  }
})

test('the media query the app used to follow still reports light', async ({ page }) => {
  // The control. Without it, a harness that silently stopped emulating light would make every
  // assertion above vacuous while still passing.
  await page.goto('/')
  expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(false)
})
