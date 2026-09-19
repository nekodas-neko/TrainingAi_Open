import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * TN-50 — the check-in must not answer itself.
 *
 * The sheet used to open with an energy level already selected, chosen by
 * `readinessToEnergy(readiness)`. That closed a loop inside a single day: readiness set the
 * default, the default went unchanged, and the check-in then scored 10% of that same readiness.
 * Measured over 62 days, the saved level was exactly what the auto-fill would have picked on 45 of
 * them — 73%, against ~20-25% by chance.
 *
 * The source guard beside this (`lib/__tests__/tn50-checkin-not-seeded-from-readiness.test.ts`)
 * pins the absence of the seed. It would still pass if the sheet rendered nothing at all, or if
 * some other code path pre-selected a level. This reads the rendered picker.
 *
 * **It deliberately does not save.** Saving would write a mood log for today, and the next run
 * would then open an EDIT of that log — where a pre-selected level is correct behaviour, not the
 * bug. The spec would pass for the wrong reason on every run after the first.
 */

/** The selected emoji is the only one scaled up; the rest are greyed. Inline styles, so a substring
 *  match on the style attribute is the honest read — there is no class to key off. */
const SELECTED = 'span[style*="scale(1.25)"]'

test.beforeAll(async () => {
  // A mood log for today would make this an edit rather than a fresh check-in. Clearing it is what
  // makes the spec deterministic on a local database that has been run against before; on CI the
  // row never exists.
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    // `log_date` is a DATE column, so the user-local day has to be cast rather than formatted —
    // comparing it against `to_char(...)` text fails outright.
    await db.query(
      `DELETE FROM mood_logs ml
        USING users u
        WHERE ml.user_id = u.id
          AND u.email = $1
          AND ml.log_date = (now() AT TIME ZONE coalesce(u.timezone, 'Australia/Brisbane'))::date`,
      [SEED_EMAIL],
    )
  } finally { await db.end() }
})

test('the energy picker opens with nothing chosen, and Pumped is reachable', async ({ page }) => {
  test.setTimeout(120_000)
  // Suppress the auto-open and drive the card instead: the tap is the path the owner takes, and it
  // keeps the sheet's open moment under the spec's control rather than the prompt's.
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)

  const card = page.getByRole('button', { name: /Log Readiness/i }).first()
  await expect(card).toBeVisible({ timeout: 30_000 })
  // `.click()` via evaluate rather than a tap: the card can sit below the fold, and
  // `touchscreen.tap` has no actionability check, so a miss is silent.
  await card.evaluate(el => (el as HTMLElement).click())

  const save = page.getByRole('button', { name: /Save Readiness/i })
  await expect(save, 'the check-in sheet never opened').toBeVisible({ timeout: 30_000 })

  // The defect, in one assertion: on a fresh check-in NO level is selected.
  await expect(
    page.locator(SELECTED),
    'an energy level was pre-selected — something is seeding the answer the contributor exists to collect',
  ).toHaveCount(0)

  await expect(
    save,
    'Save was enabled with no level chosen — an unanswered sheet must not be storable, because ' +
    'MoodLog.energyLevel cannot represent "unanswered"',
  ).toBeDisabled()

  // TN-50 item 2: `pumped` was unreachable because the old mapping had no branch returning it.
  await page.getByText('Pumped', { exact: true }).click()
  await expect(page.locator(SELECTED), 'tapping a level did not select it').toHaveCount(1)
  await expect(save, 'Save stayed disabled after a level was chosen').toBeEnabled()
})
