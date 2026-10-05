import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * LB-95 — personal records reach the measured overview.
 *
 * The payload is injected. Whether the seeded user has a personal record is a fact about fixtures,
 * and the section returns null with none — so every assertion would pass vacuously against the very
 * absence this change fills.
 *
 * **Not checked here: the local-first read.** There is none; personal records are a server-computed
 * all-time aggregate, the same class as the weekly stats the offline-first rule leaves on
 * `cachedFetch`.
 */
test.setTimeout(180_000)

// An instant late enough in UTC that the Brisbane day is already the next one — the case the
// timezone rule exists for, carried through to the screen rather than only unit-tested.
const RECORDS = {
  records: [
    { exerciseName: 'Back Squat', estimated1rm: 142.5, achievedAt: '2026-09-29T23:30:00.000Z' },
    { exerciseName: 'Bench Press', estimated1rm: 101.25, achievedAt: '2026-09-02T02:00:00.000Z' },
  ],
}

test('the lifting section lists each record with the day it was set', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/personal-records', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RECORDS) })
  })
  await page.goto('/more/details')
  await settleRouteBoundary(page)

  await expect(page.getByText('Lifting')).toBeVisible()
  await expect(page.getByText('Personal records')).toBeVisible()
  await expect(page.getByText('Back Squat')).toBeVisible()
  await expect(page.getByText('142.5 kg')).toBeVisible()
  await expect(page.getByText('Bench Press')).toBeVisible()
  // 23:30Z on the 29th is already the 30th in Brisbane, and the card prints `asOf` verbatim. A UTC
  // slice would render 2026-09-29 here, which is the off-by-one the timezone rule exists for.
  await expect(page.getByText('2026-09-30')).toBeVisible()
  await expect(page.getByText('2026-09-29')).toHaveCount(0)
})

test('the section is absent when nothing has been logged', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/personal-records', async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [] }) })
  })
  await page.goto('/more/details')
  await settleRouteBoundary(page)

  // An empty card on a screen of real measurements is worse than no card.
  await expect(page.getByText('Lifting')).toHaveCount(0)
})
