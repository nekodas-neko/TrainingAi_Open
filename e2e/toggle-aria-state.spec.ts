import { test, expect } from '@playwright/test'
import { settleRouteBoundary, tapCentre } from './fixtures'

/**
 * Q-491 — a click-toggled control says which state it is in (`aria-expanded` / `aria-pressed`).
 *
 * **The assertion is that the value FLIPS, which is the half a static check cannot reach.** The
 * ratchet (`scripts/check-toggle-aria.js`) can see that an attribute exists; only a browser can show
 * that it tracks the state rather than being hardcoded, and that `aria-controls` names an element
 * that is actually in the document. A toggle wired with `aria-expanded={true}` on both branches
 * passes every grep and tells a screen reader nothing.
 *
 * Home's reorder button is the case worth pinning in a spec: it is a **mode** toggle, so its
 * attribute is `aria-pressed`, and the earlier version of this ratchet would have pushed
 * `aria-expanded` onto it. That distinction is the entry's whole finding.
 *
 * Not exercised here: TalkBack itself, which is the entry's own outstanding device check — an
 * attribute being correct in the DOM is not the same as the announcement reading well.
 */
test('Home\'s reorder toggle reports its mode, and the value tracks the state', async ({ page }) => {
  await page.goto('/')
  await settleRouteBoundary(page)

  const reorder = page.getByRole('button', { name: 'Reorder sections' })
  await expect(reorder).toBeVisible({ timeout: 60_000 })

  // `aria-pressed`, not `aria-expanded`: it puts the sections into reorder mode rather than
  // revealing a region, and naming the wrong one is worse than naming neither.
  await expect(reorder).toHaveAttribute('aria-pressed', 'false')
  await expect(reorder).not.toHaveAttribute('aria-expanded', /.*/)

  await tapCentre(page, reorder)
  await expect(reorder).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

  await tapCentre(page, reorder)
  await expect(reorder).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 })
})
