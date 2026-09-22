import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-85 — Home's score row vanished on a failed fetch, with no skeleton and no message.
 *
 * `{readiness && <OuraScoreChipRow …>}` gated the whole row, and `showHomeSkeleton` requires
 * `refreshing`, so a persistent failure rendered *nothing at all* on the owner's most-used screen
 * (22 of 56 resumes in the telemetry window). `/api/readiness-score` has no null-payload path — it
 * answers a payload or an error status — so an absent value there is always a failure, never
 * "nothing to say".
 *
 * `fetchWithRetry` was supposed to prevent exactly this and half did: it retries three times
 * (2.5s/5s/7.5s) and then gave up silently, landing on the blank widget its own header says it
 * exists to prevent. It now reports exhaustion, and this is the assertion that the report reaches
 * the screen.
 *
 * **The timing is the point, not an inconvenience.** The message must NOT appear while the retries
 * are still running — "slow" and "failed" are different things to tell someone — so the first
 * assertion is that the slot is still empty partway through the ladder.
 */
test.use({ serviceWorkers: 'block' })
test.setTimeout(180_000)

const FAILED = /Scores didn.t load/

test('a readiness fetch that never succeeds says so, instead of leaving a gap', async ({ page }) => {
  let calls = 0
  await page.route('**/api/readiness-score**', route => {
    calls++
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' })
  })

  await page.goto('/')
  await settleRouteBoundary(page)

  // Partway through the ladder: it has failed at least once and is still trying, so the row stays
  // quiet. A message here would sit under a request that might be about to succeed.
  expect(calls).toBeGreaterThan(0)
  await expect(page.getByText(FAILED)).toHaveCount(0)

  // Once the attempts are spent, the slot says what happened. Generous timeout: the ladder itself
  // is 15s before the last attempt even starts.
  await expect(page.getByText(FAILED)).toBeVisible({ timeout: 60_000 })
})

test('a readiness fetch that works leaves no failure message behind', async ({ page }) => {
  // The control. A test that only asserts the message appears would also pass against a build that
  // showed it unconditionally, which is a worse bug than the blank it replaced.
  await page.goto('/')
  await settleRouteBoundary(page)
  await expect(page.getByText(FAILED)).toHaveCount(0)
})
