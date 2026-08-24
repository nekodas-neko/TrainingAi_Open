import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * The finished-logging control comes before End of Day, on today and on a back-dated day (BF-6).
 *
 * It shipped last on the page, on the argument that "I have finished logging" is a claim about the
 * whole day — and then took **zero presses in seven weeks** (0 of 55 `day_checkins` rows carried
 * `food_logging_completed_at`, 2026-07-02 → 2026-08-24). The calibration it feeds treats an unmarked
 * day as **excluded**, not as light, so a control nothing reaches withholds the feature entirely.
 *
 * **Asserted by vertical position, not by DOM index**, because what went wrong was where the control
 * sat on screen. A `toHaveCount`-style check on ordering would pass against a page that renders them
 * in the right order and paints them anywhere.
 *
 * The past-date case is here because both the finished-logging card and Supplements are conditional
 * on the day being today, so the tail of the screen changes shape — the entry asks for exactly this.
 */

async function tailPositions(page: Page): Promise<{ logging: number; endOfDay: number }> {
  const logging = page.getByText(/^Finished logging|^Logging finished/).first()
  const endOfDay = page.getByRole('button', { name: 'End of Day', exact: true })
  await expect(logging).toBeVisible({ timeout: 30_000 })
  await expect(endOfDay).toBeVisible()
  // Scrolled to the bottom first so both boxes are measured in the same layout pass; a lazily
  // mounted chart between them would otherwise move one after the other was read.
  await page.mouse.wheel(0, 4000)
  await expect.poll(async () => (await endOfDay.boundingBox())?.y ?? -1).toBeGreaterThan(0)
  return {
    logging: (await logging.boundingBox())!.y,
    endOfDay: (await endOfDay.boundingBox())!.y,
  }
}

test('the finished-logging control sits above End of Day today', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const { logging, endOfDay } = await tailPositions(page)
  expect(logging, 'finished-logging must come before End of Day').toBeLessThan(endOfDay)
})

/**
 * Two days back **in the user's own timezone**, read from Postgres.
 *
 * Never `new Date().toISOString().slice(0, 10)`: that is the UTC date, and it is yesterday in
 * Brisbane until 10am every day — the exact pattern `CLAUDE.md` bans, and a spec that shifts from it
 * would be asking the app about a different day than it meant to.
 */
async function daysBackInUserTz(days: number): Promise<string> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try {
    const { rows } = await db.query<{ d: string }>(
      `SELECT ((now() AT TIME ZONE COALESCE((SELECT timezone FROM users WHERE email = $1), 'Australia/Brisbane'))::date
               - $2::int)::text AS d`,
      [SEED_EMAIL, days],
    )
    return rows[0].d
  } finally {
    await db.end()
  }
}

test('and on a back-dated day, where the tail of the screen changes shape', async ({ page }) => {
  // Far enough back that Supplements (today-only) is gone, so the elements between the two controls
  // differ from the case above.
  const past = await daysBackInUserTz(2)
  await page.goto(`/nutrition?date=${past}`)
  await settleRouteBoundary(page)
  const { logging, endOfDay } = await tailPositions(page)
  expect(logging, 'the order must hold with the today-only sections absent').toBeLessThan(endOfDay)
})
