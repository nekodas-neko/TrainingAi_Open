import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary, tapCentre } from './fixtures'

/**
 * BF-109 — the Review sheet flags macros that disagree with the stated calories.
 *
 * The owner scanned barcode `9350167000490` and got **173 kcal** beside 45.7 P / 52.1 C / 13.6 F —
 * macros that come to **514** by Atwater. The screen was right and the row was wrong: Open Food
 * Facts is filled in field by field, and that product's energy is wrong at source.
 *
 * **This spec exists because the unit guards cannot see the thing that matters.** They assert the
 * shared check's arithmetic and that `review-step.tsx` contains the component next to the Calories
 * field — neither of which renders anything. A source scan cannot tell a warning that appears from
 * one that throws on mount, is painted under the sheet, or never crosses its own threshold with the
 * real values in the real fields. Every assertion below is against the rendered sheet.
 *
 * The manual-entry road is used rather than a barcode because a barcode needs a camera; it reaches
 * the identical `ReviewStep` with the identical props, which is the surface under test.
 */

const OWNERS_SCAN = { Calories: '173', Protein: '45.7', Carbohydrates: '52.1', Fat: '13.6' }
/** A real food whose numbers agree — 500 kcal against 502 by Atwater, well inside the 15% limit. */
const AGREES = { Calories: '500', Protein: '40', Carbohydrates: '45', Fat: '18' }

async function openManualReview(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const myFoods = page.getByRole('button', { name: 'My Foods', exact: true })
  await expect(myFoods).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Only while the sheet is still closed — this button opens Log Food, which then covers the
    // coordinate, so an unconditional re-tap lands on the sheet's own content (Q-395c).
    if (await page.getByRole('dialog').count() === 0) await tapCentre(page, myFoods)
    await expect(page.getByRole('button', { name: 'Describe or enter' })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await tapCentre(page, page.getByRole('button', { name: 'Describe or enter' }))
  const manual = page.getByRole('button', { name: 'Know the numbers? Enter them yourself' })
  await expect(manual).toBeVisible({ timeout: 15_000 })
  await tapCentre(page, manual)

  // The Review step is up when its own fields are, not when the tap lands.
  await expect(page.getByRole('spinbutton', { name: 'Calories', exact: true })).toBeVisible({ timeout: 15_000 })
}

async function enter(page: Page, values: Record<string, string>): Promise<void> {
  for (const [label, v] of Object.entries(values)) {
    await page.getByRole('spinbutton', { name: label, exact: true }).fill(v)
  }
}

test('the owner\'s row is flagged, and the correction is a tap that changes the field', async ({ page }) => {
  await openManualReview(page)
  await enter(page, OWNERS_SCAN)

  // 1. It says the Atwater figure, in words. `514` and not merely "these look wrong" — the entry's
  //    whole point is that the user has to be able to decide, which needs the other number.
  const warning = page.getByText('These macros come to 514 kcal, not 173.')
  await expect(warning, 'a 197% disagreement must be flagged').toBeVisible({ timeout: 10_000 })

  // 2. Declining it leaves the label's own number alone. Asserted BEFORE the tap, because a
  //    component that rewrote on mount would already have changed this and still pass step 3.
  await expect(page.getByRole('spinbutton', { name: 'Calories', exact: true }))
    .toHaveValue('173')

  // 3. The correction is the user's tap.
  await tapCentre(page, page.getByRole('button', { name: 'Use 514 kcal' }))
  await expect(page.getByRole('spinbutton', { name: 'Calories', exact: true }))
    .toHaveValue('514')

  // 4. And having taken it, there is nothing left to disagree about — a warning that outlived its
  //    own correction would train the user to ignore it.
  await expect(warning).toHaveCount(0)
})

test('a food whose numbers agree shows nothing at all', async ({ page }) => {
  await openManualReview(page)
  await enter(page, AGREES)

  // A positive anchor first. `toHaveCount(0)` on its own is satisfied by a sheet that failed to
  // render, which is the shape of absence-check that reads as coverage and is not.
  await expect(page.getByRole('spinbutton', { name: 'Calories', exact: true })).toHaveValue('500')
  await expect(page.getByText(/These macros come to/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Use \d+ kcal$/ })).toHaveCount(0)
})
