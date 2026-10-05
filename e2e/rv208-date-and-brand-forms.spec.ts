import { test, expect } from '@playwright/test'
import { STORAGE_STATE, settleRouteBoundary, stableBox, tapInView } from './fixtures'

/**
 * RV-208 ④ and ⑤ in a browser — the halves the source guards cannot answer.
 *
 * ④ replaces the NARROWEST of three day-header forms with the WIDEST on the one surface where the
 * header shares its row with controls: Nutrition's date sits beside two 44 px chevrons and a
 * settings button, and a comment above it records that BF-24 collapsed that header from two bands
 * to one deliberately. `Sat, 26 Sept` → `Saturday 26 September` is +9 characters into a row with a
 * fixed budget, so whether it still holds one line at 384 px is a measurement, not a reading.
 *
 * ⑤ moves the brand off the name line and onto `FoodRow`'s secondary, which **truncates** where
 * the name line `line-clamp-2`s. So the change trades a possible truncation of the food name for a
 * possible truncation of the macros, and only a render says which one the real string hits.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 384, height: 854 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

test.describe('RV-208 ④ — the long date holds Nutrition’s one-band header at 384 px', () => {
  test('one line, inside its row, with the chevrons still beside it', async ({ page }) => {
    await page.goto('/nutrition')
    const prev = page.getByRole('button', { name: 'Previous day' })
    await expect(prev).toBeVisible({ timeout: 120_000 })
    // Two days back, so the label is a DATE — one day back is `Yesterday`, which is the relative
    // shortcut and would prove nothing about the form this entry settles.
    await prev.click()
    await prev.click()

    const label = page.locator('header span.text-\\[13px\\]').first()
    await expect(label).toBeVisible()
    // The long form, and no comma: `en-AU` puts one after a SHORT weekday only.
    await expect(label).toHaveText(/^[A-Z][a-z]+ \d{1,2} [A-Z][a-z]+$/)

    const box = await stableBox(label)
    const row = await stableBox(label.locator('..'))

    // ONE LINE. A 13 px line box is ~19.5 px, so a wrap doubles this — which is what would undo
    // BF-24's single band. Measured 148.0 × 19.5 for `Monday 28 September`.
    expect(box.height).toBeLessThan(26)
    // Inside its row, with room left for the two chevrons (44 px each) that share it.
    expect(box.width + 88).toBeLessThan(row.width)
    // And the row itself is still one text-height band, not two.
    expect(row.height).toBeLessThan(32)
  })
})

test.describe('RV-208 ⑤ — the food name leads and the brand follows it', () => {
  /**
   * The recents list is stubbed rather than seeded. `getLocalStore` returns null on the web
   * surface, so this route IS the source here — and a brand long enough to matter is the case
   * worth drawing, which no seed row would give.
   */
  const BRAND = 'Uncle Tobys'
  const NAME = 'Rolled Oats Quick Sachets'

  test('the row names the food first, and the brand rides the grey line under it', async ({ page }) => {
    await page.route('**/api/nutrition/recent-for-meal**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        id: 'c0ffee00-0000-4000-8000-000000000001',
        name: NAME, brand: BRAND,
        servingSizeG: 40, calories: 150, proteinG: 5, carbsG: 27, fatG: 3,
        source: 'manual', region: 'AU',
      }]),
    }))

    await page.goto('/nutrition')
    await settleRouteBoundary(page)
    await tapInView(page, page.getByRole('button', { name: 'Log Food' }))

    const row = page.getByRole('button', { name: new RegExp(NAME) }).first()
    await expect(row).toBeVisible({ timeout: 60_000 })

    // The name line is the food, and ONLY the food. Asserted as an exact text so a brand creeping
    // back in front of it fails here and not only in the source guard.
    const nameLine = row.locator('span.font-medium').first()
    await expect(nameLine).toHaveText(NAME)

    // The brand is on the grey line, leading it.
    const secondary = row.locator('span.text-muted-foreground').first()
    await expect(secondary).toHaveText(new RegExp(`^${BRAND} · `))

    // ⚠ The line this change puts the brand on is `truncate`, not `line-clamp-2`, so the real
    // question is whether the brand cost the rest of that line. `scrollWidth <= clientWidth` is
    // the only honest test of it — a truncated element still reports its full text, and
    // `toHaveText` above would pass on an ellipsis nobody can read.
    const clipped = await secondary.evaluate(
      (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped, `"${BRAND} · …" no longer fits FoodRow's secondary line at 384 px`).toBe(false)

    const nameBox = await stableBox(nameLine)
    const secBox = await stableBox(secondary)
    // And the grey line sits under the name rather than beside it — the stacked shape Q-406 settled.
    expect(secBox.y).toBeGreaterThan(nameBox.y)
  })
})
