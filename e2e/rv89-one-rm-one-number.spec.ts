import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// RV-89. One stored 1RM rendered four different numbers. The pre-workout list row hand-rolled
// `est 1RM ~${Math.round(v)}kg` while the stats sheet one tap below it hand-rolled
// `${v.toFixed(1)} kg` — so the seeded 92 read as "~92kg" on the row and "92.0 kg" in the sheet,
// and the ready screen's `mround125` turned the same 92 into 92.5.
//
// Two surfaces one tap apart is what makes this checkable end to end: the assertion is that the
// row and the sheet agree, which no unit test over either file alone can state.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test('the pre-workout row and the stats sheet print the same 1RM', async ({ page }) => {
  await page.goto('/workout', { waitUntil: 'networkidle' })

  const row = page.locator('p', { hasText: /est 1RM/ }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  const rowText = (await row.innerText()).replace(/\s+/g, ' ')

  // `~` and a missing space were the tell that this row rounded on its own.
  expect(rowText, 'the list row still carries its own approximation marker').not.toContain('~')
  const rowRm = rowText.match(/est 1RM ([\d.]+) kg/)
  expect(rowRm, `no "est 1RM <n> kg" in ${JSON.stringify(rowText)}`).not.toBeNull()

  await row.evaluate(el => (el.closest('button') as HTMLElement | null)?.click())

  const allTime = page.locator('span', { hasText: /All-time:/ }).first()
  await expect(allTime).toBeVisible({ timeout: 15_000 })
  const sheetRm = (await allTime.innerText()).match(/All-time: ([\d.]+) kg/)
  expect(sheetRm, 'no "All-time: <n> kg" in the stats sheet').not.toBeNull()

  // The sheet's all-time is the best of the history and the row's is the latest, so they are not
  // required to be EQUAL — but both are stored 1RMs, so both must be formatted the same way.
  // A trailing ".0" or ".3" on one and not the other is the defect.
  expect(sheetRm![1], 'the sheet prints a different precision from the row it opened from')
    .toMatch(/^\d+(\.\d{1,2})?$/)
  const decimals = (s: string) => (s.split('.')[1] ?? '').length
  expect(decimals(sheetRm![1]), 'the stats sheet pads to one decimal (toFixed(1)); the row does not')
    .toBe(decimals(rowRm![1]))
})
