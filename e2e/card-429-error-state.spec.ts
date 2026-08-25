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
