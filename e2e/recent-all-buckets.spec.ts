import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * LB-18 — `Recent` on Log Food reads every meal bucket, not the one the hour suggests.
 *
 * The owner answered this on the device: *"Recent doesnt need to be scoped to current meal bracket;
 * I think it should just be all recently entered foods/meals."* The Lane A sources landed 2026-09-02
 * and this is the swap.
 *
 * What only a browser settles: that the request actually goes out **without** `mealTypeId`. The
 * route treats the param's absence as every bucket, so a stray param is the whole regression and it
 * is invisible to a type-check.
 */
test.use({ serviceWorkers: 'block' })

test('Recent asks for every bucket, with no meal type in the request', async ({ page }) => {
  const urls: string[] = []
  await page.route('**/api/nutrition/recent-for-meal**', async route => {
    urls.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await page.getByRole('button', { name: 'My Foods', exact: true })
    .evaluate((el: HTMLElement) => el.click())
  await page.getByRole('tab', { name: 'Recent', exact: true })
    .evaluate((el: HTMLElement) => el.click())

  await expect.poll(() => urls.length, { timeout: 30_000 }).toBeGreaterThan(0)
  for (const url of urls) {
    expect(url, 'the bucket must not come back as a query param').not.toContain('mealTypeId')
  }
})
