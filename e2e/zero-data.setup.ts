import { test as setup, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, SEED_PASSWORD, ZERO_DATA_EMAIL, ZERO_DATA_STORAGE_STATE } from './fixtures'

/**
 * Creates (idempotently) and signs in as an account with **no program, no logs and no metrics**,
 * saving its session for specs that need a first-run state — Q-352.
 *
 * Why the row is made here and not in `scripts/local-db/seed.sql`: `setup.sh` runs the seed only
 * when `users` is empty, so an existing local database would never gain the account while CI, which
 * builds a fresh one every run, always would. A spec resting on that would pass in CI and fail
 * locally — the wrong way round for something whose job is catching regressions. Doing it here
 * makes both environments identical and costs one query.
 *
 * The password hash is copied from the seeded user rather than hardcoded, so this cannot drift from
 * `SEED_PASSWORD` the way a second literal would.
 */
setup.setTimeout(180_000)

setup('create and sign in as the zero-data user', async ({ page }) => {
  const connectionString = process.env.DATABASE_URL
  // Fail loudly rather than skip. A silently-skipped fixture leaves every spec that depends on it
  // failing later for a reason that looks nothing like the cause.
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()

  const db = new Client({ connectionString })
  await db.connect()
  try {
    // Deliberately NOT `ON CONFLICT DO NOTHING` on its own: the account must also be *empty*, and a
    // previous run's spec may have written to it. Anything a spec can create is cleared here so the
    // account is genuinely first-run at the start of every run, not merely present.
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO users (email, name, display_name, is_active, timezone, password_hash)
       SELECT $1, 'Zero Data', 'Zero Data', true, timezone, password_hash
         FROM users WHERE email = $2
       ON CONFLICT (email) DO UPDATE SET is_active = true
       RETURNING id`,
      [ZERO_DATA_EMAIL, SEED_EMAIL],
    )
    const id = rows[0]?.id
    expect(id, `could not create ${ZERO_DATA_EMAIL} — is ${SEED_EMAIL} seeded?`).toBeTruthy()

    for (const table of ['activity_logs', 'workout_sessions', 'body_metrics', 'food_logs', 'mood_logs', 'programs']) {
      await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [id])
    }
  } finally {
    await db.end()
  }

  await page.goto('/sign-in')
  // The submit is a client handler, so clicking before hydration silently does nothing.
  await expect(page.getByRole('button', { name: /sign in with email/i })).toBeEnabled()
  await page.getByLabel('Email').fill(ZERO_DATA_EMAIL)
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: /sign in with email/i }).click()

  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 120_000 })
  await page.context().storageState({ path: ZERO_DATA_STORAGE_STATE })
})
