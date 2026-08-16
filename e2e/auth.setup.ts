import { test as setup, expect } from '@playwright/test'
import { STORAGE_STATE, SEED_EMAIL, SEED_PASSWORD } from './fixtures'

/**
 * Signs in once and saves the session cookie for every spec. Driven through the real form rather
 * than by POSTing the credentials callback: the form is a surface users touch, and a sign-in page
 * that stopped working would otherwise be the one bug this harness could never see.
 */
// Generous: this is the first page the dev server compiles, and it compiles the auth route on the
// submit as well. Both are one-off costs that only ever land on this spec.
setup.setTimeout(180_000)

setup('sign in as the seeded user', async ({ page }) => {
  await page.goto('/sign-in')
  // The submit is a client handler, so clicking before hydration silently does nothing.
  await expect(page.getByRole('button', { name: /sign in with email/i })).toBeEnabled()
  await page.getByLabel('Email').fill(SEED_EMAIL)
  await page.getByLabel('Password').fill(SEED_PASSWORD)
  await page.getByRole('button', { name: /sign in with email/i }).click()

  // Landing anywhere that is not /sign-in means the session cookie was set. Asserting on a
  // particular destination would couple this to whatever the post-login route happens to be.
  await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 120_000 })
  await page.context().storageState({ path: STORAGE_STATE })
})
