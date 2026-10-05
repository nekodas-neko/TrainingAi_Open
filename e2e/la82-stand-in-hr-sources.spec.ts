import { test, expect } from '@playwright/test'
import { settleRouteBoundary, tolerateTestEnd } from './fixtures'

/**
 * LA-82 — a zone boundary resting on a stand-in says so.
 *
 * `resolveHrProfile` guards its reads and names each substitution in a source field, but nothing
 * rendered them: an `estimated-age-unread` max (the generic 190, not 220 − age) read exactly like a
 * real age estimate.
 *
 * Both payloads are overlaid on the real response and only the source fields are pinned. A thin
 * body was tried on the sibling entry and took the screen to "Something went wrong" — these routes
 * carry nested objects their cards dereference.
 */
test.setTimeout(180_000)

async function overlay(page: import('@playwright/test').Page, path: string, patch: (body: Record<string, unknown>) => Record<string, unknown>) {
  await page.route(u => new URL(u).pathname === path, tolerateTestEnd(async r => {
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(patch(body)) })
  }))
}

test('the hub says the max is a stand-in when the age could not be read', async ({ page }) => {
  await overlay(page, '/api/cardio-week', b => ({
    ...b,
    heart: { ...(b.heart as object), maxHrSource: 'estimated-age-unread', restingHrSource: 'measured' },
  }))
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  await expect(page.getByText(/Your age couldn’t be read/)).toBeVisible()
  await expect(page.getByText(/zone boundaries are approximate/)).toBeVisible()
})

test('a failed resting read and a never-measured one say different things', async ({ page }) => {
  await overlay(page, '/api/cardio-week', b => ({
    ...b,
    heart: { ...(b.heart as object), maxHrSource: 'observed', restingHrSource: 'unavailable' },
  }))
  await page.goto('/cardio')
  await settleRouteBoundary(page)
  await expect(page.getByText(/resting heart rate couldn’t be read/)).toBeVisible()
  // "Still learning your range" describes a profile being built, not one that failed to load.
  await expect(page.getByText(/Still learning your range/)).toHaveCount(0)
})

test('nothing is said when both numbers are genuinely the user’s', async ({ page }) => {
  await overlay(page, '/api/cardio-week', b => ({
    ...b,
    heart: { ...(b.heart as object), maxHrSource: 'observed', restingHrSource: 'measured', isReliable: true },
  }))
  await page.goto('/cardio')
  await settleRouteBoundary(page)

  // A positive anchor: absence assertions alone would pass against a page that never rendered.
  await expect(page.getByText('Your heart')).toBeVisible()
  await expect(page.getByText(/zone boundaries are approximate/)).toHaveCount(0)
})
