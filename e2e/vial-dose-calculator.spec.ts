import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { formatDateDisplay } from '@trainingai/shared/date-utils'
import { SEED_EMAIL, STORAGE_STATE, settleRouteBoundary } from './fixtures'

/**
 * OR-102b ①② — the vial's concentration and the syringe units for a dose.
 *
 * The figures asserted are the ones OR-102b verified against the owner's own third-party
 * calculator: a 10 mg vial in 3 mL is 3.33 mg/mL, and 0.5 mg of it is 0.15 mL — 15 units on a U-100
 * barrel. The unit test pins the arithmetic; what only a browser can show is that the control is
 * reachable and the numbers reach the screen.
 *
 * The supplement is one this spec creates, so nothing here depends on what the seed holds.
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

// The tap loop below needs room for several attempts, and the default 45 s cannot hold them.
test.setTimeout(150_000)

const NAME = 'Vial E2E'
const VIAL_NAME = NAME

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/**
 * The supplement this spec creates is removed afterwards.
 *
 * It was not, and on a database that survives between runs — every local one — the second run found
 * two rows called `Vial E2E` and the trigger locator failed on a strict-mode violation. CI never
 * showed it because CI gets a fresh database, so the cost lands entirely on whoever runs the suite
 * twice. Deleted by name because the id is the app's, not this spec's.
 */
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

test('the calculator shows its working, and the owner-verified draw', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // A milligram-dosed supplement is what carries the control, so create one.
  //
  await openSheet(page, page.getByRole('button', { name: 'Manage' }), 'Manage Supplements')
  await domClick(page.getByRole('button', { name: 'Add Supplement' }))
  await page.getByPlaceholder('e.g. Creatine').fill(NAME)
  await page.getByPlaceholder('e.g. 5', { exact: true }).fill('0.5')
  await page.getByPlaceholder('mg', { exact: true }).fill('mg')
  await domClick(page.getByRole('button', { name: 'Save', exact: true }))

  // Saving returns to the manage list; the sheet itself stays open over the row we need next.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog').filter({ hasText: 'Manage Supplements' })).toBeHidden({ timeout: 15_000 })

  await openSheet(
    page,
    page.getByRole('button', { name: `Vial and dose calculator for ${NAME}` }),
    `${NAME} — vial & dose`,
  )

  await page.getByLabel('Peptide (mg)').fill('10')
  await page.getByLabel('Bac water (mL)').fill('3')

  // The division, not only the result — a concentration cannot be checked from its answer alone.
  await expect(page.getByText('10 mg ÷ 3 mL = 3.33 mg/mL')).toBeVisible()

  await page.getByLabel('Try a dose (mg)').fill('0.5')
  await expect(page.getByText('0.5 mg ÷ 3.33 mg/mL = 0.15 mL → 15 units')).toBeVisible()
  await expect(page.getByText('20 doses this size in the vial.')).toBeVisible()

  // A dose that will not fit the barrel says so rather than printing an undrawable number.
  await page.getByLabel('Try a dose (mg)').fill('4')
  await expect(page.getByText('That is more than one 100-unit barrel holds.')).toBeVisible()
})

/**
 * Opens a sheet whose trigger lives inside the Nutrition tab's day-tools section.
 *
 * **It dispatches a DOM click rather than a synthetic one, and that is measured, not superstition.**
 * Playwright's `click()` and `touchscreen.tap()` do not reach these handlers: the sheet stays closed
 * through ~18 retried taps over 90 s, with the button focused, no page error and no console error —
 * while `el.click()` on the same locator opens it inside 50 ms. A sibling trigger elsewhere on the
 * same screen (`My Foods`) opens under synthetic input normally, so this is specific to this section
 * rather than to the tab or to the run.
 *
 * The cost of the workaround is that this spec no longer proves the control is hittable — only that
 * it is wired and that what it opens is correct. The hit test is owed on the device.
 */
/** Synthetic input does not reach these handlers — see `openSheet` for the measurement. */
async function domClick(locator: import('@playwright/test').Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 })
  await locator.evaluate((el: HTMLElement) => el.click())
}

