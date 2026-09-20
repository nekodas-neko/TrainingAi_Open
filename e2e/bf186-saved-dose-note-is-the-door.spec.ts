import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { STORAGE_STATE, settleRouteBoundary } from './fixtures'

/**
 * BF-186 — the saved-dose note is its own door to the manage sheet.
 *
 * Owner, after the app told him where to change his saved dose: *"I dont see a manage supplements
 * section to change the default to 1mg."* Three things stacked to make the instruction
 * unfollowable, and a search for the literal phrase was always going to fail:
 *
 * 1. the note said **"Manage supplements"** where the control says **"Manage"**, alone;
 * 2. the control is a 10 px muted header affordance beside a 10 px "Supplements" label it matches;
 * 3. it lives on the screen *behind* the sheet giving the instruction.
 *
 * So the note stopped naming a destination and became one. **What this spec pins is the wiring and
 * the words** — that tapping the note reaches the manage sheet, and that the dead phrase is gone
 * from the rendered copy. It cannot pin the hit area: the tap-target fix is a `::before` box and
 * `domClick` bypasses hit-testing entirely (see `vial-dose-calculator.spec.ts` for why synthetic
 * input cannot reach these handlers at all). **The 44 px target is owed on the device.**
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })
test.setTimeout(150_000)

const NAME = 'Manage Door E2E'

test.afterAll(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      `DELETE FROM supplement_vials WHERE supplement_id IN (SELECT id FROM supplements WHERE name = $1)`,
      [NAME],
    )
    await db.query('DELETE FROM supplements WHERE name = $1', [NAME])
  } finally { await db.end() }
})

/** Synthetic input does not reach these handlers — measured in `vial-dose-calculator.spec.ts`. */
async function domClick(locator: import('@playwright/test').Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 })
  await locator.evaluate((el: HTMLElement) => el.click())
}

const dialog = (page: import('@playwright/test').Page, title: string) =>
  page.getByRole('dialog').filter({ hasText: title })

test('the saved-dose note opens the manage sheet, instead of naming a screen that is not there', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // A milligram-dosed supplement is what carries the vial control, so create one.
  await domClick(page.getByRole('button', { name: 'Manage' }))
  await expect(dialog(page, 'Manage Supplements')).toBeVisible({ timeout: 15_000 })
  await domClick(page.getByRole('button', { name: 'Add Supplement' }))
  await page.getByPlaceholder('e.g. Creatine').fill(NAME)
  await page.getByPlaceholder('e.g. 5', { exact: true }).fill('0.5')
  await page.getByPlaceholder('mg', { exact: true }).fill('mg')
  await domClick(page.getByRole('button', { name: 'Save', exact: true }))
  await page.keyboard.press('Escape')
  await expect(dialog(page, 'Manage Supplements')).toBeHidden({ timeout: 15_000 })

  await domClick(page.getByRole('button', { name: `Vial and dose calculator for ${NAME}` }))
  await expect(dialog(page, `${NAME} — vial & dose`)).toBeVisible({ timeout: 15_000 })

  // The note states the saved dose and stops there — no destination named in words.
  await expect(page.getByText('Your saved dose is 0.5 mg.')).toBeVisible()
  await expect(
    page.getByText(/Manage supplements, under Amount/),
    'the note still names a screen that does not exist by that name — the BF-186 wording',
  ).toHaveCount(0)

  // The note IS the door.
  const changeIt = page.getByRole('button', { name: 'Change it' })
  await expect(changeIt, 'the saved-dose note carries no control, so the dose stays unreachable').toBeVisible()
  await domClick(changeIt)

  await expect(
    dialog(page, 'Manage Supplements'),
    'tapping the note did not reach the manage sheet',
  ).toBeVisible({ timeout: 15_000 })
  // The sheet it was tapped from gets out of the way rather than stacking behind.
  await expect(dialog(page, `${NAME} — vial & dose`)).toHaveCount(0)
})
