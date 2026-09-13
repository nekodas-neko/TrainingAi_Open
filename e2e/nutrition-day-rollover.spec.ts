import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-35 — the Nutrition tab follows local midnight without being left and re-entered.
 *
 * Measured in review sweep 41: five tabs loaded at 23:50 Brisbane under a fixed clock, the clock
 * advanced 30 minutes, `visibilitychange` dispatched. Dated requests before → after — Home 4 → 2,
 * Health 3 → 3, **Nutrition 5 → 0**. Nutrition was the only tab both day-scoped and stuck.
 *
 * **The part that is not cosmetic.** The header reads `Today` because `formatDateLabel` prints it
 * whenever `selectedDate` and `todayStr` agree, and both were frozen at the launch day — so there is
 * no visible tell. `selectedDate` is also what a new log is written with, so a breakfast logged
 * after midnight lands on the finished day and feeds its calorie budget and adherence.
 *
 * **Why this spec exists at all, and what it is standing in for.** The owner directed on 2026-09-13:
 * *"This is a hard one to check; lets just make the best guess and file it as a non issue till its
 * reproduced — ideally you can be confident in your fix."* Checking it by hand needs the app left
 * open across midnight, which is not something to ask for repeatedly. So this ships on the strength
 * of the code and this test — which makes the test the only thing that will catch a regression, and
 * is why it is written to fail loudly rather than to pass quietly. Removing
 * `useDayRolloverRefresh(catchUpToToday)` from `nutrition-content.tsx` must turn it red.
 *
 * **The assertion is a dated REQUEST, not the header.** After the fix the header still reads
 * `Today` — it read `Today` while broken too, for the same reason. Only the date the tab asks the
 * server for can tell the two apart.
 */

/** 2026-03-10 23:55 in Brisbane (UTC+10, no DST) — the seed user's zone, and a fixed past instant. */
const JUST_BEFORE_MIDNIGHT = new Date('2026-03-10T13:55:00Z')
const LAUNCH_DAY = '2026-03-10'
const NEXT_DAY = '2026-03-11'

test.setTimeout(180_000)

// The service worker re-issues every `/api/` fetch where `page.route` cannot see it, and this spec
// is counting requests — the stub would apply or not depending on whether the worker had claimed
// the page.
test.use({ serviceWorkers: 'block' })

test('a resume after local midnight moves the Nutrition tab to the new day', async ({ page }) => {
  await page.clock.install({ time: JUST_BEFORE_MIDNIGHT })

  // Every dated read the tab makes, by the day it asked for. Recorded rather than counted: which
  // day was requested is the finding, and a count alone cannot tell a re-read of the stale day from
  // a read of the new one — which is precisely the failure being guarded against.
  const daysAsked: string[] = []
  await page.route('**/api/nutrition/**', async route => {
    const day = new URL(route.request().url()).searchParams.get('date')
    if (day) daysAsked.push(day)
    await route.fallback()
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // Precondition, and it is load-bearing: without it a spec that sees no new-day request cannot
  // distinguish "the tab is stuck" from "the tab never asks for anything", and would pass against a
  // page that failed to load at all. BF-100 records four traps in this shape.
  await expect
    .poll(() => daysAsked.filter(d => d === LAUNCH_DAY).length, { timeout: 60_000 })
    .toBeGreaterThan(0)

  daysAsked.length = 0

  // The app left open across midnight and then looked at again. `visibilitychange` is the resume —
  // the same event a user returning to a backgrounded app produces, and the one the tab shell's
  // `epoch` does NOT cover, because that only counts a tab being re-shown.
  await page.clock.fastForward('00:10:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await expect
    .poll(() => daysAsked.filter(d => d === NEXT_DAY), {
      message: 'Nutrition stayed on the launch day across midnight — a log written now lands on the finished day',
      timeout: 60_000,
    })
    .not.toHaveLength(0)

  // And the header agrees it is today, which it also did while broken — asserted so a future change
  // that fixes the date but strands the label is not mistaken for this passing.
  await expect(page.getByText('Today', { exact: true }).first()).toBeVisible()
})

/**
 * The trap the fix has to avoid, and the reason `useDayRolloverRefresh` exists rather than an effect
 * keyed on `useLocalDay()` alone: the provider seeds the day synchronously, so a naive dependency
 * fires once at mount and double-fetches on every launch — invisible in use, reading as an app that
 * is merely slow to settle.
 */
test('a resume on the SAME day does not re-take the dated reads', async ({ page }) => {
  await page.clock.install({ time: JUST_BEFORE_MIDNIGHT })

  const daysAsked: string[] = []
  await page.route('**/api/nutrition/**', async route => {
    const day = new URL(route.request().url()).searchParams.get('date')
    if (day) daysAsked.push(day)
    await route.fallback()
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect.poll(() => daysAsked.length, { timeout: 60_000 }).toBeGreaterThan(0)

  daysAsked.length = 0
  await page.clock.fastForward('00:02:00')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await page.waitForTimeout(3_000)
  expect(daysAsked.filter(d => d === NEXT_DAY),
    'the day did not change, so nothing should have been asked for the next one').toHaveLength(0)
})
