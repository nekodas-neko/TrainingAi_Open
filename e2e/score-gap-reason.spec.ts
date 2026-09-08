import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

/**
 * Q-278 — a score that could not be computed no longer reads the same as a score that could.
 *
 * The screens render `—` for an absent score, which looked identical whether nothing was recorded
 * or the personal baseline is simply too cold to judge what was. **Only the second is fixed by
 * waiting**, so the two sentences must differ, and this drives both through the real screen.
 *
 * The response is intercepted rather than seeded: whether the seeded user happens to have a
 * readiness score today is a fact about fixtures, and a test that waited for one would be a
 * statement about the seed rather than about the surface.
 */
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

async function readinessWith(page: import('@playwright/test').Page, availability: unknown) {
  await page.route(u => new URL(u).pathname === '/api/readiness-score', async r => {
    // Built from the real response so every other field on the screen stays honest — only the
    // score and its availability are replaced.
    const real = await r.fetch()
    const body = await real.json().catch(() => ({}))
    await r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, score: null, readinessDisplayScore: null, ouraScore: null, availability }),
    })
  })
}

test('an absent score says nothing was recorded', async ({ page }) => {
  await readinessWith(page, [{ metric: 'readiness', state: 'absent', gap: 'no_input', degradedInputs: [] }])
  await page.goto('/health/readiness', { waitUntil: 'networkidle' })
  await expect(page.getByText('Nothing recorded for today')).toBeVisible({ timeout: 30_000 })
})

test('a score awaiting its baseline says so instead, because waiting is what fixes it', async ({ page }) => {
  await readinessWith(page, [{ metric: 'readiness', state: 'absent', gap: 'awaiting_baseline', degradedInputs: [] }])
  await page.goto('/health/readiness', { waitUntil: 'networkidle' })
  await expect(page.getByText('Not enough history to score this yet')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Nothing recorded for today')).toHaveCount(0)
})
