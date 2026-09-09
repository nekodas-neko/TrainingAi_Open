import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-519 — the bedtime you remember, for a night the ring did not see the start of.
 *
 * The engine shipped 2026-08-26 with no way to write to it. This drives the control that fills that
 * gap and asserts the one thing a browser can settle that a unit test cannot: that saving reaches
 * `/api/sleep/manual-bedtime` with the instant the entered clock time means, and that clearing sends
 * an explicit null rather than omitting the field.
 */
test.use({ serviceWorkers: 'block' })

test('saving a remembered bedtime posts the instant, and clearing posts null', async ({ page }) => {
  const posted: unknown[] = []
  await page.route('**/api/sleep/manual-bedtime', async route => {
    posted.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })

  await page.goto('/health/sleep')
  await settleRouteBoundary(page)

  const field = page.getByLabel('Time you went to bed')
  await expect(field).toBeVisible({ timeout: 60_000 })

  await field.fill('23:15')
  await page.getByRole('button', { name: 'Save', exact: true }).evaluate((el: HTMLElement) => el.click())

  await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible({ timeout: 15_000 })
  expect(posted).toHaveLength(1)
  const body = posted[0] as { date: string; at: string }
  expect(body.date).toMatch(/^\d{4}[-/]\d{2}[-/]\d{2}$/)
  // 23:15 the evening BEFORE the night's date, expressed as an instant.
  expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)

  await page.getByRole('button', { name: 'Clear' }).evaluate((el: HTMLElement) => el.click())
  await expect(page.getByLabel('Time you went to bed')).toBeVisible({ timeout: 15_000 })
  expect(posted).toHaveLength(2)
  // Explicitly null, not omitted — the route's schema requires the key to be present.
  expect((posted[1] as { at: string | null }).at).toBeNull()
})
