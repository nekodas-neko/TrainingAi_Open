import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Two things the nutrition surface knew and did not say (LA-102 + TN-28).
 *
 * **LA-102** — the owner, on the resting-rate-anchored budget: *"1350 doesnt count some basic
 * metabolic needs".* He is right. BF-152 deliberately did not model the thermic effect of food or
 * non-step movement — a multiplier ASSERTS the overhead happened where the step credit OBSERVES it,
 * and treating intake-linked digestion as an earned credit makes the budget grow as you eat. The
 * decision stands; what was missing is saying so.
 *
 * **TN-28** — `TdeeAdaptationCard` writes the user's calorie goal in one tap and was the only
 * surface printing the maintenance figure without its confidence. Its two siblings both print
 * *"(low confidence, 10 of 14 days logged)"* from the same payload fields.
 *
 * Batched because one verification pass covers both: they are the same screen, and the fixture that
 * exercises the nudge card also renders the ⓘ panel.
 *
 * The payload is stubbed rather than seeded. A calibrated maintenance that drifts from the stored
 * target is what makes the nudge card render at all, and building that from real logs means a
 * fortnight of intake against a weight trend — the estimator is not what is under test here, the
 * two sentences are.
 */
test.use({ serviceWorkers: 'block' })
test.setTimeout(120_000)

/**
 * The seeded user's day, not the runner's and not a literal.
 *
 * `nutrition-content.tsx` renders both cards under `energyBalance?.date === selectedDate`, and
 * `selectedDate` is `todayInTz('Australia/Brisbane')`. A hardcoded date therefore matches for the
 * rest of the day it was written on and never again: this file pinned `2026-09-14` and went red at
 * 14:00 UTC that day, on every branch, permanently — the page took the stub, compared its date to
 * Brisbane's 2026-09-15, and rendered the no-balance state, so both locators were genuinely absent.
 *
 * It is the `scale-ble-day-keying.test.ts` shape rather than the `periodization-soft-delete` one:
 * that class fires for two hours a day and recovers, this one detonates once and stays red. Both
 * come from the same rule — a fixture may hold an absolute date only when BOTH sides of the
 * comparison are fixed, and here the other side is the clock.
 *
 * `Intl` rather than a DB round-trip because nothing in this file needs the database: the payload
 * is stubbed precisely so the estimator is not under test. `plan-day-fill.spec.ts:58` is the same
 * shape. 'en-CA' is what yields YYYY-MM-DD.
 */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

const PAYLOAD = {
  date: TODAY,
  balance: {
    intakeKcal: 1200, expenditureKcal: 2100, restingBaseKcal: 1815, activeKcal: 285,
    netKcal: -900, targetNetKcal: -500, deviationKcal: -400, remainingKcal: 400,
    projectedWeeklyKg: -0.9, restingRateKcal: 1815,
    zone: 'under', zoneLabel: 'Well under', zoneColor: '#60a5fa',
  },
  // Calibrated and low-confidence: the exact shape TN-28 is about.
  maintenance: {
    kcal: 2045, source: 'calibrated', confidence: 'low',
    daysLogged: 10, daysInWindow: 14, weightRateKgPerWeek: -0.4, gapMessage: null,
  },
  // `driftsFromRecommendation` is what gates the card.
  target: { recommendedKcal: 2045, currentKcal: 1800, driftsFromRecommendation: true },
  macroTargets: null,
  activeBreakdown: { workoutKcal: 200, activityKcal: 50, stepsKcal: 35, workoutKcalBySession: [] },
  goal: 'lose_fat',
  missingProfileFields: [],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/nutrition/energy-balance**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD),
  }))
})

test('the ⓘ panel says what the base leaves out (LA-102)', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // By its accessible name. The first draft clicked every `aria-expanded="false"` button on the
  // page instead, which opened meal accordions and never touched this one.
  const info = page.getByRole('button', { name: 'How energy balance is calculated' })
  await expect(info, 'the ⓘ toggle is gone or renamed').toBeVisible({ timeout: 60_000 })
  // `locator.click()` does not reach controls on this tab — a standing gotcha, and the second
  // thing that made this test fail while the panel worked.
  await info.evaluate((el: HTMLElement) => el.click())
  await expect(info).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })

  // The two omissions, named. Asserting on the substance rather than the sentence, so a rewording
  // that keeps the meaning does not fail and a rewording that drops one of them does.
  // The PARAGRAPH, not the emphasised span inside it — `getByText` resolves to the innermost match,
  // which here is a <span> holding four words and none of the substance.
  const panel = page.locator('p').filter({ hasText: 'not in the base at all' })
  await expect(panel, 'the ⓘ panel never named the omissions').toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText(/digest/)
  await expect(panel).toContainText(/standing, fidgeting, housework/)
})

test('the card that writes your goal names its confidence (TN-28)', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // The nudge card, identified by the action it offers — writing the goal is what makes the missing
  // qualifier matter.
  const apply = page.getByRole('button', { name: 'Use 2,045' })
  await expect(apply, 'the nudge card never rendered').toBeVisible({ timeout: 60_000 })

  // Same wording as the two siblings, in the same sentence as the figure.
  await expect(page.getByText(/measured maintenance is 2,045 kcal \(low confidence, 10 of 14 days logged\)/))
    .toBeVisible({ timeout: 20_000 })
})
