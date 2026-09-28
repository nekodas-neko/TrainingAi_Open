import { test, expect, type Page } from '@playwright/test'

/**
 * Home's strap chip draws the cell's low-water mark, not its resting reading (BF-215).
 *
 * The owner asked *"Strap battery is at 100... it was 30 last time I used it? Is this working?"* —
 * and it was. A CR2025 sags under a sustained BLE session and recovers at rest, so the resting
 * value stays high until the cell is nearly dead. The number that warns him is the sag; the number
 * he sees was the recovery.
 *
 * The chip has no room for a sentence — the header's left column measures 224 px at 412 dp — so
 * the drawn glyph is the number and the accessible name is where it says what the number IS. That
 * split is BF-139's and this must not break it.
 */

const KEY = 'ta_strap_battery_v1'

async function seedStrap(page: Page, v: Record<string, number>) {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key as string, JSON.stringify(value))
  }, [KEY, v] as const)
}

test('a cell that sagged shows the sag, with the resting value named beside it', async ({ page }) => {
  const now = Date.now()
  await seedStrap(page, { percent: 100, at: now - 60_000, min: 30, minAt: now - 2 * 86_400_000 })
  await page.goto('/')

  // The regression: before BF-215 this drew 100, the one reading that never warns.
  const chip = page.getByRole('img', { name: /^Strap battery/ })
  await expect(chip).toBeVisible({ timeout: 30_000 })
  await expect(chip).toContainText('30')
  await expect(chip).not.toContainText('100')

  // And it must not present the mark as a live level — that would be the same defect in reverse.
  await expect(chip).toHaveAttribute('aria-label', /Strap battery 30% at its lowest .*, 100% at rest/)
})

test('a cell that has not sagged reads exactly as it did before', async ({ page }) => {
  const now = Date.now()
  await seedStrap(page, { percent: 88, at: now - 60_000, min: 88, minAt: now - 60_000 })
  await page.goto('/')

  const chip = page.getByRole('img', { name: /^Strap battery/ })
  await expect(chip).toBeVisible({ timeout: 30_000 })
  await expect(chip).toContainText('88')
  // No "at its lowest" clause when there is no sag to report: the mark IS the reading.
  await expect(chip).toHaveAttribute('aria-label', 'Strap battery 88%')
})

test('an entry written before BF-215 still renders, rather than vanishing', async ({ page }) => {
  await seedStrap(page, { percent: 64, at: Date.now() - 60_000 })
  await page.goto('/')
  const chip = page.getByRole('img', { name: /^Strap battery/ })
  await expect(chip).toBeVisible({ timeout: 30_000 })
  await expect(chip).toContainText('64')
})
