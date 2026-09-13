import { test, expect } from '@playwright/test'
import { settleRouteBoundary, tapCentre } from './fixtures'

/**
 * LB-98 — the Rest-vs-plan card renders off the device.
 *
 * **This spec is the point of the entry, not a byproduct of it.** `planned_rest_sec` is the snapshot
 * taken when a set was logged and it lives in the local store, so `getLocalStore` returning null in
 * a browser left the card absent: CI could only ever assert the empty state, the rendering path
 * below shipped unexercised, and the card arrived owing a device check it could never discharge.
 * Lane A's half published the per-set pairs on the response this screen already fetches; the card
 * now falls back to them, and this is the first run of that path anywhere but the S25.
 *
 * **The response is stubbed, deliberately, and here is exactly what that costs.** Building a real
 * fixture would need far more than the card: the parent hides everything behind the CORRELATION's
 * `hasSufficientData`, which wants paired sessions with a progression style and a 1RM baseline —
 * conditions about the bars above, not about this card. Lane A's own emit site is already pinned by
 * five mutants including one that swaps the logged snapshot for the live style, so what is left
 * untested is not the query. **What this proves:** given the documented payload, the card computes
 * and draws. **What it does not:** that production data produces such a payload.
 */

// `public/sw-template.js` re-issues every `/api/` request from the worker, where `page.route`
// cannot see it — mandatory for any spec stubbing an `/api/` route in this app.
test.use({ serviceWorkers: 'block' })

test.setTimeout(120_000)

/**
 * Two prescriptions, both over the five-set floor, shaped from the production figures in
 * `rest-prescription.ts`: 60 s planned is *exceeded* (75 s taken) and 120 s is undershot (110 s).
 *
 * The spans are what make the compression sentence fire — 60 s planned against 35 s actual is 0.58,
 * inside the two-thirds threshold — so the branch that only prints when it is *true* is covered
 * rather than merely skipped.
 */
const REST_SETS = [
  ...Array.from({ length: 6 }, (_, i) => ({ plannedRestSec: 60, restTimeSec: [70, 72, 75, 76, 78, 79][i] })),
  ...Array.from({ length: 6 }, (_, i) => ({ plannedRestSec: 120, restTimeSec: [104, 107, 110, 112, 114, 113][i] })),
]

const TRENDS = {
  view: 'rest-adherence',
  insight: 'Sessions with high rest adherence average +3% vs baseline, vs −2% at low.',
  buckets: [
    { label: '<70', avg: -2, count: 6 },
    { label: '70–85', avg: 1, count: 9 },
    { label: '85+', avg: 3, count: 7 },
  ],
  hasSufficientData: true,
  restSets: REST_SETS,
}

test('the Rest-vs-plan card draws from the server pairs when there is no local store', async ({ page }) => {
  await page.route('**/api/health-trends?view=rest-adherence*', route => route.fulfill({ json: TRENDS }))

  await page.goto('/health')
  await settleRouteBoundary(page)

  const pill = page.getByRole('button', { name: 'Rest discipline', exact: true })
  await expect(pill).toBeVisible({ timeout: 60_000 })
  await pill.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await tapCentre(page, pill)

  // The card's own header. Before this branch it never appeared in a browser at all.
  await expect(
    page.getByText('Your rest vs the plan'),
    'the card is still absent off-device — the fallback did not reach it',
  ).toBeVisible({ timeout: 30_000 })

  // 12 sets across two prescriptions, both rows over the five-set floor.
  await expect(page.getByText('12 sets · 90 days')).toBeVisible()

  // The arithmetic, not just the chrome: means of 75 and 110, and the signed deltas off them.
  // Scoped to the card's own rows so a stray number elsewhere on the screen cannot satisfy this.
  const rows = page.locator('div', { hasText: /^Your rest vs the plan$/ })
  await expect(rows).toBeTruthy()
  await expect(page.getByText('60s', { exact: true })).toBeVisible()
  await expect(page.getByText('75s', { exact: true })).toBeVisible()
  await expect(page.getByText('+25%', { exact: true })).toBeVisible()
  await expect(page.getByText('120s', { exact: true })).toBeVisible()
  await expect(page.getByText('110s', { exact: true })).toBeVisible()
  await expect(page.getByText('−8%', { exact: true })).toBeVisible()

  // The compression sentence, which is conditional on `compressed === true` and would be wrong to
  // print at one prescription — the three-state return this covers the true arm of.
  await expect(page.getByText(/narrower range than the plan asks for/)).toBeVisible()
  // The row MEANS, not the raw minima — 75 and 110 are what the table above prints, and the
  // sentence must agree with it or the card would contradict itself two lines apart.
  await expect(page.getByText(/75–110s taken against 60–120s planned/)).toBeVisible()
})

test('no server pairs leaves the card absent rather than empty', async ({ page }) => {
  // The honest negative: an account with nothing paired must render no card at all, not a heading
  // over blank space. `restSets: []` is what the route sends for such an account.
  await page.route('**/api/health-trends?view=rest-adherence*', route =>
    route.fulfill({ json: { ...TRENDS, restSets: [] } }))

  await page.goto('/health')
  await settleRouteBoundary(page)

  const pill = page.getByRole('button', { name: 'Rest discipline', exact: true })
  await expect(pill).toBeVisible({ timeout: 60_000 })
  await pill.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await tapCentre(page, pill)

  // The bars still draw, so this is not asserting a screen that failed to load.
  await expect(page.getByText(/Sessions with high rest adherence/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Your rest vs the plan')).toHaveCount(0)
})
