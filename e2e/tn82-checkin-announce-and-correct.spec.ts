import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'
import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * TN-82 — the morning check-in announces its answer and he corrects it in one tap.
 *
 * **What this asserts is the POST BODY, not the pixels.** The whole design turns on one flag:
 * `sleepQualityFeelTouched` separates the app's guess from his answer, and the plan calls an
 * auto-fill that sets it true destructive of the variable the design exists to create. That is
 * invisible on screen and decisive in the database, so it is checked where it is written.
 *
 * **The sheet is opened by its own auto-open path**, by stubbing today's check-in as absent — the
 * same condition `session-select-content.tsx` uses. Driving it any other way would test the opener
 * rather than the sheet.
 */

test.use({ viewport: { width: 384, height: 854 }, serviceWorkers: 'block' })

/** A prominent (`poor`) night: short duration, well outside its own band, with the bands snapshotted. */
const POOR_VERDICT = {
  verdict: 'poor',
  triggered: ['duration'],
  components: { durationHours: 5.17, onsetMinutes: 80, efficiency: null },
  bands: {
    durationLow: 6.5, durationHigh: 8.5,
    onsetLow: -60, onsetHigh: 30,
    efficiencyLow: null, efficiencyHigh: null,
  },
  baselineNights: 30,
  modelVersion: 2,
  responseState: 'none',
}

async function openSheet(page: Page) {
  const posts: Record<string, unknown>[] = []
  // Today's check-in is absent, which is exactly what makes the sheet auto-open.
  await page.route('**/api/day-checkin**', async route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
  await page.route('**/api/sleep-verdict**', async route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      // `todayInTz`, not `toISOString().slice(0,10)`: the UTC date is yesterday's before 10am AEST,
      // and the app asks for the zone's date — the two disagree for ten hours a day.
      body: JSON.stringify({ verdict: { ...POOR_VERDICT, date: todayInTz() } }),
    })
  })
  await page.goto('/')
  await settleRouteBoundary(page)
  await expect(page.getByRole('heading', { name: 'Morning Check-in' }), 'the sheet never auto-opened')
    .toBeVisible({ timeout: 60_000 })
  return posts
}

test('the two scales are gone and the night is announced with its reason', async ({ page }) => {
  test.setTimeout(180_000)
  await openSheet(page)

  // Asking is what failed three times; neither scale may still be on the sheet.
  await expect(page.getByText('Sleep quality (feel)'), 'the sleep scale is still being asked')
    .toHaveCount(0)
  await expect(page.getByText('Recovery', { exact: true }), 'the recovery scale is still being asked')
    .toHaveCount(0)

  // The reason is load-bearing: a verdict with no stated cause cannot be argued with, which is the
  // only thing this instrument collects. `5.17h` against a `6.5h` floor is `1h20 short`.
  await expect(page.getByText(/Slept 5h10/)).toBeVisible()
  await expect(page.getByText(/short of your usual/)).toBeVisible()
})

test('saving without touching it writes the app\'s answer as NOT his', async ({ page }) => {
  test.setTimeout(180_000)
  const posts = await openSheet(page)

  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThan(0)

  const body = posts[0] as Record<string, unknown>
  // `poor` is a 4 on a scale stored 1 = great … 5 = terrible.
  expect(body.sleepQualityFeel, 'the announced verdict was not written').toBe(4)
  expect(body.sleepQualityFeelTouched, 'an auto-fill flagged itself as HIS answer — this is TN-57')
    .toBe(false)
  // The invariant that replaces the two scales: without a number here `dayCheckinHasAnswers`
  // rejects the body — a 400 on the route, a no-retry poison pill in the outbox.
  expect(typeof body.sleepQualityFeel).toBe('number')
  // A plain Save is not assent: 82 of 82 sheets were saved while a scale was touched in 3.
  expect(body.perceivedRecovery, 'recovery is no longer asked, so it must not be invented').toBeNull()
})

test('one tap corrects it, and the correction is recorded as HIS', async ({ page }) => {
  test.setTimeout(180_000)
  const posts = await openSheet(page)

  // One tap. 'Great' is stored 1 — the opposite end from the announced `poor`, so a mapping that
  // lost the inversion would write 5 here and the assertion would catch it.
  await page.getByRole('button', { name: 'Great', exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThan(0)

  const body = posts[0] as Record<string, unknown>
  expect(body.sleepQualityFeel, 'his correction was not written').toBe(1)
  expect(body.sleepQualityFeelTouched, 'a correction must be recorded as his answer').toBe(true)
})
