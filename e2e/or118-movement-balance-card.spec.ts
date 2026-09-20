import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * OR-118 — the push/pull/legs split over sixty days, on the Health tab's Training list.
 *
 * **The numbers were unreachable before this, which is why the card exists.** Every other
 * muscle-set route computes the CURRENT week and takes no window; `muscle-tonnage-trend` is windowed
 * but reports tonnage, which overstates legs. `/api/muscle-sets` (LB-111) shipped the read and had
 * no caller until now, and `movementPattern()` (LB-103) shipped the grouping and had none either.
 *
 * **What this can and cannot prove.** The arithmetic is pinned by
 * `components/health/__tests__/movement-balance.test.ts`, mutation-checked four ways. This asserts
 * the half a unit test cannot see: that the card is mounted in the Training list and renders all
 * four patterns at the S25 width.
 *
 * **It deliberately refuses the empty state**, and the fixture is why that is safe. `seed.sql`
 * logs Bench Press at 2, 3 and 5 days ago with `muscle_groups = '{chest}'` — nine sets, all of them
 * **push** — so a fresh CI database lands inside the sixty-day window with one pattern populated
 * and three at zero. That is the best fixture this card could ask for: it exercises the rendering
 * path *and* the zero-row case in the same run. Accepting the empty state instead would be the
 * LB-98 trap — a spec that can only ever assert "nothing here", while the path that actually draws
 * the bars ships unexercised.
 */
test.use({ serviceWorkers: 'block' })
test.setTimeout(120_000)

test('the movement balance card renders on the Training list', async ({ page }) => {
  await suppressMorningCheckin(page)
  await page.goto('/health')
  await settleRouteBoundary(page)

  await page.getByRole('tab', { name: 'Training' }).evaluate((el: HTMLElement) => el.click())

  // Prove the Training panel actually rendered before reading anything into what is on it — an
  // empty screen would pass every assertion below vacuously, which is this file's sibling trap.
  await expect(
    page.getByText(/Muscle Volume|Workout Density/).first(),
    'the Training panel never rendered, so nothing below means anything',
  ).toBeVisible({ timeout: 60_000 })

  const card = page.getByText('Movement Balance', { exact: true })
  await expect(card, 'the card is not mounted in the Training list').toBeVisible({ timeout: 60_000 })

  // The seed puts nine chest sets inside the window, so the empty state here is a fixture
  // regression rather than a legitimate outcome — say which, because the two need different fixes.
  await expect(
    page.getByText(/No sets logged in the last 60 days/),
    'the card rendered its empty state against a seed that logs nine chest sets in-window — the fixture moved, or the window/attribution broke',
  ).toHaveCount(0)

  for (const label of ['Push', 'Pull', 'Legs', 'Core & other']) {
    await expect(
      page.getByText(label, { exact: true }).first(),
      `${label} is missing — a zero row must still render, because an empty pull column IS the finding`,
    ).toBeVisible()
  }

  // The window is the claim the card makes about itself; a wrong one here is a false statement.
  await expect(page.getByText('Last 60 days', { exact: true }).first()).toBeVisible()
})
