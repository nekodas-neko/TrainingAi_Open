import { test, expect } from '@playwright/test'
import { STORAGE_STATE } from './fixtures'

// RV-86 / RV-87. Both screens rendered a failed fetch as a measured zero. Home's Streak card read
// "0 days" and "0 / N sessions done" from a `calendarDays` that was still `{}` because the request
// failed; Profile read "Level 1 · Novice · 0 XP" with an all-zero lifetime, best streak included,
// from a row of `?? 0` defaults. Reached on a first launch after a reinstall, offline, or any
// failed fetch past the cache seed — i.e. exactly when the numbers are least trustworthy.
//
// The interception is a 500 rather than a 429 because the defect is in how ABSENCE is rendered,
// and the status that produced it never reached the component either way.
test.use({ storageState: STORAGE_STATE, serviceWorkers: 'block' })

test('a failed streak fetch shows "—", not a confident zero', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/streak-data', r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }))
  await page.goto('/', { waitUntil: 'networkidle' })

  const streakCard = page.getByText('Streak', { exact: true }).locator('xpath=..')
  await expect(streakCard).toBeVisible({ timeout: 15_000 })
  // Pinning only — the streak FIGURE already read "—" before this change, because it was written
  // as `streak > 0 ? streak : "—"` and an unread window counts 0. Measured against the unfixed
  // components: this assertion passes there. The two below are the ones that discriminate.
  await expect(streakCard).toContainText('—')

  // The ten-day strip is the other half of the same lie: every dot took the "untrained" tint from
  // a window that was never read. Compared against a probe painted with the same token rather than
  // against a literal, so the assertion survives a theme change.
  const dots = streakCard.locator('div.h-2.w-2')
  await expect(dots).toHaveCount(10)
  const [dotColour, unknownColour] = await dots.first().evaluate((el) => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--color-muted)'
    document.body.appendChild(probe)
    const colours = [getComputedStyle(el).backgroundColor, getComputedStyle(probe).backgroundColor]
    probe.remove()
    return colours
  })
  expect(dotColour, 'the dots are painted as untrained days rather than as an unread window')
    .toBe(unknownColour)

  const weekCard = page.getByText('This Week', { exact: true }).locator('xpath=..')
  await expect(weekCard).toContainText('—')
})

test('a failed achievements fetch leaves the Profile stats blank rather than zeroed', async ({ page }) => {
  await page.route(u => new URL(u).pathname === '/api/achievements', r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }))
  await page.goto('/more', { waitUntil: 'networkidle' })

  await expect(page.getByText('Couldn’t load your stats — pull to refresh.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Level —')).toBeVisible()
  // "Best streak" is the figure the entry singled out: an invented 0 there reads as a real record.
  const bestStreak = page.getByText('Best streak', { exact: true }).locator('xpath=..')
  await expect(bestStreak).toContainText('—')
  await expect(page.getByText('— / —')).toBeVisible()
})
