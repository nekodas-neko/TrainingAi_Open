import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

/**
 * Q-529 — a still-syncing night's figures rendered exactly like a settled night's.
 *
 * The payload is stubbed rather than seeded because the real flag is derived from the ring's clock
 * anchors and the rollup watermark (`getSleepCoverageEnd`), neither of which the seed database has —
 * against it every night reads final, so the marked case would be unreachable. The server side is
 * already covered where it lives; what is unproven here is the client rendering, and stubbing is
 * what makes both directions reachable in one run.
 *
 * `serviceWorkers: 'block'` because the worker re-issues `/api/` requests and Playwright cannot
 * intercept a service-worker fetch — without it the stub applies or not depending on whether the
 * worker has claimed the page.
 */

test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test.setTimeout(180_000)

const night = (provisional: boolean) => [{
  date: '2026-09-02',
  durationHours: 7.75, deepSleepHours: 1.08, remSleepHours: 2.08, lightSleepHours: 5.25,
  awakHours: 1.17, efficiency: 87, onsetLatencySec: 1800, averageHrvMs: 45,
  avgHeartRate: 55, lowestHeartRate: 48, restlessPeriods: 12, sleepScore: 62,
  respiratoryRate: 14.2, sleepPhase5Min: null,
  sleepStart: '2026-09-01T12:00:00.000Z', sleepEnd: '2026-09-01T20:44:00.000Z',
  sleepTimeRecommendation: null,
  provisional,
}]

const stubNight = (page: import('@playwright/test').Page, provisional: boolean) =>
  page.route(u => new URL(u).pathname === '/api/sleep-sessions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(night(provisional)) }))

test('a still-syncing night says so on the sleep detail screen', async ({ page }) => {
  await stubNight(page, true)
  await page.goto('/health/sleep', { waitUntil: 'networkidle' })
  await expect(page.getByText('Still syncing')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/will change once the night finishes syncing/)).toBeVisible()
})

test('a settled night is left unmarked — the badge is not decoration', async ({ page }) => {
  // The direction that catches a badge wired to render unconditionally, which would read as "your
  // sleep is never final" on every historical night.
  await stubNight(page, false)
  await page.goto('/health/sleep', { waitUntil: 'networkidle' })
  await expect(page.getByText(/Sleep/).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Still syncing')).toHaveCount(0)
})
