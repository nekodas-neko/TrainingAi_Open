import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Q-499: cachedFetch/useCachedValue swallow a failed response unless the caller passes `onError`,
// so a card with a bare `return null` on empty data is indistinguishable from one whose request
// was rate-limited or errored. Reproduction from docs/reviews/2026-08-18-card-429-reproduction.md,
// extended to both cards the first pass fixed (Estimated 1RM / weights-summary and the HR Recovery
// Profile / hr-recovery-profile), then to the Oura section and the AI Periodization card, which
// the 2026-08-25 enumeration found with the same shape.
//
// **The Oura case is the one that shows why the shape matters.** Its `return null` means "no ring
// connected" — a correct, common, silent state — so a rate limit made a connected user's whole ring
// section disappear with the app behaving as though they had never owned one.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test('a card whose endpoint 429s shows an error state instead of vanishing (Estimated 1RM)', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/weights-summary', r =>
    r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
  await page.goto('/health', { waitUntil: 'networkidle' })
  const progressTab = page.getByRole('tab', { name: 'Progress' })
  if (await progressTab.count()) await progressTab.click()
  await expect(page.getByText("Couldn’t load your strength progress")).toBeVisible({ timeout: 10_000 })
})

test('a card whose endpoint 429s shows an error state instead of vanishing (HR Recovery Profile)', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/health/hr-recovery-profile', r =>
    r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
  await page.goto('/health', { waitUntil: 'networkidle' })
  const bodyTab = page.getByRole('tab', { name: 'Body' })
  if (await bodyTab.count()) await bodyTab.click()
  await expect(page.getByText("Couldn’t load your HR recovery profile")).toBeVisible({ timeout: 10_000 })
})

test('a card whose endpoint 429s shows an error state instead of vanishing (Oura section)', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/oura/stats', r =>
    r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
  await page.goto('/health', { waitUntil: 'networkidle' })
  await expect(page.getByText("Couldn’t load your ring data")).toBeVisible({ timeout: 10_000 })
})

test('a card whose endpoint 429s shows an error state instead of vanishing (AI Periodization)', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/ai-periodization/program-overview', r =>
    r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
  await page.goto('/health', { waitUntil: 'networkidle' })
  await expect(page.getByText("Couldn’t load AI Periodization")).toBeVisible({ timeout: 10_000 })
})

/**
 * The weekly recap banner, same class with one extra edge (Q-112e).
 *
 * Unlike the cards above it fetches **once per completed week**, behind a `hasFetched` ref and a
 * localStorage cache — so a `return null` on failure did not merely hide one paint, it cost the
 * whole week's recap with nothing on screen to say so. Hence the retry: the assertion is that the
 * banner appears at all, and the affordance is what makes appearing useful.
 */
test('the weekly recap says it failed instead of vanishing, and offers a retry', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/weekly-digest', r =>
    r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Too many requests"}' }))
  // Home, not `/session-select` — that path redirects to the Workout tab. `SessionSelectContent` is
  // rendered by the tab shell at `/`, which is where this banner actually lives.
  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByText('Your week in review didn’t load')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Tap to try again')).toBeVisible()
})
