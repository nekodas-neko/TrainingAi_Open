import { test, expect, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'
import { ZERO_DATA_EMAIL, ZERO_DATA_STORAGE_STATE, settleRouteBoundary } from './fixtures'

/**
 * OR-102b ④ — weight response over the current vial, on the screen.
 *
 * **What only a browser can show is that the verdict is WITHHELD as often as it is given.** The
 * arithmetic is unit-tested; what this asserts is the product decision the entry is built on — a
 * two-point delta carries ±1.70 kg against a band 0.35 kg wide, so a chip that commits on thin data
 * is worse than no chip. The same screen therefore has to read "not enough weigh-ins yet" on a short
 * series and colour only when the whole 95% interval clears a boundary.
 *
 * Both cases are driven from the SAME fixture shape, changing only how many weigh-ins exist, so a
 * pass cannot come from the two cases disagreeing about anything else.
 *
 * **Mutation-checked**: withholding the verdict unconditionally fails case 2; committing on the
 * point estimate rather than the interval fails case 1.
 *
 * **The window here is SEVEN DAYS, and that is the web build's ceiling rather than the feature's.**
 * The card reads `body_metrics` from the local store, which holds the whole dosing period — but
 * `getLocalStore` returns null in a browser and the only server fallback, `/api/body-metadata`,
 * hard-codes `metrics.slice(0, 7)` with no range parameter. So a browser cannot see a 56-day vial at
 * all, and the fixture is built inside the seven days the fallback can return. Filed as LB-96.
 *
 * That ceiling is also why case 2's loss rate is deliberately absurd: over six days with the
 * residual SD floored at the measured 1.203 kg, the 95% interval is about ±4 kg/wk, so only a
 * ridiculous rate clears a 1 kg band. The fixture exists to drive the coloured branch, not to
 * describe a person.
 *
 * Not exercised here: the device — the real window, the `getLocalStore` branch, and whether the
 * colour reads at a glance on the S25, which is the entry's own device check.
 */

/**
 * The ZERO-DATA user, and that is a hard requirement rather than tidiness.
 *
 * `body_metrics` has no column this spec could tag its rows with, and its `(user_id, date)` unique
 * means seeding a window is an UPSERT — against the seeded user that would overwrite real weigh-ins
 * with fabricated ones and there would be no way to put them back. The zero-data user has none, so
 * the window is this spec's to write and to delete.
 */
test.use({ storageState: ZERO_DATA_STORAGE_STATE, serviceWorkers: 'block' })
test.setTimeout(180_000)

const SUPP = 'dddddddd-1111-4111-8111-dddddddddd01'
const VIAL = 'eeeeeeee-2222-4222-8222-eeeeeeeeee01'
const NAME = 'Reta Response E2E'
/** Six, because `/api/body-metadata` returns seven rows and a browser has no other source. */
const WINDOW_DAYS = 6

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function userId(db: Client): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [ZERO_DATA_EMAIL])
  expect(rows[0]?.id, `${ZERO_DATA_EMAIL} is missing — zero-data.setup.ts creates it`).toBeTruthy()
  return rows[0].id
}

/** The user's own local day, which is what `body_metrics.date` is keyed on — never the runner's. */
async function todayInUserTz(db: Client): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD') AS d`,
  )
  return rows[0].d
}

async function cleanup(db: Client): Promise<void> {
  await db.query('DELETE FROM supplement_vials WHERE id = $1', [VIAL])
  await db.query('DELETE FROM supplements WHERE id = $1', [SUPP])
  // Every `body_metrics` row this user has is one of ours — see the `test.use` note above.
  await db.query('DELETE FROM body_metrics WHERE user_id = $1', [await userId(db)])
}

/**
 * `count` weigh-ins spread over the vial's window, losing `kgPerWeek`.
 *
 * The days are computed back from the USER's own today in Postgres rather than from the runner's
 * clock, so the window the card reads is the window this seeds — the runner is UTC and the user is
 * not, and for ten hours a day those are different dates.
 */
