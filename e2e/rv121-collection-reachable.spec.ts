import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-121 — `/collection` is reachable from the More tab without enabling a Home widget.
 *
 * The route had exactly one door before this: a link inside the collection Home card, which
 * returns `null` unless that widget is on, and `DEFAULT_CARD_WIDGETS` is `[]`. The owner chose a
 * permanent More-tab address over turning the card on by default.
 *
 * This is a spec rather than a source scan because the claim is a runtime one — the row renders on
 * the seeded account with no preference set, and tapping it lands on the collection screen. The
 * vitest file guards the same rule structurally, since the E2E job is advisory.
 */

// Crosses `/more` and `/collection`, each compiling on first use against `pnpm dev`.
test.setTimeout(180_000)

test('the More tab reaches the collection with no widget enabled', async ({ page }) => {
  await page.goto('/more')
  await settleRouteBoundary(page)

  const row = page.getByRole('button', { name: 'Collection', exact: true })
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.click()

  await page.waitForURL('**/collection', { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible({ timeout: 30_000 })
})
