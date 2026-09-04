import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-79 — the personal details are one screen, reachable from More, and each field saves alone.
 *
 * The owner asked to *"combine all the personal information fields into 1 section"*. Before this
 * they were split between the Edit Profile sheet (display name) and the Goals accordion (height,
 * birth year, biological sex), and until BF-78 each editor resent the other's fields, so a save
 * from a stale copy could overwrite a change made in the other one.
 *
 * **Two claims, and they need different instruments.** That each column has exactly one *writer* is
 * structural and is checked from source in
 * `components/profile/__tests__/personal-details-one-editor.test.ts` — nothing renders under vitest.
 * What only a browser can show is the half below: that the screen is actually reachable, that a
 * value typed into it survives a reload, and that writing one column leaves the others alone. The
 * entry asks for that last one to be re-verified *through the UI* rather than trusted from BF-78's
 * route tests, which is what this does.
 *
 * The database read is deliberate. Asserting the other fields still render would only prove the
 * form state, which never left the browser; reading the row proves the PATCH did not carry them.
 */

const NEW_NAME = `BF79 ${Date.now()}`

test.describe.configure({ mode: 'serial' })
// Two routes compiling on first use under `pnpm dev`, plus an 800 ms save debounce.
test.setTimeout(180_000)

interface ProfileRow { displayName: string | null; heightCm: number | null; dateOfBirth: string | null; sex: string | null }

async function readProfile(): Promise<ProfileRow> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try {
    const { rows } = await db.query<ProfileRow>(
      `SELECT display_name AS "displayName", height_cm AS "heightCm",
              to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth", sex
         FROM users WHERE email = $1`,
      [SEED_EMAIL],
    )
    expect(rows[0], `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    return rows[0]
  } finally { await db.end() }
}

test('the More tab reaches the details screen', async ({ page }) => {
  await page.goto('/more')
  await settleRouteBoundary(page)

  // The row lost its "Name, body facts" sublabel and is now just its label (BF-79's regrouping).
  await page.getByRole('button', { name: /Profile details/ }).click()

  await expect(page.getByRole('heading', { name: 'Profile details' })).toBeVisible({ timeout: 60_000 })
  // All four editable details on one screen — the whole of what the owner asked for.
  await expect(page.getByLabel('Display Name')).toBeVisible()
  await expect(page.getByLabel('Height (cm)')).toBeVisible()
  await expect(page.getByLabel('Birth Year')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Biological Sex' })).toBeVisible()
})

test('a name typed here persists, and does not disturb the other columns', async ({ page }) => {
  const before = await readProfile()
  // The seed's height and sex are what the isolation claim is measured against, so they have to
  // exist for the assertion to mean anything.
  expect(before.heightCm, 'the seed user needs a height for this to test isolation').not.toBeNull()
  expect(before.sex, 'the seed user needs a sex for this to test isolation').not.toBeNull()

  await page.goto('/more/details')
  await settleRouteBoundary(page)

  const name = page.getByLabel('Display Name')
  await expect(name).toBeVisible({ timeout: 60_000 })
  await name.fill(NEW_NAME)

  // Poll the row rather than sleeping past the 800 ms debounce — a fixed wait is either flaky or
  // slower than it needs to be, and this says what it is waiting for.
  await expect.poll(async () => (await readProfile()).displayName, { timeout: 30_000 })
    .toBe(NEW_NAME)

  const after = await readProfile()
  expect(after.heightCm, 'saving the name must not touch height').toBe(before.heightCm)
  expect(after.sex, 'saving the name must not touch biological sex').toBe(before.sex)
  expect(after.dateOfBirth, 'saving the name must not touch the date of birth').toBe(before.dateOfBirth)

  // And it is the stored value the screen comes back to, not surviving form state.
  await page.reload()
  await settleRouteBoundary(page)
  await expect(page.getByLabel('Display Name')).toHaveValue(NEW_NAME, { timeout: 60_000 })
})

test.afterAll(async () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return
  const db = new Client({ connectionString })
  await db.connect()
  try {
    await db.query('UPDATE users SET display_name = NULL WHERE email = $1 AND display_name = $2', [SEED_EMAIL, NEW_NAME])
  } finally { await db.end() }
})
