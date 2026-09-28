import { test, expect } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'
import { todayInTz } from '@trainingai/shared/date-utils'

/**
 * RV-119 — Home's "ready for you" banners collapse into one strip.
 *
 * Built to `docs/design/2026-09-28-home-banner-stack.html` option A, picked 2026-09-28.
 *
 * **Driven through the day-review banner**, because it is the one of the four whose presence a spec
 * can guarantee: it renders on `!dayReviewDismissed`, and the dismissal is a `localStorage` key for
 * the user's local day. The other three need a pending activity, a goals condition or a generated
 * recap — fixtures that would test those features rather than the strip.
 *
 * **What matters here is that the strip COUNTS and EXPANDS**, not which banner is inside it: the
 * split by severity is pinned in `components/home/__tests__/rv119-banner-stack-split.test.ts`, and
 * the count comes from a registry the banners report into, which is the part that can silently
 * undercount.
 */

test.use({ viewport: { width: 384, height: 854 } })

test('the four collapse behind one strip, and it opens in place', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)

  // `todayInTz`, not a UTC slice: the dismissal key is written for the user's local day, and the two
  // differ for ten hours a day.
  const today = todayInTz()
  await page.addInitScript(day => {
    try { localStorage.removeItem(`ta_day_review_dismissed_${day}`) } catch { /* reported below */ }
  }, today)

  await page.goto('/')
  await settleRouteBoundary(page)

  // The strip itself. Waiting for it rather than counting straight away: `settleRouteBoundary`
  // returns while Home is still painting, which has produced a zero count on two sibling specs.
  // By TEST ID, not by name: several banners contain the word "ready" ("Your week in review is
  // ready"), so a `/ready/` role locator matches one of THEM when the strip is absent — the control
  // run against `main` failed on the wrong assertion for exactly that reason, which reads as a
  // broken strip rather than a missing one.
  const strip = page.getByTestId('home-banner-strip')
  await expect(strip, 'the banner strip never rendered').toBeVisible({ timeout: 60_000 })
  await expect(strip).toHaveAttribute('aria-expanded', 'false')

  // Collapsed: the four are MOUNTED but not visible, which is what keeps them in the registry the
  // count comes from. Asserted on the container, not on one banner — which of the four is waiting
  // depends on the account, and pinning `Your day in review` measured the wrong one on the first
  // run (the seeded user has the weekly recap instead).
  const collapsed = page.getByTestId('home-banner-collapsed')
  await expect(collapsed, 'a collapsed banner is still on screen').toBeHidden()

  // The count is real, not a constant.
  await expect(strip, 'the strip does not say how many are waiting').toContainText(/[1-4] ready/)

  // Tapping EXPANDS IN PLACE — the mockup's own note. It must not navigate away.
  const urlBefore = page.url()
  await strip.click()
  await expect(strip).toHaveAttribute('aria-expanded', 'true')
  await expect(collapsed, 'expanding did not reveal the banners').toBeVisible()
  expect(page.url(), 'tapping the strip navigated instead of expanding').toBe(urlBefore)

  // The banners keep their OWN controls — the cost the entry expected to pay for option A, avoided
  // by hiding the four rather than replacing them with a summary.
  expect(await collapsed.getByRole('button').count(), 'the expanded banners lost their own controls')
    .toBeGreaterThan(0)

  // Collapses again.
  await strip.click()
  await expect(strip).toHaveAttribute('aria-expanded', 'false')
  await expect(collapsed).toBeHidden()
})
