import { test, expect } from '@playwright/test'
import { STORAGE_STATE, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * RV-49 — confirming a deload on Home must evict the caches the visible screen reads.
 *
 * `handleEarlyDeloadConfirm` calls `invalidatePrescriptionChanged()` with **no session id**, because
 * a deload is not scoped to one session. Q-117 added the per-id eviction and reached
 * `ai-prescription-card.tsx`, which passes an id; this caller does not, and the eviction was
 * conditional on it — so the confirm evicted no cards at all, the exact keys Q-117 was filed about.
 * `next-session`, Home's recommendation key, was not in the group either. Both are load-bearing
 * (`workout-card:` is fetched with `freshWithinTtl`, `next-session` has seed-only readers), so the
 * screen kept full-intensity weights for up to TTL_LONG — 6 hours — after the owner confirmed.
 *
 * **This asserts the eviction in a real browser, which is the half the unit test cannot reach.**
 * `lib/__tests__/cache-groups.test.ts` mocks `invalidateCache` and pins which key strings the group
 * passes it; that proves the group's argument list and nothing about whether the browser's cache
 * mirrors actually clear. This drives the real handler against the real `sessionStorage`/
 * `localStorage` mirrors.
 *
 * It is NOT the full repaint assertion RV-49 asked for. Making the screen paint *different* weights
 * needs the server to return a deloaded prescription, which needs `earlyDeloadRecommended` to arise
 * from real data — automatic phase mode, a phase list, a baseline HRV and an ACWR over threshold,
 * across several tables. See the journal entry for what that leaves owed.
 */

const SS_PREFIX = 'ta_sscache:'
const LS_PREFIX = 'ta_cache:'

// The service worker re-issues every /api/ request, so a stubbed route is a race unless the worker
// is blocked outright (scripts/check-e2e-api-stub-sw.js explains the measurement).
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

/** Cache keys present in either mirror, from inside the page. */
const cachedKeys = (page: import('@playwright/test').Page) =>
  page.evaluate(([ss, ls]) => {
    const strip = (store: Storage, prefix: string) =>
      Object.keys(store).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
    return [...strip(sessionStorage, ss), ...strip(localStorage, ls)]
  }, [SS_PREFIX, LS_PREFIX] as const)

test('confirming an early deload evicts the workout-card and next-session caches', async ({ page }) => {
  // The card renders only when the readiness payload recommends it. Reaching that state from real
  // data takes a multi-table fixture; the handler under test does not read this payload, so stubbing
  // it changes nothing about what is being asserted.
  await page.route('**/api/readiness-score*', async route => {
    const res = await route.fetch()
    const body = await res.json().catch(() => ({}))
    await route.fulfill({
      json: {
        ...body,
        earlyDeloadRecommended: true,
        earlyDeload: { score: 55, acwr: 1.6, scoreThreshold: 60, acwrThreshold: 1.5 },
      },
    })
  })

  // The morning check-in sheet covers Home on a fresh profile and hides everything behind it, so
  // the card renders and its button is still unreachable — the fixture exists for exactly this.
  await suppressMorningCheckin(page)

  // Home is `/`; `/session-select` REDIRECTS to /workout, where the readiness payload is never
  // fetched and the card never renders. The early-deload card lives on the home tab.
  await page.goto('/')
  await settleRouteBoundary(page)

  // Let the per-session cards and the recommendation populate their caches.
  await expect
    .poll(async () => (await cachedKeys(page)).some(k => k.startsWith('workout-card:')), {
      timeout: 60_000,
      message: 'no workout-card: cache was ever written — the fixture, not the fix, is wrong',
    })
    .toBe(true)

  const before = await cachedKeys(page)
  expect(before.some(k => k.startsWith('workout-card:')), 'precondition').toBe(true)

  const confirm = page.getByRole('button', { name: /take deload week now/i })
  await expect(confirm).toBeVisible({ timeout: 30_000 })
  await confirm.click()

  // The group is fire-and-forget (`.catch(() => {})`), so poll rather than assert once.
  await expect
    .poll(async () => (await cachedKeys(page)).filter(k => k.startsWith('workout-card:')), {
      timeout: 15_000,
      message: 'workout-card: survived the deload confirm — this is RV-49',
    })
    .toEqual([])

  await expect
    .poll(async () => (await cachedKeys(page)).filter(k => k.startsWith('next-session')), {
      timeout: 15_000,
      message: 'next-session survived the deload confirm — Home keeps the pre-deload recommendation',
    })
    .toEqual([])
})
