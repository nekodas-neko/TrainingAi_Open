import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// Q-499: cachedFetch/useCachedValue swallow a failed response unless the caller passes `onError`,
// so a card with a bare `return null` on empty data is indistinguishable from one whose request
// was rate-limited or errored. Reproduction from docs/reviews/2026-08-18-card-429-reproduction.md,
// extended to both cards this entry fixed (Estimated 1RM / weights-summary and the HR Recovery
// Profile / hr-recovery-profile).
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
