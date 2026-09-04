import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-86 — the morning check-in re-prompts on the first resume of a new day.
 *
 * The owner: *"when I open the app in the morning and it just resumes, it doesn't give me the
 * morning check-in."* The cause was structural — the tab shell never unmounts, so an effect keyed
 * on `[userId, tz]` ran once per app **launch** and never re-asked what day it was.
 *
 * **This drives the boundary rather than waiting for it**, which is what the entry requires and what
 * this repo's history of date bugs demands: a rollover fault is invisible except across local
 * midnight, and a test that only passes at the right hour is a test that runs once a day. Playwright's
 * clock is installed just before midnight in the user's own timezone and then fast-forwarded past it,
 * so the case fires on every CI run at any wall-clock hour.
 *
 * The seed user's timezone is Australia/Brisbane (UTC+10, no DST), which is why the fixed instant
 * below is expressed as the UTC that corresponds to 23:55 there.
 *
 * **The setup WAITS for the prompt rather than testing whether it is showing.** A first version used
 * `isVisible()`, which is a point-in-time check and not a wait — the sheet is a `dynamic(ssr:false)`
 * import behind an async lookup, so it had not rendered yet, the close branch never ran, and the
 * final assertion was simply waiting for that first appearance. It passed with the fix reverted,
 * which is how the flaw was found: by mutation, not by reading.
 */

/** 2026-03-10 23:55 in Brisbane (UTC+10) — a fixed past instant, so nothing here moves with the clock. */
const JUST_BEFORE_MIDNIGHT = new Date('2026-03-10T13:55:00Z')

test.setTimeout(180_000)

// BF-117's case counts requests with `page.route`, and the service worker re-issues every /api/
// fetch where Playwright cannot see it — the stub would apply or not depending on whether the
// worker had claimed the page.
test.use({ serviceWorkers: 'block' })

test('a resume after local midnight re-prompts the morning check-in', async ({ page }) => {
  await page.clock.install({ time: JUST_BEFORE_MIDNIGHT })

  await page.goto('/')
  await settleRouteBoundary(page)

  const sheet = page.getByRole('heading', { name: 'Morning Check-in' })

  // Settle the app into "today's prompt is done" before crossing the boundary, or a sheet that is
  // merely still open proves nothing about the rollover. The marker assertion is what makes this
  // setup rather than hope: it is date-stamped, so seeing it proves the prompt was recorded as done
  // for THIS local day and that a later re-prompt can only be a new one.
  await expect(sheet, 'the prompt should be owed on a fresh load with no marker').toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden({ timeout: 20_000 })
  expect(await page.evaluate(() => localStorage.getItem('ta_morning_checkin')))
    .toBe('2026-03-10')

  // The app is left open across midnight and then looked at again. `visibilitychange` is the resume
  // — the same event a user returning to a backgrounded app produces.
  await page.clock.fastForward('00:10:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // The whole of BF-86: a new local day, no reload, and the prompt is owed again.
  await expect(sheet, 'the check-in must re-prompt on the first resume of a new day').toBeVisible({ timeout: 60_000 })
  expect(await page.evaluate(() => localStorage.getItem('ta_morning_checkin')), 'and the stale marker is what made it owed')
    .toBe('2026-03-10')
})

test('a resume on the SAME day does not re-prompt', async ({ page }) => {
  await page.clock.install({ time: JUST_BEFORE_MIDNIGHT })

  await page.goto('/')
  await settleRouteBoundary(page)

  const sheet = page.getByRole('heading', { name: 'Morning Check-in' })
  await expect(sheet).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden({ timeout: 20_000 })

  // Two minutes later, still the same local day. Without this the fix would be "prompt on every
  // resume", which is a worse bug than the one it replaces.
  await page.clock.fastForward('00:02:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await page.waitForTimeout(2_000)
  await expect(sheet, 'the same day must not re-prompt').toBeHidden()
})

/**
 * BF-117 — the rest of the screen follows the day, not just the check-in.
 *
 * BF-86 fixed the prompt and deliberately left this half undone: everything else on Home is gated
 * on `refreshTick`, which a day change did not bump, so the owner saw today's greeting over
 * yesterday's rest-day and recovery cards and had to kill the app. Counting requests rather than
 * reading text is what makes this specific — the cards' content depends on seeded data, but
 * "were these reads taken again" is exactly the defect.
 *
 * The negative case is the trap the fix had to avoid: `localDay` is seeded synchronously, so an
 * effect merely keyed on it fires once at mount and double-fetches every launch — invisible in use,
 * and it would read as an app that is just slow to settle.
 */
test('a resume after local midnight re-takes the day-scoped reads', async ({ page }) => {
  await page.clock.install({ time: JUST_BEFORE_MIDNIGHT })

  let readinessReads = 0
  await page.route('**/api/readiness-score*', async route => {
    readinessReads += 1
    await route.fallback()
  })

  await page.goto('/')
  await settleRouteBoundary(page)

  const sheet = page.getByRole('heading', { name: 'Morning Check-in' })
  await expect(sheet).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden({ timeout: 20_000 })

  await expect
    .poll(() => readinessReads, { timeout: 30_000, message: 'the launch read must have landed' })
    .toBeGreaterThan(0)
  const afterLaunch = readinessReads

  // Same day, so nothing is owed — this is the mount/double-fetch guard.
  await page.clock.fastForward('00:02:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(3_000)
  expect(readinessReads, 'a same-day resume must not refetch').toBe(afterLaunch)

  // Across midnight it is owed.
  await page.clock.fastForward('00:10:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(() => readinessReads, { timeout: 30_000, message: 'a new local day must re-take the reads' })
    .toBeGreaterThan(afterLaunch)
})
