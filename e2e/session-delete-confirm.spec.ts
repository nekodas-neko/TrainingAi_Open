import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

/**
 * BF-132 — the trash icon on a session in the program editor used to be a one-line array filter
 * fired straight from the tap. The owner lost a whole session and its exercise list to a mis-tap.
 *
 * The session under test is one this spec ADDS, so the assertions do not depend on what the seed
 * happens to hold, and nothing here presses Save — the edit stays local and the seeded program is
 * left as it was found. The prompt's exercise-count wording is covered by the unit test; what only
 * a browser can show is the wiring: that a tap opens the dialog rather than deleting, that Keep
 * keeps, and that the undo actually puts the session back.
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

const NAME = 'Delete Me E2E'

test('deleting a session asks first, and the delete can be undone', async ({ page }) => {
  await page.goto('/program', { waitUntil: 'networkidle' })
  await page.locator('button[aria-label^="Edit "]').first().click()
  await expect(page.getByRole('button', { name: 'Save Program' })).toBeVisible({ timeout: 30_000 })

  // A session of this spec's own, so the trash control is guaranteed to be present (it hides when
  // only one session is left) and the expected prompt is exact.
  await page.getByRole('button', { name: 'Add Session' }).click()
  const nameFields = page.locator('input[placeholder="Session name (e.g. Push)"]')
  await nameFields.last().fill(NAME)
  const before = await nameFields.count()

  const trash = page.locator('button[title="Remove session"]')
  await trash.last().click()

  // Nothing is deleted yet, and the dialog names what would be.
  await expect(page.getByText(`Delete ${NAME}?`)).toBeVisible()
  await expect(nameFields).toHaveCount(before)

  await page.getByRole('button', { name: 'Keep' }).click()
  await expect(page.getByText(`Delete ${NAME}?`)).toBeHidden()
  await expect(nameFields).toHaveCount(before)

  await trash.last().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(nameFields).toHaveCount(before - 1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(nameFields).toHaveCount(before)
  // The DOM `value` attribute does not track a controlled input, so read the live value instead.
  expect(await nameFields.last().inputValue()).toBe(NAME)
})
