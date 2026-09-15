import { test, expect } from '@playwright/test'
import { settleRouteBoundary, ZERO_DATA_STORAGE_STATE } from './fixtures'

/**
 * RV-38 — Body Battery printed **Good / Steady / 50** for an account that has never worn anything.
 *
 * **The route was honest and the card ignored it.** `GET /api/body-battery` returns four fields
 * saying it has nothing — `hasData: false`, `sampleCount: 0`, `sufficient: false`,
 * `anchorSource: "default"` — and the card rendered a colour-coded label, a bar filled to 50%, and
 * no "Limited data" badge.
 *
 * **The guard made the qualification weaker as the data got worse.** `lowData` was
 * `battery.hasData && conf != null && !conf.sufficient`: enough samples → no badge (right), too few
 * → badge (right), **none at all → no badge**. Dropping `battery.hasData &&` is the whole fix;
 * `sufficient` is false in both of the cases that deserve the badge, which is what makes it the
 * correct condition on its own.
 *
 * **This asserts the PAYLOAD beside the text, which the entry asked for specifically.** A rendered
 * 50 on its own cannot tell a bug from a fixture — the badge only means something if the response
 * behind it really did say `hasData: false`. Capturing the response is what makes the assertion
 * about the card rather than about the seed.
 *
 * Scope: this is the no-data *treatment*. The owner handed the **number** to Tuning on 2026-09-14,
 * and whether no-data deserves an `—` like Readiness rather than a badge is their call — neither is
 * settled here.
 */

test.use({ storageState: ZERO_DATA_STORAGE_STATE })

test('an account with no data gets the Limited data badge, and the payload agrees', async ({ page }) => {
  test.setTimeout(180_000)

  let payload: { hasData?: boolean; confidence?: { sufficient?: boolean; sampleCount?: number } } | null = null
  page.on('response', async r => {
    if (!r.url().includes('/api/body-battery') || !r.ok()) return
    try { payload = await r.json() } catch { /* a non-JSON body is not this test's business */ }
  })

  await page.goto('/')
  await settleRouteBoundary(page)

  const badge = page.getByText('Limited data').first()
  await expect(badge, 'the card must qualify a number it cannot support').toBeVisible({ timeout: 60_000 })

  // The payload half. Asserted AFTER the badge so a failure reads "the card is wrong" rather than
  // "the fixture is wrong" — and so the wait above has already given the response time to land.
  expect(payload, '/api/body-battery never responded — the assertion above proved nothing').not.toBeNull()
  expect(payload!.hasData, 'the fixture must actually be a no-data account').toBe(false)
  expect(payload!.confidence?.sufficient).toBe(false)
})