async function openSheet(
  page: import('@playwright/test').Page,
  trigger: import('@playwright/test').Locator,
  title: string,
): Promise<void> {
  await expect(trigger).toBeVisible({ timeout: 60_000 })
  await domClick(trigger)
  await expect(page.getByRole('dialog').filter({ hasText: title })).toBeVisible({ timeout: 15_000 })
}

/**
 * BF-153 — the sheet says which vial each thing belongs to, and which numbers it will keep.
 *
 * The owner had this screen open with the right figures on it and asked *"Can you explain how this
 * works? Where am I meant to update the dose?"* Two things made that reasonable. `Dose` was a
 * calculator input that `save()` never posts — the body is `{ ...draft, openedOn }` and `doseMg` is
 * not in `draft` — while the dose it looked like sits on the definition, in another sheet, under
 * another word. And two dates were on screen five lines apart, both correct, with nothing saying
 * they belong to different vials: the create-form's input defaults to **today** because it opens a
 * NEW vial (BF-136, and it must stay that way), the note below it reads the vial he already has.
 *
 * So this seeds a vial dated well before today and asserts the screen tells them apart.
 */
test('the sheet names the vial in use, and says the dose field is not saved', async ({ page }) => {
  // A stored vial is what makes the two dates coexist, and the sheet only ever reads `vials[0]`.
  // Dated in the past deliberately: equal to today, the defect this covers would be invisible.
  const opened = await withDb(async db => {
    const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const { rows: sups } = await db.query<{ id: string }>(
      'SELECT id FROM supplements WHERE name = $1 AND user_id = $2', [VIAL_NAME, users[0].id])
    expect(sups[0]?.id, `${VIAL_NAME} was not created — did the first test run?`).toBeTruthy()
    const { rows } = await db.query<{ opened_on: string }>(
      `INSERT INTO supplement_vials (user_id, supplement_id, strength_mg, water_ml, syringe_units_per_ml, opened_on)
       VALUES ($1, $2, 10, 3, 100, (CURRENT_DATE - INTERVAL '9 days')::date)
       RETURNING to_char(opened_on, 'YYYY-MM-DD') AS opened_on`,
      [users[0].id, sups[0].id])
    return rows[0].opened_on
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await openSheet(
    page,
    page.getByRole('button', { name: `Vial and dose calculator for ${VIAL_NAME}` }),
    `${VIAL_NAME} — vial & dose`,
  )
  const sheet = page.getByRole('dialog').filter({ hasText: `${VIAL_NAME} — vial & dose` })

  // The vial he has, named as such and carrying ITS date — above the form, not below it.
  await expect(sheet.getByRole('heading', { name: "The vial you're using" })).toBeVisible({ timeout: 15_000 })
  // Through the same formatter the note uses. Asserting a raw date shape here fails on a screen
  // that is correct — it renders `4 Sept`, not `04/09/2026`.
  await expect(sheet.getByText(`Measured from ${formatDateDisplay(opened)}`)).toBeVisible()

  // The form, named for what the button does rather than for what is on screen.
  await expect(sheet.getByRole('heading', { name: 'Open a new vial' })).toBeVisible()

  // And the two dates are different values, which is the whole reason they needed telling apart.
  const formDate = await sheet.getByLabel('Opened on').inputValue()
  expect(formDate, 'the form inherited the stored date — BF-136 says it must default to today')
    .not.toBe(opened)

  // The calculator says it is a calculator, and points at where the dose actually lives.
  await expect(sheet.getByRole('heading', { name: 'Work out the units' })).toBeVisible()
  await expect(sheet.getByLabel('Try a dose (mg)')).toBeVisible()
  await expect(sheet.getByText(/Not saved — this only works out what to draw/)).toBeVisible()
  await expect(sheet.getByText(/Your saved dose is 0.5 mg, changed in Manage supplements, under Amount/)).toBeVisible()

  // The destructive case, said before the press. A second vial restarts the response window and
  // cannot be undone by dating a third one earlier — it would sort below.
  await expect(sheet.getByText(/This opens a second vial and restarts the response window/)).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Save as a new vial' })).toBeVisible()
})
