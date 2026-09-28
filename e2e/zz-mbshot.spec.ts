import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

test.use({ viewport: { width: 384, height: 854 } })

test('shot', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)
  await page.goto('/health?tab=training')
  await settleRouteBoundary(page)
  const card = page.locator('div').filter({ hasText: /^Movement Balance/ }).first()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.screenshot({ path: '/tmp/mb-card.png' })
})