async function seedWeights(count: number, kgPerWeek: number): Promise<string> {
  return withDb(async db => {
    const uid = await userId(db)
    const today = await todayInUserTz(db)
    await db.query('DELETE FROM body_metrics WHERE user_id = $1', [uid])
    const openedOn = (await db.query<{ d: string }>(
      `SELECT to_char($1::date - $2::int, 'YYYY-MM-DD') AS d`, [today, WINDOW_DAYS],
    )).rows[0].d

    for (let i = 0; i < count; i++) {
      // Spread across the whole window whatever the count, so "few weigh-ins" is genuinely about
      // the count and not about a shorter span.
      const offset = Math.round((WINDOW_DAYS * i) / Math.max(count - 1, 1))
      // A small deterministic wobble: a perfectly straight series is degenerate, not consistent.
      const weight = 100 - (kgPerWeek / 7) * offset + 0.25 * Math.sin(i * 2.4)
      await db.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg)
         VALUES ($1, ($2::date - $3::int)::date, $4)
         ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
        [uid, today, WINDOW_DAYS - offset, weight],
      )
    }

    await db.query(
      `INSERT INTO supplements (id, user_id, name, dose, default_amount, unit)
       VALUES ($1, $2, $3, '0.5 mg', 0.5, 'mg')
       ON CONFLICT (id) DO NOTHING`,
      [SUPP, uid, NAME],
    )
    await db.query(
      `INSERT INTO supplement_vials (id, user_id, supplement_id, strength_mg, water_ml, syringe_units_per_ml, opened_on)
       VALUES ($1, $2, $3, 10, 3, 100, $4)
       ON CONFLICT (id) DO UPDATE SET opened_on = EXCLUDED.opened_on`,
      [VIAL, uid, SUPP, openedOn],
    )
    return openedOn
  })
}

test.afterAll(async () => { await withDb(cleanup) })

/** Synthetic input does not reach these handlers — measured and open as LB-68. */
async function domClick(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 30_000 })
  await locator.evaluate((el: HTMLElement) => el.click())
}

async function openVialSheet(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await domClick(page.getByRole('button', { name: `Vial and dose calculator for ${NAME}` }))
  const sheet = page.getByRole('dialog').filter({ hasText: `${NAME} — vial & dose` })
  await expect(sheet).toBeVisible({ timeout: 30_000 })
  return sheet
}

test('three weigh-ins get a number and no colour', async ({ page }) => {
  await seedWeights(3, 2.5)
  const sheet = await openVialSheet(page)

  // The rate is far outside any sane band, and it is still not called — three readings over eight
  // weeks cannot separate it from noise, and the chip says so instead of going red. Three readings
  // IS enough to fit a rate, so the chip distinguishes "not called" from "not enough data".
  await expect(sheet.getByText('Not called yet')).toBeVisible({ timeout: 30_000 })
  await expect(sheet.getByText(/The range crosses a boundary/)).toBeVisible()
  // The figure and its interval are printed regardless — withholding the verdict is not withholding
  // the data.
  await expect(sheet.getByText(/kg\/wk \(95% CI/)).toBeVisible()
  await expect(sheet.getByText(/3 weigh-ins over \d+ days/)).toBeVisible()
})

test('a series whose whole interval clears the band gets the colour, and says why', async ({ page }) => {
  // Absurd on purpose — see the file comment. Six days cannot resolve a real rate, so this is the
  // rate it takes to make the WHOLE interval clear a 1 kg band on this window.
  await seedWeights(7, 12)
  const sheet = await openVialSheet(page)

  await expect(sheet.getByText('Faster than your band')).toBeVisible({ timeout: 30_000 })
  await expect(sheet.getByText(/The whole range falls on one side of it/)).toBeVisible()
  // The band is a percentage of the CURRENT bodyweight, so it is printed rather than assumed.
  await expect(sheet.getByText(/Your band is \d\.\d\d–\d\.\d\d kg\/wk/)).toBeVisible()
  await expect(sheet.getByText('Not called yet')).toHaveCount(0)
  await expect(sheet.getByText('Not enough weigh-ins yet')).toHaveCount(0)
})
