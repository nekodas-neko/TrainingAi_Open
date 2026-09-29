import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

/**
 * LB-186 — adding an exercise in the program editor used to create the slot with no progression
 * style, and no layer below objected: the type marks `styleId` optional, the route only checks a
 * *provided* id, and the save writes `styleId ?? null`. A styleless slot looks fine while the
 * exercise has styled history and then bites on any path that needs a non-empty style — the deload
 * override skipped one and prescribed an ordinary working weight in a deload week (BF-200).
 *
 * WHICH style is chosen belongs to the unit test (`components/config/__tests__`). What only a
 * browser can show is that the row the editor renders for a brand-new exercise arrives with a style
 * already selected, and that the picker still offers the way back out.
 *
 * The program here is one this spec BUILDS and never saves, for two reasons: the style picker only
 * renders in the Linear approach, and the Training Approach control only exists while creating, so
 * reading it off the seeded program would make the assertion depend on a `phase_mode` any earlier
 * spec in the same run can change (it reads `ai_dynamic` in this sandbox's database today).
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test('an exercise added in the editor arrives with a style already chosen', async ({ page }) => {
  await page.goto('/program', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Build from scratch/ }).click()
  await expect(page.getByRole('button', { name: 'Save Program' })).toBeVisible({ timeout: 30_000 })

  // Linear is the approach whose sets come from a per-exercise style, so it is the one that shows
  // the picker this entry is about.
  await page.getByRole('button', { name: 'Linear', exact: true }).click()
  await page.getByRole('button', { name: 'Add Session' }).click()
  await page.getByRole('button', { name: 'Add Exercise' }).click()

  // The style picker, found by the option only it carries — the editor's other selects do not.
  const picker = page.locator('select').filter({ hasText: 'No style (default sets)' })
  await expect(picker).toHaveCount(1)
  await expect(picker).not.toHaveValue('')

  // The default is a starting point, not a decision: the row can still be set back to no style.
  await picker.selectOption('')
  await expect(picker).toHaveValue('')
})
